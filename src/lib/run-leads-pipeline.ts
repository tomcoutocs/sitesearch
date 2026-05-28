import type { CompanyRow } from "@/lib/company";
import { geocodeUsAddress } from "@/lib/google/geocode";
import { searchTextNearby } from "@/lib/google/places-text-search";
import type { LeadsStreamEvent } from "@/lib/leads-stream";
import {
  geographyKey,
  normalizedChainHints,
  radiusMetersFor,
  summarizeGeocodeTarget,
  uniqueGeographies,
} from "@/lib/leads-geography";
import { buildEnrichmentPlan } from "@/lib/openai-plan";
import { scrapeCandidatesForEmails } from "@/lib/scrape/filter-with-email";

const MAX_SEARCH_CALLS = 14;

export type LeadsPipelineContext = {
  openaiApiKey: string;
  googleApiKey: string;
  model: string;
  prompt: string;
};

export type LeadsPipelineResult = {
  summary: string;
  profession: string;
  searchCallsMade: number;
  truncated: boolean;
  warnings: string[];
  scrapeStats: Awaited<ReturnType<typeof scrapeCandidatesForEmails>>["stats"];
  companies: CompanyRow[];
};

export async function runLeadsPipeline(
  ctx: LeadsPipelineContext,
  emit: (event: LeadsStreamEvent) => void,
): Promise<LeadsPipelineResult> {
  const warnings: string[] = [];
  const companies: CompanyRow[] = [];

  emit({
    type: "phase",
    phase: "planning",
    message: "Turning your briefing into search anchors…",
  });

  const plan = await buildEnrichmentPlan({
    prompt: ctx.prompt,
    openaiApiKey: ctx.openaiApiKey,
    model: ctx.model,
  });

  const centerCache = new Map<
    string,
    Awaited<ReturnType<typeof geocodeUsAddress>>
  >();
  const companiesByPlace = new Map<string, CompanyRow>();
  let searchCallsMade = 0;

  const geographies = uniqueGeographies(plan).filter((g) =>
    summarizeGeocodeTarget(g).trim().length,
  );

  if (!geographies.length) {
    throw new Error(
      'The assistant returned no anchored geography rows. Mention a city/state (example: "dentists north of Tampa Florida").',
    );
  }

  const queryTexts = plan.searchQueries
    .map((sq) => sq.queryText.trim())
    .filter(Boolean);

  if (!queryTexts.length) {
    throw new Error(
      "The assistant did not propose any runnable search phrases. Retry with a fuller briefing.",
    );
  }

  const chainHints = normalizedChainHints(plan);
  const totalPlacesJobs = Math.min(
    geographies.length * queryTexts.length,
    MAX_SEARCH_CALLS,
  );
  let placesJobsDone = 0;

  emit({
    type: "phase",
    phase: "places",
    message: "Querying Google Places for storefronts…",
  });

  geoLoop: for (const geographyRow of geographies) {
    const geoQuery = summarizeGeocodeTarget(geographyRow);
    const geoKeyForCache = geographyKey(geographyRow);

    if (!centerCache.has(geoKeyForCache)) {
      try {
        centerCache.set(
          geoKeyForCache,
          await geocodeUsAddress(geoQuery, ctx.googleApiKey),
        );
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : "Geocoding failed for this geography row";
        warnings.push(`${geoQuery}: ${msg}`);
        emit({ type: "warning", message: `${geoQuery}: ${msg}` });
        continue;
      }
    }

    const center = centerCache.get(geoKeyForCache);
    if (!center) continue;

    const radiusMeters = radiusMetersFor(geographyRow);

    for (const textQuery of queryTexts) {
      if (searchCallsMade >= MAX_SEARCH_CALLS) {
        const capMsg = `Stopped after ${MAX_SEARCH_CALLS} Google lookups to control spend. Narrow your briefing if you want fewer areas.`;
        warnings.push(capMsg);
        emit({ type: "warning", message: capMsg });
        break geoLoop;
      }

      placesJobsDone += 1;
      emit({
        type: "progress",
        phase: "places",
        checked: placesJobsDone,
        total: totalPlacesJobs,
        found: companiesByPlace.size,
        currentName: `"${textQuery}" near ${geographyRow.anchorCity}`,
      });

      try {
        const rows = await searchTextNearby({
          apiKey: ctx.googleApiKey,
          query: textQuery,
          center,
          radiusMeters,
        });

        for (const row of rows) {
          companiesByPlace.set(row.placeResourceName, row);
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : "Places lookup failed";
        const msg = `"${textQuery}" near ${geographyRow.anchorCity}: ${detail}`;
        warnings.push(msg);
        emit({ type: "warning", message: msg });
      }

      searchCallsMade += 1;
    }
  }

  let candidates = [...companiesByPlace.values()];

  if (plan.filters.mustHaveWebsite) {
    candidates = candidates.filter((company) =>
      Boolean(company.websiteUrl?.trim()),
    );
  }

  candidates = candidates.filter((company) => {
    const name = company.name.toLowerCase();
    return !chainHints.some((needle) =>
      needle.trim() === "" ? false : name.includes(needle),
    );
  });

  const preScrapeCount = candidates.length;
  const scrapeTotal = candidates.filter((c) => c.websiteUrl?.trim()).length;

  emit({
    type: "phase",
    phase: "scraping",
    message:
      scrapeTotal > 0
        ? `Checking ${scrapeTotal} website${scrapeTotal === 1 ? "" : "s"} for public emails…`
        : "No websites to check — wrapping up.",
  });

  const { stats: scrapeStats, warnings: scrapeWarnings } =
    await scrapeCandidatesForEmails(candidates, {
      onProgress: (progress) => {
        emit({
          type: "progress",
          phase: "scraping",
          checked: progress.checked,
          total: progress.total,
          found: progress.found,
          currentName: progress.currentName,
        });
      },
      onFound: (company) => {
        companies.push(company);
        emit({ type: "company", company });
      },
      onWarning: (message) => {
        warnings.push(message);
        emit({ type: "warning", message });
      },
    });

  warnings.push(...scrapeWarnings);

  if (preScrapeCount > 0 && companies.length === 0) {
    const emptyMsg = `Checked ${scrapeStats.scrapedAttempts} storefront${scrapeStats.scrapedAttempts === 1 ? "" : "s"} (${scrapeStats.skippedNoWebsite} lacked a website). None exposed a scrapeable email on public pages.`;
    warnings.push(emptyMsg);
    emit({ type: "warning", message: emptyMsg });
  } else if (scrapeStats.droppedNoEmail > 0) {
    const dropMsg = `Filtered out ${scrapeStats.droppedNoEmail} listing${scrapeStats.droppedNoEmail === 1 ? "" : "s"} with no plaintext email on their site.`;
    warnings.push(dropMsg);
    emit({ type: "warning", message: dropMsg });
  }

  const totalJobs = geographies.length * queryTexts.length;
  const truncated =
    totalJobs > MAX_SEARCH_CALLS && searchCallsMade >= MAX_SEARCH_CALLS;

  return {
    summary: plan.summary,
    profession: plan.profession,
    searchCallsMade,
    truncated,
    warnings,
    scrapeStats,
    companies,
  };
}
