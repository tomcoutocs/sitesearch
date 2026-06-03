"use client";

import { useMemo, useState } from "react";

import {
  analyzeEmailDeliverability,
  RISK_LABELS,
  RISK_STYLES,
  type DeliverabilityReport,
} from "@/lib/email-deliverability";

type EmailDeliverabilityPanelProps = {
  subject: string;
  body: string;
};

function ScoreRing({
  score,
  riskLevel,
}: {
  score: number;
  riskLevel: DeliverabilityReport["riskLevel"];
}) {
  const styles = RISK_STYLES[riskLevel];
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
      <svg
        className="-rotate-90"
        width="96"
        height="96"
        viewBox="0 0 96 96"
        aria-hidden
      >
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-neutral-200 dark:text-neutral-800"
        />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={styles.ring}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums text-neutral-950 dark:text-neutral-50">
          {score}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
          Inbox
        </span>
      </div>
    </div>
  );
}

export function EmailDeliverabilityPanel({
  subject,
  body,
}: EmailDeliverabilityPanelProps) {
  const [showSignals, setShowSignals] = useState(false);

  const report = useMemo(
    () => analyzeEmailDeliverability(subject, body),
    [subject, body],
  );

  const styles = RISK_STYLES[report.riskLevel];
  const negatives = report.signals.filter((s) => s.kind === "negative");
  const warnings = report.signals.filter((s) => s.kind === "warning");
  const positives = report.signals.filter((s) => s.kind === "positive");

  return (
    <section
      className="rounded-xl border border-neutral-200/80 bg-neutral-50/80 p-4 dark:border-neutral-800 dark:bg-neutral-900/40"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start gap-4">
        <ScoreRing score={report.inboxScore} riskLevel={report.riskLevel} />

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-neutral-950 dark:text-neutral-50">
              Deliverability check
            </h4>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${styles.badge}`}
            >
              {RISK_LABELS[report.riskLevel]}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
            {report.summary}
          </p>

          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-lg border border-neutral-200/80 bg-white/80 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950/60">
              <dt className="font-semibold text-neutral-500">Spam likelihood</dt>
              <dd className={`mt-1 tabular-nums font-semibold ${styles.text}`}>
                ~{report.spamRiskPercent}% estimated filter risk
              </dd>
            </div>
            <div className="rounded-lg border border-neutral-200/80 bg-white/80 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950/60">
              <dt className="font-semibold text-neutral-500">
                Analysis confidence
              </dt>
              <dd className="mt-1 tabular-nums font-semibold text-neutral-800 dark:text-neutral-200">
                {report.confidencePercent}%
              </dd>
            </div>
          </dl>

          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${styles.bar}`}
              style={{ width: `${report.inboxScore}%` }}
            />
          </div>
        </div>
      </div>

      {(negatives.length > 0 || warnings.length > 0 || positives.length > 0) && (
        <div className="mt-4 border-t border-neutral-200/80 pt-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setShowSignals((open) => !open)}
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600 underline-offset-2 hover:underline dark:text-neutral-300"
          >
            {showSignals ? "Hide" : "Show"} {report.signals.length} factor
            {report.signals.length === 1 ? "" : "s"}
          </button>

          {showSignals ? (
            <ul className="mt-3 flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
              {[...negatives, ...warnings, ...positives].map((signal) => (
                <li
                  key={signal.id}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    signal.kind === "positive"
                      ? "border-emerald-200/80 bg-emerald-50/60 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
                      : signal.kind === "warning"
                        ? "border-amber-200/80 bg-amber-50/60 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
                        : "border-rose-200/80 bg-rose-50/60 text-rose-950 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100"
                  }`}
                >
                  <p className="font-semibold">{signal.label}</p>
                  <p className="mt-1 leading-relaxed opacity-90">
                    {signal.detail}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-neutral-400">
        Heuristic estimate for one-to-one Gmail sends — not a guarantee. Sender
        reputation, volume, and recipient engagement matter too.
      </p>
    </section>
  );
}
