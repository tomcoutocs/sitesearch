import { LeadFinderForm } from "@/components/lead-finder-form";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_20%_-10%,rgb(239_239_239),transparent_45%),radial-gradient(circle_at_90%_0%,rgb(224_247_251),transparent_42%)] text-neutral-950 dark:bg-[radial-gradient(circle_at_10%_-20%,rgb(24_24_27),transparent_52%),radial-gradient(circle_at_90%_0%,rgb(30_58_82),transparent_42%)] dark:text-neutral-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-14 sm:px-6 lg:px-10">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
            Local storefront radar
          </p>
          <h1 className="text-[2.125rem] font-semibold tracking-tight sm:text-[2.5rem]">
            Describe what you chase; get a spreadsheet-ready lead table.
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-neutral-600 dark:text-neutral-400">
            Use the structured form (with a radial slider) plus optional notes—the
            model still massages intent into anchored Places queries before Google
            returns real storefront contacts. We scrape each site for a public inbox
            first—only businesses with a found email reach your review table.
          </p>
        </header>

        <LeadFinderForm />

        <footer className="space-y-1 text-xs text-neutral-400">
          <p>
            Requires{" "}
            <code className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              OPENAI_API_KEY
            </code>{" "}
            plus{" "}
            <code className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              GOOGLE_MAPS_API_KEY
            </code>{" "}
            (
            <code className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              GOOGLE_PLACES_API_KEY
            </code>
            {""}
            alias) — enable Places&nbsp;API&nbsp;(New) + Geocoding with billing on the
            GCP project. Tune {""}
            <code className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              OPENAI_MODEL
            </code>
            {""}
            optionally. Shortlist review + CSV export happen after the email filter.
            Keep secrets in {""}
            <code className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              .env.local
            </code>
            .
          </p>
        </footer>
      </div>
    </div>
  );
}
