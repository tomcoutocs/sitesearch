import type { CompanyRow } from "@/lib/company";
import type { GeoPoint } from "@/lib/google/geocode";

type PlacesDisplayName = { text?: string };

type PlacesSearchPlace = {
  id?: string;
  formattedAddress?: string;
  displayName?: PlacesDisplayName;
  nationalPhoneNumber?: string;
  websiteUri?: string;
};

type PlacesSearchTextBody = {
  places?: PlacesSearchPlace[];
  error?: unknown;
};

const FIELD_MASK = [
  "places.id",
  "places.formattedAddress",
  "places.displayName",
  "places.nationalPhoneNumber",
  "places.websiteUri",
].join(",");

export async function searchTextNearby(params: {
  apiKey: string;
  query: string;
  center: GeoPoint;
  radiusMeters: number;
  maxResults?: number;
}): Promise<CompanyRow[]> {
  const radius = Math.min(Math.max(params.radiusMeters, 1609), 80000); // ~1 mi .. ~50 mi
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": params.apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: params.query,
      languageCode: "en",
      regionCode: "US",
      locationBias: {
        circle: {
          center: { latitude: params.center.lat, longitude: params.center.lng },
          radius,
        },
      },
      strictTypeFiltering: false,
      maxResultCount: Math.min(Math.max(params.maxResults ?? 20, 1), 20),
    }),
  });

  const body = (await res.json()) as PlacesSearchTextBody & { message?: string };
  if (!res.ok) {
    const msg =
      typeof body.message === "string"
        ? body.message
        : `Places HTTP ${res.status}`;
    throw new Error(msg);
  }

  const places = body.places ?? [];
  const rows: CompanyRow[] = [];

  for (const p of places) {
    const name = (p.displayName?.text ?? "").trim();
    if (!name || !p.id) continue;

    rows.push({
      placeResourceName: p.id,
      name,
      address: (p.formattedAddress ?? "").trim(),
      phone: (p.nationalPhoneNumber ?? "").trim() || null,
      email: null,
      websiteUrl: (p.websiteUri ?? "").trim() || null,
    });
  }

  return rows;
}
