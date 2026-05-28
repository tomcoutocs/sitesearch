import type { CompanyRow } from "@/lib/company";
import type { EmailScrapeStats } from "@/lib/scrape/filter-with-email";

export type LeadsStreamEvent =
  | { type: "phase"; phase: "planning" | "places" | "scraping"; message: string }
  | {
      type: "progress";
      phase: "places" | "scraping";
      checked: number;
      total: number;
      found: number;
      currentName?: string;
    }
  | { type: "company"; company: CompanyRow }
  | { type: "warning"; message: string }
  | {
      type: "complete";
      summary: string;
      profession: string;
      searchCallsMade: number;
      truncated: boolean;
      scrapeStats: EmailScrapeStats;
      warnings: string[];
    }
  | { type: "error"; error: string; issues?: unknown };

export function encodeLeadsStreamLine(event: LeadsStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}
