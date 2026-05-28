import type { CompanyRow } from "@/lib/company";
import { findEmailViaHttpFetch } from "@/lib/scrape/site-email";

const DEFAULT_DELAY_MS = 450;

export type EmailScrapeStats = {
  placesCandidates: number;
  skippedNoWebsite: number;
  scrapedAttempts: number;
  withEmail: number;
  droppedNoEmail: number;
};

export type ScrapeProgress = {
  checked: number;
  total: number;
  found: number;
  currentName: string;
};

async function pause(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type ScrapeHooks = {
  delayMs?: number;
  onProgress?: (progress: ScrapeProgress) => void;
  onFound?: (company: CompanyRow) => void;
  onWarning?: (message: string) => void;
};

/** Scrape storefronts; invokes hooks as each site is checked and when email is found. */
export async function scrapeCandidatesForEmails(
  candidates: CompanyRow[],
  hooks?: ScrapeHooks,
): Promise<{
  stats: EmailScrapeStats;
  warnings: string[];
}> {
  const delayMs = hooks?.delayMs ?? DEFAULT_DELAY_MS;
  const warnings: string[] = [];

  const stats: EmailScrapeStats = {
    placesCandidates: candidates.length,
    skippedNoWebsite: 0,
    scrapedAttempts: 0,
    withEmail: 0,
    droppedNoEmail: 0,
  };

  const scrapeQueue = candidates.filter((row) => {
    if (!row.websiteUrl?.trim()) {
      stats.skippedNoWebsite += 1;
      return false;
    }
    return true;
  });

  const total = scrapeQueue.length;
  let checked = 0;

  for (const row of scrapeQueue) {
    checked += 1;
    stats.scrapedAttempts += 1;

    hooks?.onProgress?.({
      checked,
      total,
      found: stats.withEmail,
      currentName: row.name,
    });

    try {
      const scraped = await findEmailViaHttpFetch(row.websiteUrl);

      if (scraped.email) {
        const sourceNote =
          scraped.confidence != null
            ? `Found on ${scraped.matchedPath ?? "/"} (${scraped.confidence}% heuristic)`
            : `Found on ${scraped.matchedPath ?? "/"}`;

        const enriched: CompanyRow = {
          ...row,
          email: scraped.email,
          emailSource: sourceNote,
        };

        stats.withEmail += 1;
        hooks?.onFound?.(enriched);
      } else {
        stats.droppedNoEmail += 1;
      }
    } catch (e) {
      stats.droppedNoEmail += 1;
      const msg = e instanceof Error ? e.message : "Scrape failed";
      const warning = `${row.name}: ${msg}`;
      warnings.push(warning);
      hooks?.onWarning?.(warning);
    }

    if (checked < total) {
      await pause(delayMs);
    }
  }

  return { stats, warnings };
}

/** Batch helper (non-streaming callers). */
export async function retainCompaniesWithScrapedEmail(
  candidates: CompanyRow[],
  options?: { delayMs?: number },
): Promise<{
  companies: CompanyRow[];
  stats: EmailScrapeStats;
  warnings: string[];
}> {
  const collected: CompanyRow[] = [];

  const { stats, warnings } = await scrapeCandidatesForEmails(candidates, {
    delayMs: options?.delayMs,
    onFound: (company) => collected.push(company),
  });

  collected.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  return { companies: collected, stats, warnings };
}
