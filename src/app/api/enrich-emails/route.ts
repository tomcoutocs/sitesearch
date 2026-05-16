import { NextResponse } from "next/server";

import type { CompanyRow } from "@/lib/company";
import {
  findEmailViaHttpFetch,
  normalizeSiteUrl,
} from "@/lib/scrape/site-email";

export const runtime = "nodejs";

const ENRICH_DELAY_MS = 450;

export type EmailEnrichmentResult = {
  placeResourceName: string;
  name: string;
  domain: string | null;
  email: string | null;
  confidence: number | null;
  note: string | null;
};

async function pause(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  const rawItems = body.items;

  if (
    !Array.isArray(rawItems) ||
    !rawItems.every((entry) => entry && typeof entry === "object")
  ) {
    return NextResponse.json(
      {
        error:
          "items must be a non-empty array of { placeResourceName, name, websiteUrl }",
      },
      { status: 400 },
    );
  }

  type InputItem = Pick<
    CompanyRow,
    "placeResourceName" | "name" | "websiteUrl"
  >;

  const hydrated: InputItem[] = [];
  const seenPlaces = new Set<string>();

  for (const raw of rawItems) {
    const row = raw as Record<string, unknown>;
    const id =
      typeof row.placeResourceName === "string" ? row.placeResourceName : "";
    if (!id || seenPlaces.has(id)) continue;

    hydrated.push({
      placeResourceName: id,
      name: typeof row.name === "string" ? row.name : "",
      websiteUrl: typeof row.websiteUrl === "string" ? row.websiteUrl : null,
    });
    seenPlaces.add(id);
  }

  if (!hydrated.length) {
    return NextResponse.json(
      { error: "No valid enrichment rows supplied." },
      { status: 400 },
    );
  }

  const results: EmailEnrichmentResult[] = [];
  const warnings: string[] = [];

  let index = 0;
  for (const row of hydrated) {
    index += 1;
    const primary = normalizeSiteUrl(row.websiteUrl);
    const hostLabel =
      primary?.hostname.replace(/^www\./iu, "").toLowerCase() ?? null;

    if (!primary || !hostLabel) {
      results.push({
        placeResourceName: row.placeResourceName,
        name: row.name,
        domain: null,
        email: null,
        confidence: null,
        note: "Needs a storefront URL before we can fetch HTML.",
      });
      if (index < hydrated.length) {
        await pause(ENRICH_DELAY_MS);
      }
      continue;
    }

    try {
      const scraped = await findEmailViaHttpFetch(row.websiteUrl);

      const notePieces: string[] = [];
      if (scraped.email) {
        notePieces.push(
          scraped.confidence != null
            ? `Found on ${scraped.matchedPath ?? "/"} (${scraped.confidence}% heuristic)`
            : `Found on ${scraped.matchedPath ?? "/"}`,
        );
      } else if (scraped.diagnostics) {
        notePieces.push(scraped.diagnostics);
      } else if (scraped.sourcesTried.length) {
        notePieces.push(
          `Tried paths ${scraped.sourcesTried.join(", ")} with no plaintext inbox.`,
        );
      }

      results.push({
        placeResourceName: row.placeResourceName,
        name: row.name,
        domain: hostLabel,
        email: scraped.email ?? null,
        confidence: scraped.confidence,
        note: notePieces.length ? notePieces.join(" · ") : null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unexpected scrape failure.";
      warnings.push(`${row.name}: ${msg}`);
      results.push({
        placeResourceName: row.placeResourceName,
        name: row.name,
        domain: hostLabel,
        email: null,
        confidence: null,
        note: msg,
      });
    }

    if (index < hydrated.length) {
      await pause(ENRICH_DELAY_MS);
    }
  }

  return NextResponse.json({ results, warnings });
}
