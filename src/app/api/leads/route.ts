import { NextResponse } from "next/server";

import type { CompanyRow } from "@/lib/company";
import {
  composeBriefingFromForm,
  isOutreachChannel,
} from "@/lib/compose-search-briefing";
import { geocodeUsAddress } from "@/lib/google/geocode";
import { searchTextNearby } from "@/lib/google/places-text-search";
import {
  geographyKey,
  normalizedChainHints,
  radiusMetersFor,
  summarizeGeocodeTarget,
  uniqueGeographies,
} from "@/lib/leads-geography";
import { buildEnrichmentPlan } from "@/lib/openai-plan";
import { retainCompaniesWithScrapedEmail } from "@/lib/scrape/filter-with-email";

export const runtime = "nodejs";

const MAX_SEARCH_CALLS = 14;

function googleMapsPlatformKey(): string | undefined {
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    undefined
  );
}

function resolveSearchBriefing(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const body = payload as Record<string, unknown>;

  const directPrompt =
    typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (directPrompt.length) return directPrompt;

  const profession =
    typeof body.profession === "string" ? body.profession.trim() : "";
  const corridor =
    typeof body.corridor === "string" ? body.corridor.trim() : "";

  if (!profession.length || !corridor.length) {
    return null;
  }

  const radiusCandidate = body.radiusMiles;
  let radiusMiles = 15;
  if (typeof radiusCandidate === "number" && Number.isFinite(radiusCandidate)) {
    radiusMiles = radiusCandidate;
  } else if (
    typeof radiusCandidate === "string" &&
    radiusCandidate.trim().length
  ) {
    const parsed = Number(radiusCandidate);
    if (Number.isFinite(parsed)) {
      radiusMiles = parsed;
    }
  }
  radiusMiles = Math.round(radiusMiles);
  radiusMiles = Math.min(Math.max(radiusMiles, 5), 40);

  const exclusions =
    typeof body.exclusions === "string" ? body.exclusions : "";

  const outreachRaw =
    typeof body.outreachChannel === "string" ? body.outreachChannel : "mixed";

  const outreachChannel = isOutreachChannel(outreachRaw)
    ? outreachRaw
    : "mixed";

  const optionalNotesRaw = body.additionalNotes;
  const additionalNotes =
    typeof optionalNotesRaw === "string"
      ? optionalNotesRaw.trim() || undefined
      : undefined;

  return composeBriefingFromForm({
    profession,
    corridor,
    radiusMiles,
    exclusions,
    outreachChannel,
    additionalNotes,
  });
}

