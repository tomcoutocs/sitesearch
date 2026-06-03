"use client";

import { useMemo, useState } from "react";

import {
  formatOutreachDate,
  OUTREACH_STATUSES,
  type OutreachContact,
  type OutreachStatus,
} from "@/lib/outreach-contacts";

type OutreachHistoryProps = {
  contacts: OutreachContact[];
  configured: boolean;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onUpdate: (
    id: string,
    patch: { status?: OutreachStatus; notes?: string | null },
  ) => Promise<boolean>;
};

const STATUS_LABELS: Record<OutreachStatus, string> = {
  contacted: "Contacted",
  replied: "Replied",
  closed: "Closed",
};

export function OutreachHistory({
  contacts,
  configured,
  loading,
  error,
  onRefresh,
  onUpdate,
}: OutreachHistoryProps) {
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;

    return contacts.filter((contact) => {
      const haystack = [
        contact.company_name,
        contact.email,
        contact.phone ?? "",
        contact.website_url ?? "",
        contact.profession ?? "",
        contact.notes ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [contacts, query]);

  async function saveNotes(contact: OutreachContact, notes: string) {
    setSavingId(contact.id);
    try {
      await onUpdate(contact.id, { notes: notes.trim() || null });
    } finally {
      setSavingId(null);
    }
  }

  async function saveStatus(contact: OutreachContact, status: OutreachStatus) {
    setSavingId(contact.id);
    try {
      await onUpdate(contact.id, { status });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-neutral-200/80 bg-white/90 p-6 shadow-[0_1px_2px_rgb(15_23_42/0.04)] dark:border-neutral-800 dark:bg-neutral-950/80">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
            Outreach history
          </h3>
          <p className="max-w-2xl text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
            Every company you open in Gmail is saved here so you can look them up
            when they reply and avoid emailing the same address twice.
          </p>
          {!configured ? (
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
              Add Supabase env vars to enable saving and duplicate checks.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || !configured}
          className="border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-800 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="text-xs font-medium text-rose-700 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      <label className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
          Search contacts
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Company, email, phone, notes…"
          disabled={!configured || !contacts.length}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none ring-neutral-400 transition focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50"
        />
      </label>

      {!configured ? null : loading && !contacts.length ? (
        <p className="text-xs text-neutral-500">Loading outreach history…</p>
      ) : !contacts.length ? (
        <p className="text-xs text-neutral-500">
          No outreach logged yet — open Gmail from a shortlisted lead to record
          the first contact.
        </p>
      ) : !filtered.length ? (
        <p className="text-xs text-neutral-500">No matches for that search.</p>
      ) : (
        <ul className="flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-1">
          {filtered.map((contact) => {
            const expanded = expandedId === contact.id;
            const busy = savingId === contact.id;

            return (
              <li
                key={contact.id}
                className="rounded-xl border border-neutral-200/80 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium text-neutral-950 dark:text-neutral-50">
                      {contact.company_name}
                    </p>
                    <p className="truncate text-xs text-neutral-600 dark:text-neutral-400">
                      {contact.email}
                      {contact.phone ? ` · ${contact.phone}` : ""}
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      Emailed {formatOutreachDate(contact.emailed_at)}
                      {contact.profession
                        ? ` · ${contact.profession}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={contact.status}
                      disabled={busy}
                      onChange={(e) =>
                        void saveStatus(
                          contact,
                          e.target.value as OutreachStatus,
                        )
                      }
                      className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-800 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100"
                    >
                      {OUTREACH_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(expanded ? null : contact.id)
                      }
                      className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600 underline-offset-2 hover:underline dark:text-neutral-300"
                    >
                      {expanded ? "Hide" : "Details"}
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <div className="mt-4 space-y-3 border-t border-neutral-200/80 pt-4 dark:border-neutral-800">
                    <dl className="grid gap-2 text-xs text-neutral-700 dark:text-neutral-300 sm:grid-cols-2">
                      {contact.website_url ? (
                        <div>
                          <dt className="font-semibold text-neutral-500">
                            Website
                          </dt>
                          <dd className="break-all">
                            <a
                              href={contact.website_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-700 underline dark:text-indigo-300"
                            >
                              {contact.website_url}
                            </a>
                          </dd>
                        </div>
                      ) : null}
                      {contact.address ? (
                        <div>
                          <dt className="font-semibold text-neutral-500">
                            Address
                          </dt>
                          <dd>{contact.address}</dd>
                        </div>
                      ) : null}
                      {contact.search_corridor ? (
                        <div>
                          <dt className="font-semibold text-neutral-500">
                            Search area
                          </dt>
                          <dd>{contact.search_corridor}</dd>
                        </div>
                      ) : null}
                      <div className="sm:col-span-2">
                        <dt className="font-semibold text-neutral-500">
                          Subject
                        </dt>
                        <dd>{contact.email_subject}</dd>
                      </div>
                    </dl>

                    <label className="flex flex-col gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                        Notes (replies, follow-ups)
                      </span>
                      <textarea
                        defaultValue={contact.notes ?? ""}
                        rows={3}
                        disabled={busy}
                        onBlur={(e) => {
                          const next = e.target.value;
                          if (next === (contact.notes ?? "")) return;
                          void saveNotes(contact, next);
                        }}
                        className="resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-[13px] text-neutral-900 outline-none ring-neutral-400 transition focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50"
                      />
                    </label>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
