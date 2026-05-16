export type GeoPoint = { lat: number; lng: number };

type GeocodeResult = {
  results?: Array<{ geometry?: { location?: GeoPoint } }>;
  status: string;
  error_message?: string;
};

export async function geocodeUsAddress(query: string, apiKey: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("region", "us");
  url.searchParams.set("components", "country:US");

  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Geocoding HTTP ${res.status}`);
  }

  const data = (await res.json()) as GeocodeResult;
  if (data.status !== "OK" || !data.results?.length) {
    throw new Error(
      data.error_message ??
        `Geocoding returned ${data.status} for "${query.slice(0, 80)}${query.length > 80 ? "…" : ""}"`,
    );
  }

  const loc = data.results[0]?.geometry?.location;
  if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
    throw new Error("Geocode response missing coordinates");
  }

  return loc;
}
