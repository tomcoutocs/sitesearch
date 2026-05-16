"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import type { CompanyRow } from "@/lib/company";
import {
  outreachChannelLabels,
  outreachChannelValues,
  type OutreachChannel,
} from "@/lib/compose-search-briefing";

type LeadsResponse =
  | {
      summary: string;
      profession: string;
      companies: CompanyRow[];
      warnings: string[];
      truncated: boolean;
      searchCallsMade: number;
    }
  | {
      error: string;
      issues?: unknown;
    };

type EnrichResponse =
  | {
      results: Array<{
        placeResourceName: string;
        email: string | null;
        confidence: number | null;
        note: string | null;
      }>;
      warnings: string[];
    }
  | { error: string };

type ReviewPhase = "pending" | "approved" | "removed";

type WorkspaceRow = CompanyRow & {
  review: ReviewPhase;
  enrichedEmail: string | null;
  enrichNote: string | null;
};

const MIN_RADIUS_MI = 5;
const MAX_RADIUS_MI = 30;

const SAMPLE = {
  profession: "Independent family dentists",
  corridor: "~15 miles north of Charlotte city center toward Concord / Huntersville corridors in North Carolina.",
  exclusions:
    "Nationwide mega chains (Aspen Dental, Smile Brands, Heartland), hospital-owned campuses.",
};

const CONTROL =
  "w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-[15px] text-neutral-950 shadow-inner shadow-neutral-950/5 outline-none ring-neutral-950/25 placeholder:text-neutral-400 focus:ring-[3px] disabled:opacity-55 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50 dark:ring-neutral-50/35";

