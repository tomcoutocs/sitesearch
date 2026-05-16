import OpenAI from "openai";

import { extractLikelyJsonObject } from "@/lib/extract-json";
import {
  enrichmentPlanSchema,
  type EnrichmentPlan,
} from "@/lib/enrichment-plan-schema";

const SYSTEM = `You help a freelance web designer find local business outreach targets across the United States.

You NEVER invent specific business names, phone numbers, emails, URLs, addresses, or Google Place IDs. Only output generalized search geometry, reusable query strings the user might plug into enrichment APIs later, qualitative "signals", and structured filters inferred from free text.

If the user mentions a metro area, normalize it into anchor cities suitable for geo-radius enrichment (typically 5–20 miles unless they specify otherwise).

Respond with ONLY valid JSON matching this illustrative shape — substitute real content for placeholders (omit markdown fences):
${JSON.stringify(
  {
    summary: "Brief goal narrative",
    profession: "Normalized service niche",
    geography: [
      {
        anchorCity: "Primary municipality anchor",
        state: null,
        radiusMilesMin: 8,
        radiusMilesMax: 18,
        ringNotes: null,
      },
    ],
    searchQueries: [
      {
        queryText: "Keyword phrase runnable in enrichment APIs",
        channel: "maps_keyword",
        rationale: null,
      },
    ],
    idealSignals: ["Stale hero photography", "No HTTPS"],
    filters: {
      mustHaveWebsite: true,
      excludeChainsHint: null,
      other: null,
    },
    enrichmentFieldsNext: [
      "name",
      "phone",
      "website",
      "address",
      "email",
    ],
  },
  null,
  2,
)}

Requirements:

- Geography \`state\` must use a USPS two-letter code or \`null\` when unsure.
- \`filters.excludeChainsHint\` is either an array of brand keywords to steer clear of OR \`null\`.
- \`filters.other\` is either an object keyed by shorthand filter booleans OR \`null\`.
- searchQueries MUST be at least three distinct, high-recall phrases the user could run verbatim.
- Geography entries MUST reflect every distinct city/metro slice the user cared about (merge duplicates).
- enrichmentFieldsNext should almost always include "name","phone","website","address"; include "email" when the user's goal mentions email outreach; otherwise still list "email" as a later-phase field if ambiguous.
- Ring radii MUST be sensible numbers — if unstated assume 8–18 miles typical for commuter rings.`;

export async function buildEnrichmentPlan(params: {
  prompt: string;
  openaiApiKey: string;
  model: string;
}): Promise<EnrichmentPlan> {
  const client = new OpenAI({ apiKey: params.openaiApiKey });

  const completion = await client.chat.completions.create({
    model: params.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: params.prompt.trim() },
    ],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty completion from OpenAI");
  }

  let parsed: unknown;
  try {
    parsed = extractLikelyJsonObject(content);
  } catch {
    throw new Error("Model returned malformed JSON");
  }

  const plan = enrichmentPlanSchema.safeParse(parsed);
  if (!plan.success) {
    const err = new Error("Model JSON failed validation");
    (err as Error & { issues?: unknown }).issues = plan.error.flatten();
    throw err;
  }

  return plan.data;
}
