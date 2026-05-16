/**
 * Lightweight HTTP crawler that inspects storefront HTML/markup for public mailboxes.
 * Honor robots guidance + Terms of Service—these are guesses, not attestations.
 */

const MAX_HTML_BYTES = 600_000;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 12_000;

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; SiteSearchLeadAssist/1.0; storefront preview)",
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
};

const COMMON_PATH_TRIES = ["/contact", "/contact-us", "/about", "/reach-us"];

const MAILTO_REGEX = /\bmailto:([^"'>\s#]+)/giu;

const INLINE_EMAIL_REGEX =
  /\b[A-Z0-9][A-Z0-9._%+-]{0,64}@[A-Z0-9][A-Z0-9.-]{1,253}\.[A-Z]{2,63}\b/giu;

export function normalizeSiteUrl(siteRaw: string | null | undefined) {
  if (!siteRaw || typeof siteRaw !== "string") return null;

  try {
    const trimmed = siteRaw.trim();
    if (!trimmed.length) return null;

    const candidate = /^https?:\/\//iu.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(candidate);

    if (!url.pathname || url.pathname === "") {
      url.pathname = "/";
    }

    return url;
  } catch {
    return null;
  }
}

function stripTagsForScan(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<[^>]+>/gu, " ");
}

function decodeEmailHints(fragment: string) {
  return fragment
    .replaceAll("&#064;", "@")
    .replaceAll("&#64;", "@")
    .replace(/&#x40;/giu, "@")
    .replace(/\s*\[\s*at\s*\]\s*/giu, "@")
    .replace(/\s*\(\s*at\s*\)\s*/giu, "@");
}

function ipv4Segments(host: string): [number, number, number, number] | null {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!parts) return null;
  const quad = parts.slice(1, 5).map((segment) => Number(segment));
  if (quad.some((value) => value > 255 || Number.isNaN(value))) return null;
  return quad as [number, number, number, number];
}

function isRestrictedHost(hostnameRaw: string) {
  const host = hostnameRaw.trim().toLowerCase();

  if (host.endsWith(".local") || host === "localhost") {
    return true;
  }

  if (host === "[::1]" || host === "::1") {
    return true;
  }

  const quad = ipv4Segments(host);
  if (!quad) return false;

  const [a, b] = quad;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 0) return true;

  return false;
}

export function assertFetchSafeCandidate(candidate: URL) {
  if (candidate.username || candidate.password) {
    throw new Error("URLs with embedded credentials are blocked.");
  }

  if (candidate.protocol !== "http:" && candidate.protocol !== "https:") {
    throw new Error("Only http(s) pages can be mirrored.");
  }

  if (!candidate.hostname.includes(".")) {
    throw new Error("Bare hostnames cannot be queried.");
  }

  if (isRestrictedHost(candidate.hostname)) {
    throw new Error("Non-public hostname blocked.");
  }
}

function urlsToProbe(primary: URL) {
  const probes: URL[] = [new URL(primary.toString())];
  const seen = new Set(probes.map((u) => u.toString()));

  for (const suffix of COMMON_PATH_TRIES) {
    const probe = new URL(suffix, `${primary.origin}/`);
    if (!seen.has(probe.toString())) {
      probes.push(probe);
      seen.add(probe.toString());
    }
  }

  return probes;
}