function escapeCsv(field: string) {
  const needsQuotes = /[",\r\n]/u.test(field);
  const sanitized = field.replaceAll('"', '""');
  return needsQuotes ? `"${sanitized}"` : sanitized;
}

function initialsFromCompanies(companies: CompanyRow[]): WorkspaceRow[] {
  return companies.map((c) => ({
    ...c,
    review: "pending" as ReviewPhase,
    enrichedEmail: null,
    enrichNote: null,
  }));
}

function reviewRank(phase: ReviewPhase) {
  if (phase === "pending") return 0;
  if (phase === "approved") return 1;
  return 2;
}

const ACTION_BTN_PRIMARY =
  "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]";
const ACTION_BTN_SECONDARY =
  "text-[11px] font-semibold text-neutral-500 underline-offset-4 hover:text-neutral-800 hover:underline dark:text-neutral-400 dark:hover:text-neutral-200";

export function LeadFinderForm() {
  const [profession, setProfession] = useState("");
  const [corridor, setCorridor] = useState("");
  const [radiusMiles, setRadiusMiles] = useState(15);
  const [exclusions, setExclusions] = useState("");
  const [outreachChannel, setOutreachChannel] =
    useState<OutreachChannel>("email");
  const [additionalNotes, setAdditionalNotes] = useState("");

  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [meta, setMeta] = useState<{
    summary: string;
    profession: string;
    truncated: boolean;
    searchCallsMade: number;
  } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichmentRan, setEnrichmentRan] = useState(false);

  const reviewStats = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let removed = 0;
    for (const row of rows) {
      if (row.review === "pending") pending += 1;
      else if (row.review === "approved") approved += 1;
      else removed += 1;
    }
    return { pending, approved, removed, total: rows.length };
  }, [rows]);

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const rr = reviewRank(a.review) - reviewRank(b.review);
        if (rr !== 0) return rr;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }),
    [rows],
  );

  const csvPayload = useMemo(() => {
    const shortlist = rows
      .filter((r) => r.review === "approved")
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );

    if (!shortlist.length) return "";

    const header =
      "name,phone,email,enriched_email,website,address";
    const bodyLines = shortlist.map((row) =>
      [
        escapeCsv(row.name),
        escapeCsv(row.phone ?? ""),
        escapeCsv(row.email ?? ""),
        escapeCsv(row.enrichedEmail ?? ""),
        escapeCsv(row.websiteUrl ?? ""),
        escapeCsv(row.address),
      ].join(","),
    );

    return [header, ...bodyLines].join("\r\n");
  }, [rows]);

  const disableSubmit =
    busy || !profession.trim().length || !corridor.trim().length;

  const allDispositioned =
    rows.length > 0 && reviewStats.pending === 0;

  const canRunEnrichment =
    allDispositioned &&
    reviewStats.approved > 0 &&
    !enrichBusy &&
    !enrichmentRan;

  function bumpReview(id: string, review: ReviewPhase) {
    setRows((prev) =>
      prev.map((row) =>
        row.placeResourceName === id ? { ...row, review } : row,
      ),
    );
  }

  function resetWithSampleValues() {
    setProfession(SAMPLE.profession);
    setCorridor(SAMPLE.corridor);
    setRadiusMiles(15);
    setExclusions(SAMPLE.exclusions);
    setOutreachChannel("email");
    setAdditionalNotes(
      "Websites stuck on old WordPress layouts or missing HTTPS badges are juicy.",
    );
  }

  async function runEmailEnrichment() {
    const approvedSlice = rows.filter((row) => row.review === "approved");
    if (!approvedSlice.length || !canRunEnrichment) return;

    setEnrichBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/enrich-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: approvedSlice.map((row) => ({
            placeResourceName: row.placeResourceName,
            name: row.name,
            websiteUrl: row.websiteUrl,
          })),
        }),
      });

      const data = (await res.json()) as EnrichResponse;

      if (!res.ok || !("results" in data)) {
        setError(
          "error" in data ? data.error : `Email enrichment failed (${res.status})`,
        );
        return;
      }

      const merged = new Map(
        data.results.map((hit) => [hit.placeResourceName, hit] as const),
      );

      setRows((prev) =>
        prev.map((row) => {
          const note = merged.get(row.placeResourceName);
          if (!note) return row;
          return {
            ...row,
            enrichedEmail: note.email ?? row.enrichedEmail,
            enrichNote: note.note ?? row.enrichNote,
          };
        }),
      );

      const extraWarnings = [...(data.warnings ?? [])];

      setWarnings((prev) => [...prev, ...extraWarnings]);
      setEnrichmentRan(true);
    } catch {
      setError("Network error while enriching — try again.");
    } finally {
      setEnrichBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setIssues(null);

    const payload = {
      profession,
      corridor,
      radiusMiles,
      exclusions,
      outreachChannel,
      additionalNotes:
        additionalNotes.trim().length === 0 ? undefined : additionalNotes.trim(),
    };

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as LeadsResponse;

      if (!res.ok) {
        if ("issues" in data && data.issues) setIssues(data.issues);
        setError(
          "error" in data ? data.error : `Request failed (${res.status})`,
        );
        setRows([]);
        setMeta(null);
        setWarnings([]);
        setEnrichmentRan(false);
        return;
      }

      if (
        !("companies" in data) ||
        !Array.isArray(data.companies) ||
        typeof data.summary !== "string"
      ) {
        setError("Unexpected response shape.");
        setRows([]);
        setMeta(null);
        setWarnings([]);
        setEnrichmentRan(false);
        return;
      }

      setRows(initialsFromCompanies(data.companies));
      setMeta({
        summary: data.summary,
        profession: data.profession,
        truncated: data.truncated,
        searchCallsMade: data.searchCallsMade,
      });
      setWarnings(data.warnings);
      setEnrichmentRan(false);
    } catch {
      setError("Network error — try again.");
      setRows([]);
      setMeta(null);
      setWarnings([]);
      setEnrichmentRan(false);
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (!csvPayload) return;
    const blob = new Blob([csvPayload], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = enrichmentRan ? "shortlist-enriched" : "shortlist";
    a.download = `leads-${stamp}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function rowSkin(review: ReviewPhase) {
    if (review === "removed") {
      return "opacity-55 bg-neutral-100/70 dark:bg-neutral-900/50";
    }
    if (review === "approved") {
      return "bg-emerald-50/40 dark:bg-emerald-950/20";
    }
    return "";
  }

  const radiusAccent =
    "h-2 w-full cursor-pointer appearance-none rounded-full bg-neutral-200 accent-neutral-950 dark:bg-neutral-800 dark:accent-neutral-50";

  return (
    <div className="flex w-full flex-col gap-10">
      <section className="flex flex-col gap-4 rounded-2xl border border-neutral-200/80 bg-neutral-50/80 p-6 shadow-[0_1px_2px_rgb(15_23_42/0.04)] dark:border-neutral-800 dark:bg-neutral-950/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
              Dial in the hunt
            </h2>
            <p className="max-w-xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              Give structured inputs—GPT still massages them into anchored
              queries, Places returns real storefront data.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => resetWithSampleValues()}
            className="rounded-full border border-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-white disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-500 dark:hover:bg-neutral-900"
          >
            Load sample preset
          </button>
        </div>

        <form className="flex flex-col gap-6" onSubmit={onSubmit}>
          <div className="grid gap-6 sm:grid-cols-2">
            <label className="flex flex-col gap-2 sm:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                Profession / niche
              </span>
              <input
                type="text"
                value={profession}
                disabled={busy}
                onChange={(e) => setProfession(e.target.value)}
                placeholder="e.g., boutique yoga studios"
                autoComplete="off"
                required
                className={CONTROL}
              />
            </label>

            <label className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                Corridor / anchors
              </span>
              <input
                type="text"
                value={corridor}
                disabled={busy}
                onChange={(e) => setCorridor(e.target.value)}
                placeholder="e.g., ~15 miles north of Downtown Dallas toward Plano/McKinney corridors, TX."
                autoComplete="off"
                required
                className={CONTROL}
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Spell out directional hints (north / ring road / suburb names) —
                GPT + geocoder lean on concrete municipal anchors for accurate
                radii.
              </p>
            </label>

            <div className="flex flex-col gap-4 sm:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <label
                    className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400"
                    htmlFor="radiusSlider"
                  >
                    Search radius
                  </label>
                  <p className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                    Controls how aggressively Google hunts around your anchor
                    before filters kick in ({MIN_RADIUS_MI}-
                    {MAX_RADIUS_MI} mi).
                  </p>
                </div>
                <span
                  className="rounded-full bg-white px-3 py-1 text-sm font-semibold tabular-nums text-neutral-900 shadow-inner shadow-neutral-950/10 dark:bg-neutral-900 dark:text-neutral-50"
                  aria-live="polite"
                  id="radiusValueChip"
                >
                  {radiusMiles} mi
                </span>
              </div>
              <input
                id="radiusSlider"
                type="range"
                min={MIN_RADIUS_MI}
                max={MAX_RADIUS_MI}
                step={1}
                value={radiusMiles}
                aria-valuemin={MIN_RADIUS_MI}
                aria-valuemax={MAX_RADIUS_MI}
                aria-valuenow={radiusMiles}
                aria-valuetext={`${radiusMiles} mile radius`}
                aria-describedby="radiusValueChip"
                disabled={busy}
                onChange={(e) => setRadiusMiles(Number(e.target.value))}
                className={radiusAccent}
              />
            </div>

            <label className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                Exclusions (optional)
              </span>
              <textarea
                value={exclusions}
                disabled={busy}
                onChange={(e) => setExclusions(e.target.value)}
                rows={3}
                placeholder="Chains, aggregators, or industries to skip…"
                className={`${CONTROL} resize-none`}
              />
            </label>

            <label className="flex flex-col gap-2 sm:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                Outreach lane
              </span>
              <select
                value={outreachChannel}
                disabled={busy}
                onChange={(event) =>
                  setOutreachChannel(event.target.value as OutreachChannel)
                }
                className={CONTROL}
              >
                {outreachChannelValues.map((value) => (
                  <option key={value} value={value}>
                    {outreachChannelLabels[value]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                Designer notes (optional)
              </span>
              <textarea
                value={additionalNotes}
                disabled={busy}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                rows={3}
                placeholder="Signals you care about (dated UI, ADA gaps, Shopify vs Wix…)—purely contextual for GPT."
                className={`${CONTROL} resize-none`}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={disableSubmit}
              className="inline-flex h-11 cursor-pointer items-center justify-center rounded-full bg-neutral-950 px-6 text-sm font-medium text-neutral-50 transition hover:bg-neutral-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-neutral-50 dark:text-neutral-950 dark:hover:bg-neutral-200"
            >
              {busy ? "Searching Places…" : "Find companies"}
            </button>
          </div>
        </form>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">
          <p className="font-semibold">Something went wrong</p>
          <p className="mt-2 leading-relaxed">{error}</p>
          {issues ? (
            <pre className="mt-4 max-h-60 overflow-auto rounded-lg bg-white/70 p-3 text-xs text-rose-900 dark:bg-neutral-950/60 dark:text-rose-50">
              {JSON.stringify(issues, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}

      {warnings.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-xs text-amber-950 shadow-sm shadow-amber-900/10 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-semibold text-sm">Heads-up</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
            {warnings.map((warning, idx) => (
              <li key={`${warning}-${idx}`}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {meta ? (
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-white/80 px-5 py-4 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-neutral-200">
          <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
            {meta.profession} · {meta.summary}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {reviewStats.total} companies after filters · fired {meta.searchCallsMade}{" "}
            Google Text Search lookups
            {meta.truncated ? " · capped lookup budget, broaden/narrow rerun if needed" : ""}
          </p>
        </div>
      ) : null}

      {sortedRows.length ? (
        <section className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-neutral-900/[0.01] shadow-[0_1px_6px_rgb(15_23_42/0.08)] dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 bg-neutral-50 px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950/80">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-400">
                  Review runway
                </p>
                <span className="tabular-nums text-xs text-neutral-500">
                  Pending {reviewStats.pending} · Shortlist {reviewStats.approved}{" "}
                  · Removed {reviewStats.removed}
                </span>
              </div>
              <p className="max-w-2xl text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                Inspect each site posture. Anything worth pitching moves to&nbsp;
                <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                  Shortlist
                </span>
                ; declutter with&nbsp;
                <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                  Remove
                </span>
                . The single sweep curls each shortlisted homepage (plus lightweight
                /contact guesses) once every row is dispositioned—it runs once per Places
                pull so auditing stays repeatable.
              </p>
              {reviewStats.pending > 0 ? (
                <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-400">
                  {reviewStats.pending} lead{reviewStats.pending === 1 ? "" : "s"}{" "}
                  awaiting a decision — finish review to unlock enrichment.
                </p>
              ) : reviewStats.total > 0 && reviewStats.approved === 0 ? (
                <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                  Every lead was removed — add at least one shortlist candidate to enrich.
                </p>
              ) : enrichmentRan ? (
                <p className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-400">
                  Enrichment complete for this batch. Export CSV or rerun a fresh Places search if you tweak targeting.
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
              {csvPayload ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={downloadCsv}
                  title="Downloads approved shortlist with phones, sites, scraped emails."
                  className="inline-flex h-11 items-center justify-center rounded-full border border-neutral-950/15 bg-neutral-950 px-6 text-sm font-semibold text-white shadow-sm shadow-neutral-900/35 transition hover:bg-neutral-800 disabled:pointer-events-none disabled:opacity-40 dark:border-neutral-100/20 dark:bg-neutral-950 dark:text-neutral-50 dark:hover:bg-neutral-800"
                >
                  Export shortlist CSV
                </button>
              ) : null}
              <button
                type="button"
                disabled={!canRunEnrichment}
                title={
                  enrichmentRan
                    ? "Enrichment already completed for these Places results. Run another search or export CSV."
                    : enrichBusy
                      ? undefined
                      : reviewStats.pending > 0
                        ? "Approve or remove every company before enriching."
                        : reviewStats.approved === 0
                          ? "Shortlist at least one company worth pitching."
                          : undefined
                }
                onClick={() => void runEmailEnrichment()}
                className="inline-flex h-11 items-center justify-center rounded-full bg-indigo-600 px-6 text-sm font-semibold text-white shadow-sm shadow-indigo-900/40 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600 dark:bg-indigo-500 dark:text-white dark:shadow-indigo-900/40 dark:hover:bg-indigo-400 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-300"
              >
                {enrichBusy
                  ? "Scanning sites…"
                  : enrichmentRan
                    ? "Enrichment locked"
                    : "Sweep sites for plaintext emails"}
              </button>
            </div>
          </div>

          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[940px] table-fixed border-collapse text-left text-[13px]">
              <thead className="sticky top-0 z-10 bg-white/95 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400 backdrop-blur dark:bg-neutral-950/95">
                <tr>
                  <th className="w-[100px] border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                    Status
                  </th>
                  <th className="w-[150px] border-b border-neutral-200 px-3 py-3 dark:border-neutral-800">
                    Actions
                  </th>
                  <th className="w-[170px] border-b border-neutral-200 px-3 py-3 dark:border-neutral-800">
                    Name
                  </th>
                  <th className="w-[120px] border-b border-neutral-200 px-3 py-3 dark:border-neutral-800">
                    Phone
                  </th>
                  <th className="w-[180px] border-b border-neutral-200 px-3 py-3 dark:border-neutral-800">
                    Email
                  </th>
                  <th className="w-[200px] border-b border-neutral-200 px-3 py-3 dark:border-neutral-800">
                    Website
                  </th>
                  <th className="border-b border-neutral-200 px-3 py-3 dark:border-neutral-800">
                    Address
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr
                    key={row.placeResourceName}
                    className={`border-b border-neutral-100 hover:bg-neutral-50/70 dark:border-neutral-900 dark:hover:bg-neutral-900/50 ${rowSkin(row.review)}`}
                  >
                    <td className="px-4 py-3 align-middle text-[11px] font-semibold uppercase tracking-[0.15em] text-neutral-600 dark:text-neutral-300">
                      {row.review === "pending" ? (
                        <span className="text-amber-700 dark:text-amber-400">
                          Pending
                        </span>
                      ) : row.review === "approved" ? (
                        <span className="text-emerald-800 dark:text-emerald-300">
                          Listed
                        </span>
                      ) : (
                        <span className="text-neutral-500 line-through decoration-neutral-400">
                          Dropped
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <div className="flex flex-col gap-1.5">
                        {row.review === "pending" ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                bumpReview(row.placeResourceName, "approved")
                              }
                              className={`border border-emerald-300 bg-emerald-50 text-emerald-950 ${ACTION_BTN_PRIMARY} dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-50`}
                            >
                              Shortlist
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                bumpReview(row.placeResourceName, "removed")
                              }
                              className={`border border-neutral-300 bg-neutral-100 text-neutral-800 ${ACTION_BTN_PRIMARY} dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100`}
                            >
                              Remove
                            </button>
                          </div>
                        ) : row.review === "approved" ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-400">
                              Shortlisted
                            </span>
                            <button
                              type="button"
                              disabled={busy || enrichmentRan}
                              onClick={() =>
                                bumpReview(row.placeResourceName, "pending")
                              }
                              className={ACTION_BTN_SECONDARY}
                            >
                              Undo (back to pending)
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold text-neutral-500">
                              Removed
                            </span>
                            <button
                              type="button"
                              disabled={busy || enrichmentRan}
                              onClick={() =>
                                bumpReview(row.placeResourceName, "pending")
                              }
                              className={ACTION_BTN_SECONDARY}
                            >
                              Restore
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="border-r border-transparent px-3 py-3 align-top font-medium text-neutral-900 dark:text-neutral-50">
                      {row.name}
                    </td>
                    <td className="px-3 py-3 align-top text-neutral-700 dark:text-neutral-300">
                      {row.phone ? (
                        <a
                          href={`tel:${row.phone.replaceAll(/[^\d+]/gu, "")}`}
                          className="text-blue-700 hover:underline dark:text-blue-300"
                        >
                          {row.phone}
                        </a>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-neutral-700 dark:text-neutral-300">
                      {(() => {
                        const resolved = row.enrichedEmail ?? row.email;
                        return resolved ? (
                          <span className="break-all">{resolved}</span>
                        ) : (
                          <span className="block text-neutral-400">
                            {reviewStats.pending > 0
                              ? "Finish triage first"
                              : row.review === "removed"
                                ? "Dropped"
                                : enrichmentRan
                                  ? "Nothing on public pages"
                                  : "Sweep pending"}
                          </span>
                        );
                      })()}
                      {row.enrichNote && row.enrichedEmail ? (
                        <p className="mt-1 text-[10px] text-neutral-400">
                          {row.enrichNote}
                        </p>
                      ) : null}
                      {row.enrichNote &&
                      !row.enrichedEmail &&
                      enrichmentRan &&
                      row.review === "approved" ? (
                        <p className="mt-1 text-[10px] text-amber-800 dark:text-amber-300">
                          {row.enrichNote}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {row.websiteUrl ? (
                        <a
                          href={row.websiteUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="break-all text-blue-700 hover:underline dark:text-blue-300"
                        >
                          {row.websiteUrl.replace(/^https?:\/\//u, "")}
                        </a>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-neutral-600 dark:text-neutral-400">
                      {row.address ? (
                        <span className="line-clamp-3">{row.address}</span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!busy && meta && sortedRows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-5 py-4 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
          No rows survived the filters implied by your form (often the GPT pass
          asked for&nbsp;
          <span className="font-medium">&quot;must have website&quot;</span>
          ).
        </p>
      ) : null}
    </div>
  );
}
