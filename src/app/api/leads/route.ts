import { NextResponse } from "next/server";

import {
  composeBriefingFromForm,
  isOutreachChannel,
} from "@/lib/compose-search-briefing";
import { encodeLeadsStreamLine, type LeadsStreamEvent } from "@/lib/leads-stream";
import { runLeadsPipeline } from "@/lib/run-leads-pipeline";

export const runtime = "nodejs";

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

function jsonError(
  message: string,
  status: number,
  issues?: unknown,
) {
  return NextResponse.json({ error: message, issues }, { status });
}

export async function POST(req: Request) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const googleKey = googleMapsPlatformKey();
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  if (!openaiKey) {
    return jsonError("Set OPENAI_API_KEY in .env.local", 500);
  }

  if (!googleKey) {
    return jsonError(
      "Set GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY in .env.local, then enable Billing + Places API (New) + Geocoding API for that key in Google Cloud.",
      500,
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const prompt = resolveSearchBriefing(payload)?.trim();

  if (!prompt) {
    return jsonError(
      "Tell us what you are hunting: either send { prompt }, or structured fields { profession, corridor, radiusMiles, exclusions?, outreachChannel?, additionalNotes? }.",
      400,
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: LeadsStreamEvent) => {
        controller.enqueue(encoder.encode(encodeLeadsStreamLine(event)));
      };

      try {
        const result = await runLeadsPipeline(
          {
            openaiApiKey: openaiKey,
            googleApiKey: googleKey,
            model,
            prompt,
          },
          push,
        );

        push({
          type: "complete",
          summary: result.summary,
          profession: result.profession,
          searchCallsMade: result.searchCallsMade,
          truncated: result.truncated,
          scrapeStats: result.scrapeStats,
          warnings: result.warnings,
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Lead search failed unexpectedly";
        const issues =
          e instanceof Error && "issues" in e
            ? (e as Error & { issues?: unknown }).issues
            : undefined;

        push({ type: "error", error: message, issues });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
