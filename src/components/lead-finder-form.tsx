"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import type { CompanyRow } from "@/lib/company";
import {
  outreachChannelLabels,
  outreachChannelValues,
  type OutreachChannel,
} from "@/lib/compose-search-briefing";
import type { LeadsStreamEvent } from "@/lib/leads-stream";

type EmailScrapeStats = {
  placesCandidates: number;
  skippedNoWebsite: number;
  scrapedAttempts: number;
  withEmail: number;
  droppedNoEmail: number;
};

type SearchProgress = {
  phase: "places" | "scraping";
  checked: number;
  total: number;
  found: number;
  currentName?: string;
};

async function consumeLeadsStream(
  response: Response,
  onEvent: (event: LeadsStreamEvent) => void,
) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    if (contentType.includes("application/json")) {
      const body = (await response.json()) as {
        error?: string;
        issues?: unknown;
      };
      onEvent({
        type: "error",
        error: body.error ?? `Request failed (${response.status})`,
        issues: body.issues,
      });
      return;
    }

    onEvent({
      type: "error",
      error: `Request failed (${response.status})`,
    });
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onEvent({ type: "error", error: "Empty response from server." });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.length) continue;

      try {
        onEvent(JSON.parse(trimmed) as LeadsStreamEvent);
      } catch {
        // ignore malformed chunks
      }
    }
  }

  const tail = buffer.trim();
  if (tail.length) {
    try {
      onEvent(JSON.parse(tail) as LeadsStreamEvent);
    } catch {
      // ignore
    }
  }
}

type ReviewPhase = "pending" | "approved" | "removed";