async function readHtmlWithCap(response: Response) {
  const lengthHeader = response.headers.get("content-length");

  if (lengthHeader != null && Number(lengthHeader) > MAX_HTML_BYTES) {
    throw new Error("HTML payload too large.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const clipped =
    buffer.byteLength > MAX_HTML_BYTES
      ? buffer.subarray(0, MAX_HTML_BYTES)
      : buffer;

  return clipped.toString("utf8");
}

async function fetchHtmlWithRedirects(fetchUrl: URL): Promise<string> {
  assertFetchSafeCandidate(fetchUrl);

  let currentUrl: URL | null = fetchUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!currentUrl) throw new Error("Redirect chain stalled.");

    assertFetchSafeCandidate(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const networkResponse: Response = await fetch(currentUrl.toString(), {
        redirect: "manual",
        headers: FETCH_HEADERS,
        signal: controller.signal,
      });

      if (networkResponse.status >= 300 && networkResponse.status < 400) {
        const target = networkResponse.headers.get("location");
        if (!target) throw new Error(`HTTP ${networkResponse.status} missing Location`);
        currentUrl = new URL(target, currentUrl);
        continue;
      }

      if (!networkResponse.ok) {
        throw new Error(`HTTP ${networkResponse.status}`);
      }

      const ctype = networkResponse.headers.get("content-type") ?? "";

      if (
        ctype.length &&
        /\b(font\/|video\/|audio\/|application\/(?:pdf|zip|rss)|image\/)/iu.test(
          ctype,
        )
      ) {
        throw new Error(`Unsupported content-type: ${ctype}`);
      }

      return await readHtmlWithCap(networkResponse);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Exceeded redirect allowance.");
}

function decodeMailFragment(rawFragment: string) {
  try {
    const head = decodeEmailHints(
      decodeURIComponent(rawFragment.trim().split(/[?#]/)[0] ?? ""),
    );
    const firstChunk = head.split(",")[0]?.trim().toLowerCase() ?? "";

    if (!firstChunk.includes("@")) return null;

    const mailboxPiece = head.split(",")[0]?.trim().split("?")[0]?.toLowerCase();

    const normalizedTrim = mailboxPiece?.trim()?.split(/\s+/u)[0] ?? null;

    return normalizedTrim;
  } catch {
    return null;
  }
}

function collectMailCandidates(markup: string) {
  const mailboxes = new Set<string>();

  for (const match of markup.matchAll(MAILTO_REGEX)) {
    const parsed = decodeMailFragment(match[1] ?? "");
    if (parsed) mailboxes.add(parsed.trim().toLowerCase());
  }

  const decodedMarkup = decodeEmailHints(markup);
  const flattened = stripTagsForScan(decodedMarkup);
  INLINE_EMAIL_REGEX.lastIndex = 0;

  for (const hit of flattened.matchAll(INLINE_EMAIL_REGEX)) {
    mailboxes.add(hit[0].trim().toLowerCase());
  }

  return [...mailboxes];
}

function disposableLocalPart(localStem: string) {
  const stem = localStem.toLowerCase();
  return /(^|\.)no[-_]?reply|^donotreply|^mailer-daemon|^postmaster|^hostmaster|^webmaster|^blackhole|^system/u.test(stem);
}

function scoreMailbox(mailboxRaw: string) {
  const mailbox = mailboxRaw.trim().toLowerCase();

  const at = mailbox.lastIndexOf("@");
  if (at < 1) return Number.NEGATIVE_INFINITY;

  const localRaw = mailbox.slice(0, at);
  const domain = mailbox.slice(at + 1);

  if (
    /\.(woff2|ttf|eot)$/iu.test(domain) ||
    /\.(png|jpe?g|gif|svg|webp)$/iu.test(domain) ||
    /\d+\.\d+\.\d+\.\d+$/u.test(domain)
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  const placeholders = ["example.com", "localhost.test", "test.com"];
  if (placeholders.some((needle) => domain === needle || domain.endsWith(`.${needle}`))) {
    return Number.NEGATIVE_INFINITY;
  }

  if (/(youtube|tiktok|facebook|linkedin|instagram)\./iu.test(domain)) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 12;

  if (disposableLocalPart(localRaw)) {
    score -= 40;
  }

  const localStem =
    typeof localRaw === "string"
      ? (localRaw.split("+")[0] ?? "").toLowerCase()
      : "";

  if (
    /^hello|^contact|^info|^studio|^office|^team|^hi\b|^inquiries|^consult|^connect|^booking|^appointment/u.test(
      localStem,
    )
  ) {
    score += 75;
  }

  if (
    /^sales|^accounts|^finance|^payments|^merchant|^marketing|^campaign/u.test(
      localStem,
    )
  ) {
    score += 42;
  }

  if (
    /^customerservice|^customer\.service|^support|^care|^help|^media|^press|^owners?/u.test(
      localStem,
    )
  ) {
    score += 62;
  }

  if (
    /^privacy|^notifications|^spam|^junk|^noreply|^no-reply|^dmarc|^abuse|^billing\+|^invoice\+|^marketing\+|^legal-alert/u.test(
      localStem,
    )
  ) {
    score -= 65;
  }

  if (/\+[a-z0-9._-]{3,}$/iu.test(localRaw)) {
    score += 6;
  }

  score += domain.endsWith(".com") ? 5 : domain.endsWith(".co") ? 3 : 0;

  const pieces = domain.split(".");
  if (pieces.some((segment) => segment.length > 32)) score -= 20;

  return score;
}

function alignMailboxToHost(mailboxRaw: string, storefrontHostRaw: string) {
  let boost = 0;

  const emailHostRaw = mailboxRaw.split("@")[1];
  if (!emailHostRaw) return boost;

  const emailHost = emailHostRaw.trim().replace(/^www\./iu, "").toLowerCase();
  const storefront = storefrontHostRaw.trim().replace(/^www\./iu, "").toLowerCase();

  const shared =
    storefront === emailHost ||
    storefront.endsWith(`.${emailHost}`) ||
    emailHost.endsWith(`.${storefront}`);

  if (shared) boost += 40;

  if (
    emailHost === "gmail.com" ||
    emailHost === "yahoo.com" ||
    emailHost === "icloud.com"
  ) {
    boost -= 18;
  }

  return boost;
}

function mailboxToConfidence(score: number) {
  const clamped = Math.min(Math.max(score, 0), 115);
  return Math.round(Math.min(95, 40 + clamped * 0.45));
}

function pickBest(mailboxes: string[], storefrontHostRaw: string) {
  let winner: { email: string; score: number } | null = null;

  for (const mailbox of mailboxes) {
    const mailboxScore =
      scoreMailbox(mailbox) + alignMailboxToHost(mailbox, storefrontHostRaw);

    const viable = mailboxScore > Number.NEGATIVE_INFINITY;

    if (!viable) continue;

    if (!winner || mailboxScore > winner.score) {
      winner = { email: mailbox.trim().toLowerCase(), score: mailboxScore };
    }
  }

  if (!winner || winner.score < 8) return null;

  return {
    email: winner.email,
    confidence: mailboxToConfidence(winner.score),
    score: winner.score,
  };
}

export type EmailScrapeFinding = {
  email: string | null;
  confidence: number | null;
  sourcesTried: string[];
  matchedPath?: string | null;
  diagnostics?: string | null;
};

export async function findEmailViaHttpFetch(
  siteRaw: string | null | undefined,
): Promise<EmailScrapeFinding> {
  const primary = normalizeSiteUrl(siteRaw);
  if (!primary) {
    return {
      email: null,
      confidence: null,
      sourcesTried: [],
      diagnostics: "Missing storefront URL.",
    };
  }

  const storefrontHost = primary.hostname.replace(/^www\./iu, "");
  const probes = urlsToProbe(primary);

  let lastDiagnostics: string | null = null;

  for (const probe of probes) {
    try {
      const markup = await fetchHtmlWithRedirects(probe);
      const mailboxes = collectMailCandidates(markup);
      const best = pickBest(mailboxes, storefrontHost);

      const location = probe.pathname?.length ? `${probe.pathname}` : "/";

      if (best?.email) {
        return {
          email: best.email,
          confidence: best.confidence,
          sourcesTried: probes.map((path) =>
            `${path.pathname || "/"}`,
          ),
          matchedPath: location,
          diagnostics: lastDiagnostics ?? undefined,
        };
      }

      lastDiagnostics =
        mailboxes.length > 0
          ? `${location}: rejected ${mailboxes.length} scraped tokens`
          : `${location}: no matches`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fetch failed.";
      lastDiagnostics = `${probe.pathname || "/"} · ${message}`;
      continue;
    }
  }

  return {
    email: null,
    confidence: null,
    sourcesTried: probes.map((path) => `${path.pathname || "/"}`),
    matchedPath: null,
    diagnostics:
      lastDiagnostics ?? "Fetched likely pages yet found no plausible inbox.",
  };
}
