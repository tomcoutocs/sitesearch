import type { EnrichmentPlan } from "@/lib/enrichment-plan-schema";

export function radiusMetersFor(geographyRow: EnrichmentPlan["geography"][number]) {
  const lo = geographyRow.radiusMilesMin;
  const hi = geographyRow.radiusMilesMax;
  let miles =
    typeof lo === "number" && typeof hi === "number"
      ? (lo + hi) / 2
      : typeof hi === "number"
        ? hi
        : typeof lo === "number"
          ? lo
          : 15;

  miles = Math.min(Math.max(miles, 4), 50);
  return miles * 1609.34;
}

export function summarizeGeocodeTarget(
  geographyRow: EnrichmentPlan["geography"][number],
) {
  const state = geographyRow.state?.trim();
  return state
    ? `${geographyRow.anchorCity.trim()}, ${state}, USA`
    : `${geographyRow.anchorCity.trim()}, USA`;
}

export function geographyKey(geographyRow: EnrichmentPlan["geography"][number]) {
  return `${geographyRow.anchorCity.trim().toLowerCase()}|${(
    geographyRow.state ?? ""
  )
    .trim()
    .toLowerCase()}`;
}

export function uniqueGeographies(plan: EnrichmentPlan) {
  const map = new Map<string, EnrichmentPlan["geography"][number]>();
  for (const row of plan.geography) {
    map.set(geographyKey(row), row);
  }
  return [...map.values()];
}

export function normalizedChainHints(plan: EnrichmentPlan) {
  const hints =
    plan.filters.excludeChainsHint
      ?.map((hint) => hint.trim().toLowerCase())
      .filter(Boolean) ?? [];
  return hints;
}
