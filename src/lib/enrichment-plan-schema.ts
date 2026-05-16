import { z } from "zod";

export const enrichmentPlanSchema = z.object({
  summary: z.string().describe("One short sentence capturing the outreach goal"),
  profession: z.string(),
  geography: z.array(
    z.object({
      anchorCity: z.string(),
      state: z.string().nullable().describe("Two-letter USPS state if inferable"),
      radiusMilesMin: z.number().min(0).nullable(),
      radiusMilesMax: z.number().min(0).nullable(),
      ringNotes: z
        .string()
        .nullable()
        .describe("Suburbs, corridors, neighborhoods to prioritize or avoid"),
    }),
  ),
  searchQueries: z.array(
    z.object({
      queryText: z
        .string()
        .describe("Concrete text for Places/search APIs or manual SERP reuse"),
      channel: z
        .enum(["maps_keyword", "web_serp", "directory", "other"])
        .describe("Suggested channel for downstream enrichment"),
      rationale: z.string().nullable(),
    }),
  ),
  idealSignals: z
    .array(z.string())
    .describe(
      "Qualitative signals indicating a dated site or redesign opportunity — not facts about specific businesses",
    ),
  filters: z.object({
    mustHaveWebsite: z.boolean(),
    excludeChainsHint: z.array(z.string()).nullable(),
    other: z.record(z.string(), z.boolean()).nullable(),
  }),
  enrichmentFieldsNext: z
    .array(
      z.enum([
        "name",
        "phone",
        "email",
        "website",
        "address",
        "google_place_id",
        "notes",
      ]),
    )
    .describe("Columns the next enrichment pass should prioritize"),
});

export type EnrichmentPlan = z.infer<typeof enrichmentPlanSchema>;