export async function POST(req: Request) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const googleKey = googleMapsPlatformKey();
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  if (!openaiKey) {
    return NextResponse.json(
      { error: "Set OPENAI_API_KEY in .env.local" },
      { status: 500 },
    );
  }

  if (!googleKey) {
    return NextResponse.json(
      {
        error:
          "Set GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY in .env.local, then enable Billing + Places API (New) + Geocoding API for that key in Google Cloud.",
      },
      { status: 500 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = resolveSearchBriefing(payload)?.trim();

  if (!prompt) {
    return NextResponse.json(
      {
        error:
          "Tell us what you are hunting: either send { prompt }, or structured fields { profession, corridor, radiusMiles, exclusions?, outreachChannel?, additionalNotes? }.",
      },
      { status: 400 },
    );
  }

  let plan;
  try {
    plan = await buildEnrichmentPlan({
      prompt,
      openaiApiKey: openaiKey,
      model,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to derive search parameters";
    const issues =
      e instanceof Error && "issues" in e
        ? (e as Error & { issues?: unknown }).issues
        : undefined;
    const status =
      message === "Model JSON failed validation" ? 422 : 502;

    return NextResponse.json({ error: message, issues }, { status });
  }

  const centerCache = new Map<string, Awaited<ReturnType<typeof geocodeUsAddress>>>();
  const warnings: string[] = [];
  const companiesByPlace = new Map<string, CompanyRow>();
  let searchCallsMade = 0;

  const geographies = uniqueGeographies(plan).filter((g) =>
    summarizeGeocodeTarget(g).trim().length,
  );

  if (!geographies.length) {
    return NextResponse.json(
      {
        error:
          'The assistant returned no anchored geography rows. Mention a city/state (example: \"dentists north of Tampa Florida\").',
      },
      { status: 422 },
    );
  }

  const queryTexts = plan.searchQueries.map((sq) => sq.queryText.trim()).filter(Boolean);

  if (!queryTexts.length) {
    return NextResponse.json(
      {
        error:
          "The assistant did not propose any runnable search phrases. Retry with a fuller briefing.",
      },
      { status: 422 },
    );
  }

  const chainHints = normalizedChainHints(plan);

  geoLoop: for (const geographyRow of geographies) {
    const geoQuery = summarizeGeocodeTarget(geographyRow);
    const geoKeyForCache = geographyKey(geographyRow);

    if (!centerCache.has(geoKeyForCache)) {
      try {
        centerCache.set(geoKeyForCache, await geocodeUsAddress(geoQuery, googleKey));
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Geocoding failed for this geography row";
        warnings.push(`${geoQuery}: ${msg}`);
        continue;
      }
    }

    const center = centerCache.get(geoKeyForCache);
    if (!center) continue;

    const radiusMeters = radiusMetersFor(geographyRow);

    for (const textQuery of queryTexts) {
      if (searchCallsMade >= MAX_SEARCH_CALLS) {
        warnings.push(
          `Stopped after ${MAX_SEARCH_CALLS} Google lookups to control spend (${geographies.length} metros × multiple queries multiply quickly). Narrow your briefing if you want to focus on fewer areas.`,
        );
        break geoLoop;
      }

      try {
        const rows = await searchTextNearby({
          apiKey: googleKey,
          query: textQuery,
          center,
          radiusMeters,
        });

        for (const row of rows) {
          companiesByPlace.set(row.placeResourceName, row);
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : "Places lookup failed";
        warnings.push(`"${textQuery}" near ${geographyRow.anchorCity}: ${detail}`);
      }

      searchCallsMade += 1;
    }
  }

  let companies = [...companiesByPlace.values()];

  if (plan.filters.mustHaveWebsite) {
    companies = companies.filter((company) => Boolean(company.websiteUrl?.trim()));
  }

  companies = companies.filter((company) => {
    const name = company.name.toLowerCase();

    return !chainHints.some((needle) =>
      needle.trim() === "" ? false : name.includes(needle),
    );
  });

  const preScrapeCount = companies.length;

  const { companies: emailReady, stats: scrapeStats, warnings: scrapeWarnings } =
    await retainCompaniesWithScrapedEmail(companies);

  companies = emailReady;
  warnings.push(...scrapeWarnings);

  if (preScrapeCount > 0 && companies.length === 0) {
    warnings.push(
      `Checked ${scrapeStats.scrapedAttempts} storefront${scrapeStats.scrapedAttempts === 1 ? "" : "s"} (${scrapeStats.skippedNoWebsite} lacked a website). None exposed a scrapeable email on public pages.`,
    );
  } else if (scrapeStats.droppedNoEmail > 0) {
    warnings.push(
      `Filtered out ${scrapeStats.droppedNoEmail} listing${scrapeStats.droppedNoEmail === 1 ? "" : "s"} with no plaintext email on their site.`,
    );
  }

  const totalJobs = geographies.length * queryTexts.length;
  const truncated =
    totalJobs > MAX_SEARCH_CALLS && searchCallsMade >= MAX_SEARCH_CALLS;

  return NextResponse.json({
    summary: plan.summary,
    profession: plan.profession,
    searchCallsMade,
    truncated,
    warnings,
    scrapeStats,
    companies,
  });
}