type WorkspaceRow = CompanyRow & {
  review: ReviewPhase;
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

function toWorkspaceRow(company: CompanyRow): WorkspaceRow {
  return { ...company, review: "pending" };
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

function activeSearchLabel(
  progress: SearchProgress | null,
  fallbackPhase: string | null,
) {
  if (progress?.phase === "places") {
    return "Still querying Google Places…";
  }
  if (progress?.currentName) {
    return `Checking ${progress.currentName}…`;
  }
  if (fallbackPhase) {
    return fallbackPhase;
  }
  return "Still scanning websites for emails…";
}

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
    scrapeStats: EmailScrapeStats | null;
  } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [searchPhase, setSearchPhase] = useState<string | null>(null);
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(
    null,
  );
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

  const displayRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) => reviewRank(a.review) - reviewRank(b.review),
      ),
    [rows],
  );

  const showResultsPanel = busy || rows.length > 0;

  const csvPayload = useMemo(() => {
    const shortlist = rows
      .filter((r) => r.review === "approved")
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );

    if (!shortlist.length) return "";

    const header = "name,phone,email,website,address";
    const bodyLines = shortlist.map((row) =>
      [
        escapeCsv(row.name),
        escapeCsv(row.phone ?? ""),
        escapeCsv(row.email ?? ""),
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

  const canExportCsv =
    allDispositioned && reviewStats.approved > 0 && Boolean(csvPayload);

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setIssues(null);
    setRows([]);
    setMeta(null);
    setWarnings([]);
    setSearchPhase("Starting search…");
    setSearchProgress(null);

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

      await consumeLeadsStream(res, (event) => {
        switch (event.type) {
          case "phase":
            setSearchPhase(event.message);
            if (event.phase !== "scraping") {
              setSearchProgress(null);
            }
            break;

          case "progress":
            setSearchProgress({
              phase: event.phase,
              checked: event.checked,
              total: event.total,
              found: event.found,
              currentName: event.currentName,
            });
            break;

          case "company":
            setRows((prev) => {
              if (
                prev.some(
                  (row) =>
                    row.placeResourceName === event.company.placeResourceName,
                )
              ) {
                return prev;
              }
              return [...prev, toWorkspaceRow(event.company)];
            });
            break;

          case "warning":
            setWarnings((prev) =>
              prev.includes(event.message)
                ? prev
                : [...prev, event.message],
            );
            break;

          case "complete":
            setMeta({
              summary: event.summary,
              profession: event.profession,
              truncated: event.truncated,
              searchCallsMade: event.searchCallsMade,
              scrapeStats: event.scrapeStats,
            });
            setWarnings(event.warnings);
            setSearchPhase(null);
            setSearchProgress(null);
            break;

          case "error":
            setError(event.error);
            if (event.issues) setIssues(event.issues);
            setRows([]);
            setMeta(null);
            setSearchPhase(null);
            setSearchProgress(null);
            break;

          default:
            break;
        }
      });
    } catch {
      setError("Network error — try again.");
      setRows([]);
      setMeta(null);
      setWarnings([]);
      setSearchPhase(null);
      setSearchProgress(null);
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
    a.download = `leads-shortlist-${new Date().toISOString().slice(0, 10)}.csv`;
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
              Places finds candidates, then we scrape each website for a public
              inbox before anything hits your review table—only rows with a found
              email appear.
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
              {busy ? "Searching & scraping emails…" : "Find companies with emails"}
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

      {busy && searchPhase ? (
        <div
          className="rounded-xl border border-indigo-200/80 bg-indigo-50/90 px-5 py-4 shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/40"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-indigo-600 dark:bg-indigo-400" />
            </span>
            <p className="text-sm font-medium text-indigo-950 dark:text-indigo-100">
              {searchPhase}
            </p>
            {searchProgress && searchProgress.total > 0 ? (
              <span className="tabular-nums text-xs text-indigo-800/80 dark:text-indigo-200/80">
                {searchProgress.checked}/{searchProgress.total}
                {searchProgress.phase === "scraping"
                  ? ` · ${reviewStats.total} email${reviewStats.total === 1 ? "" : "s"} found`
                  : ""}
              </span>
            ) : null}
          </div>
          {searchProgress?.currentName ? (
            <p className="mt-2 truncate text-xs text-indigo-900/70 dark:text-indigo-200/70">
              {searchProgress.currentName}
            </p>
          ) : null}
          {searchProgress && searchProgress.total > 0 ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-indigo-200/70 dark:bg-indigo-900/50">
              <div
                className="h-full rounded-full bg-indigo-600 transition-[width] duration-300 ease-out dark:bg-indigo-400"
                style={{
                  width: `${Math.min(100, Math.round((searchProgress.checked / searchProgress.total) * 100))}%`,
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {meta ? (
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-white/80 px-5 py-4 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-neutral-200">
          <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
            {meta.profession} · {meta.summary}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {reviewStats.total} with scrapeable emails in your table
            {meta.scrapeStats
              ? ` · ${meta.scrapeStats.withEmail} kept from ${meta.scrapeStats.placesCandidates} Places hits (${meta.scrapeStats.droppedNoEmail} sites had no public inbox, ${meta.scrapeStats.skippedNoWebsite} lacked a website)`
              : ""}
            {" · "}
            {meta.searchCallsMade} Google Text Search lookups
            {meta.truncated ? " · capped lookup budget" : ""}
          </p>
        </div>
      ) : null}

      {showResultsPanel ? (
        <section className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-neutral-900/[0.01] shadow-[0_1px_6px_rgb(15_23_42/0.08)] dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 bg-neutral-50 px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950/80">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-400">
                  Review runway
                </p>
                <span className="tabular-nums text-xs text-neutral-500">
                  {busy ? (
                    <>
                      {reviewStats.total} found so far · Pending{" "}
                      {reviewStats.pending}
                    </>
                  ) : (
                    <>
                      Pending {reviewStats.pending} · Shortlist{" "}
                      {reviewStats.approved} · Removed {reviewStats.removed}
                    </>
                  )}
                </span>
              </div>
              <p className="max-w-2xl text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                Every row already has a scraped email. Open the site, decide if it
                needs a refresh, then&nbsp;
                <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                  Shortlist
                </span>{" "}
                or&nbsp;
                <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                  Remove
                </span>
                . Export unlocks once every row is dispositioned.
              </p>
              {reviewStats.pending > 0 ? (
                <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-400">
                  {reviewStats.pending} lead{reviewStats.pending === 1 ? "" : "s"}{" "}
                  awaiting a decision — finish review to export CSV.
                </p>
              ) : reviewStats.total > 0 && reviewStats.approved === 0 ? (
                <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                  Every lead was removed — shortlist at least one to export.
                </p>
              ) : allDispositioned && reviewStats.approved > 0 ? (
                <p className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-400">
                  Review complete — export your shortlist CSV anytime.
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                disabled={!canExportCsv || busy}
                onClick={downloadCsv}
                title={
                  !allDispositioned
                    ? "Approve or remove every company before exporting."
                    : reviewStats.approved === 0
                      ? "Shortlist at least one company to export."
                      : "Downloads approved shortlist with phones, emails, sites."
                }
                className="inline-flex h-11 items-center justify-center rounded-full border border-neutral-950/15 bg-neutral-950 px-6 text-sm font-semibold text-white shadow-sm shadow-neutral-900/35 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600 dark:border-neutral-100/20 dark:bg-neutral-950 dark:text-neutral-50 dark:hover:bg-neutral-800 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-300"
              >
                Export shortlist CSV
              </button>
            </div>
          </div>

          <div className="flex max-h-[32rem] flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
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
                {displayRows.map((row) => (
                  <tr
                    key={row.placeResourceName}
                    className={`lead-row-enter border-b border-neutral-100 hover:bg-neutral-50/70 dark:border-neutral-900 dark:hover:bg-neutral-900/50 ${rowSkin(row.review)}`}
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
                              disabled={busy}
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
                              disabled={busy}
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
                      {row.email ? (
                        <>
                          <span className="break-all">{row.email}</span>
                          {row.emailSource ? (
                            <p className="mt-1 text-[10px] text-neutral-400">
                              {row.emailSource}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
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

            {busy ? (
              <div
                className="shrink-0 border-t border-indigo-200/80 bg-indigo-50/95 px-6 py-3 shadow-[0_-8px_24px_rgb(99_102_241/0.12)] backdrop-blur-sm dark:border-indigo-900/60 dark:bg-indigo-950/90"
                role="status"
                aria-live="polite"
              >
                <div className="flex flex-wrap items-center gap-3 text-sm text-indigo-950 dark:text-indigo-100">
                  <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-700 dark:border-indigo-600 dark:border-t-indigo-200" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {activeSearchLabel(searchProgress, searchPhase)}
                  </span>
                  {searchProgress && searchProgress.total > 0 ? (
                    <span className="shrink-0 tabular-nums text-xs text-indigo-800/80 dark:text-indigo-200/80">
                      {searchProgress.checked}/{searchProgress.total}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {!busy && meta && displayRows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 px-5 py-4 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
          No companies with a scrapeable public email matched this search. Try a
          broader profession, different corridor, or check the heads-up notes for
          how many sites were skipped.
        </p>
      ) : null}
    </div>
  );
}
