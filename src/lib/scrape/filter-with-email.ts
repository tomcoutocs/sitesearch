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

async function pause(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Keeps only rows where public HTML scraping surfaced a plausible inbox. */
export async function retainCompaniesWithScrapedEmail(
  candidates: CompanyRow[],
  options?: { delayMs?: number },
): Promise<{
  companies: CompanyRow[];
  stats: EmailScrapeStats;
  warnings: string[];
}> {
  const delayMs = options?.delayMs ?? DEFAULT_DELAY_MS;
  const warnings: string[] = [];

  const stats: EmailScrapeStats = {
    placesCandidates: candidates.length,
    skippedNoWebsite: 0,
    scrapedAttempts: 0,
    withEmail: 0,
    droppedNoEmail: 0,
  };

  const withInbox: CompanyRow[] = [];
  const scrapeQueue = candidates.filter((row) => {
    if (!row.websiteUrl?.trim()) {
      stats.skippedNoWebsite += 1;
      return false;
    }
    return true;
  });

  let index = 0;
  for (const row of scrapeQueue) {
    index += 1;
    stats.scrapedAttempts += 1;

    try {
      const scraped = await findEmailViaHttpFetch(row.websiteUrl);

      if (scraped.email) {
        const sourceNote =
          scraped.confidence != null
            ? `Found on ${scraped.matchedPath ?? "/"} (${scraped.confidence}% heuristic)`
            : `Found on ${scraped.matchedPath ?? "/"}`;

        withInbox.push({
          ...row,
          email: scraped.email,
          emailSource: sourceNote,
        });
        stats.withEmail += 1;
      } else {
        stats.droppedNoEmail += 1;
      }
    } catch (e) {
      stats.droppedNoEmail += 1;
      const msg = e instanceof Error ? e.message : "Scrape failed";
      warnings.push(`${row.name}: ${msg}`);
    }

    if (index < scrapeQueue.length) {
      await pause(delayMs);
    }
  }

  withInbox.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  return { companies: withInbox, stats, warnings };
}
