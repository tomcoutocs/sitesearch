import type { CompanyRow } from "@/lib/company";
import { findEmailViaHttpFetch } from "@/lib/scrape/site-email";

const DEFAULT_DELAY_MS = 450;

export type EmailScrapeStats = {
  placesCandidates: number;
  skippedNoWebsite: number;
  scrapedAttempts: number;
  withEmail: number;
  droppedNoEmail: number;
  /** Included in results without a scraped email (requireEmail=false). */
  includedNoEmail: number;
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
  /** When true (default), only companies with a scraped email are emitted. */
  requireEmail?: boolean;
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
  const requireEmail = hooks?.requireEmail ?? true;
  const warnings: string[] = [];

  const stats: EmailScrapeStats = {
    placesCandidates: candidates.length,
    skippedNoWebsite: 0,
    scrapedAttempts: 0,
    withEmail: 0,
    droppedNoEmail: 0,
    includedNoEmail: 0,
  };

  let emitted = 0;

  const emitCompany = (company: CompanyRow) => {
    emitted += 1;
    hooks?.onFound?.(company);
  };

  if (!requireEmail) {
    for (const row of candidates) {
      if (!row.websiteUrl?.trim()) {
        stats.skippedNoWebsite += 1;
        stats.includedNoEmail += 1;
        emitCompany(row);
      }
    }
  }

  const scrapeQueue = candidates.filter((row) => {
    if (!row.websiteUrl?.trim()) {
      if (requireEmail) {
        stats.skippedNoWebsite += 1;
      }
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
      found: emitted,
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
        emitCompany(enriched);
      } else if (requireEmail) {
        stats.droppedNoEmail += 1;
      } else {
        stats.includedNoEmail += 1;
        emitCompany(row);
      }
    } catch (e) {
      if (requireEmail) {
        stats.droppedNoEmail += 1;
      } else {
        stats.includedNoEmail += 1;
        emitCompany(row);
      }
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
