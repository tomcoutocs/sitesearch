"use client";

import { useMemo, useState } from "react";

import {
  formatOutreachDate,
  OUTREACH_STATUSES,
  type OutreachContact,
  type OutreachStatus,
} from "@/lib/outreach-contacts";

import { useOutreach } from "@/components/outreach-provider";

const STATUS_LABELS: Record<OutreachStatus, string> = {
  contacted: "Contacted",
  replied: "Replied",
  closed: "Closed",
};

const STATUS_STYLES: Record<OutreachStatus, string> = {
  contacted:
    "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100",
  replied:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
  closed:
    "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

export function OutreachContactsTab() {
  const {
    contacts,
    configured,
    loading,
    error,
    refresh,
    updateContact,
  } = useOutreach();

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
        contact.address ?? "",
        contact.profession ?? "",
        contact.search_corridor ?? "",
        contact.notes ?? "",
        contact.email_subject ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [contacts, query]);

  async function saveNotes(contact: OutreachContact, notes: string) {
    setSavingId(contact.id);
    try {
      await updateContact(contact.id, { notes: notes.trim() || null });
    } finally {
      setSavingId(null);
    }
  }

  async function saveStatus(contact: OutreachContact, status: OutreachStatus) {
    setSavingId(contact.id);
    try {
      await updateContact(contact.id, { status });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
            Outreach contacts
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Every company you open in Gmail from the lead finder is saved here.
            Search by name, email, or notes when someone replies.
          </p>
          {!configured ? (
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
              Add{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5 text-[11px] dark:bg-amber-950/60">
                NEXT_PUBLIC_SUPABASE_URL
              </code>{" "}
              and{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5 text-[11px] dark:bg-amber-950/60">
                SUPABASE_SERVICE_ROLE_KEY
              </code>{" "}
              to .env.local to enable outreach logging.
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !configured}
          className="border border-neutral-300 bg-neutral-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-800 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-white/90 shadow-[0_1px_2px_rgb(15_23_42/0.04)] dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="border-b border-neutral-200 bg-neutral-50 px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950/80">
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
              Search
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Company, email, phone, profession, notes…"
              disabled={!configured}
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none ring-neutral-400 transition focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50"
            />
          </label>
          {configured && contacts.length > 0 ? (
            <p className="mt-3 text-[11px] text-neutral-500">
              {filtered.length} of {contacts.length} contact
              {contacts.length === 1 ? "" : "s"}
              {query.trim() ? ` matching “${query.trim()}”` : ""}
            </p>
          ) : null}
        </div>

        {!configured ? (
          <p className="px-6 py-10 text-center text-sm text-neutral-500">
            Connect Supabase to view outreach history.
          </p>
        ) : loading && !contacts.length ? (
          <p className="px-6 py-10 text-center text-sm text-neutral-500">
            Loading outreach contacts…
          </p>
        ) : !contacts.length ? (
          <p className="px-6 py-10 text-center text-sm text-neutral-500">
            No outreach logged yet. Shortlist a lead and click{" "}
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">
              Open in Gmail
            </span>{" "}
            on the Find leads tab to record your first contact.
          </p>
        ) : !filtered.length ? (
          <p className="px-6 py-10 text-center text-sm text-neutral-500">
            No matches for that search.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/80 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/60">
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Emailed</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Profession</th>
                  <th className="w-[90px] px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((contact) => {
                  const expanded = expandedId === contact.id;
                  const busy = savingId === contact.id;

                  return (
                    <ContactRows
                      key={contact.id}
                      contact={contact}
                      expanded={expanded}
                      busy={busy}
                      onToggle={() =>
                        setExpandedId(expanded ? null : contact.id)
                      }
                      onSaveStatus={(status) => void saveStatus(contact, status)}
                      onSaveNotes={(notes) => void saveNotes(contact, notes)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ContactRows({
  contact,
  expanded,
  busy,
  onToggle,
  onSaveStatus,
  onSaveNotes,
}: {
  contact: OutreachContact;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onSaveStatus: (status: OutreachStatus) => void;
  onSaveNotes: (notes: string) => void;
}) {
  return (
    <>
      <tr className="border-b border-neutral-100 hover:bg-neutral-50/70 dark:border-neutral-900 dark:hover:bg-neutral-900/40">
        <td className="px-4 py-3 align-top font-medium text-neutral-950 dark:text-neutral-50">
          {contact.company_name}
        </td>
        <td className="px-4 py-3 align-top">
          <a
            href={`mailto:${contact.email}`}
            className="break-all text-indigo-700 hover:underline dark:text-indigo-300"
          >
            {contact.email}
          </a>
        </td>
        <td className="px-4 py-3 align-top text-neutral-700 dark:text-neutral-300">
          {contact.phone ? (
            <a
              href={`tel:${contact.phone.replaceAll(/[^\d+]/gu, "")}`}
              className="hover:underline"
            >
              {contact.phone}
            </a>
          ) : (
            <span className="text-neutral-400">—</span>
          )}
        </td>
        <td className="px-4 py-3 align-top tabular-nums text-neutral-700 dark:text-neutral-300">
          {formatOutreachDate(contact.emailed_at)}
        </td>
        <td className="px-4 py-3 align-top">
          <select
            value={contact.status}
            disabled={busy}
            onChange={(e) => onSaveStatus(e.target.value as OutreachStatus)}
            className={`rounded-md border border-transparent px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] outline-none ring-neutral-400 focus:ring-2 ${STATUS_STYLES[contact.status]}`}
          >
            {OUTREACH_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </td>
        <td className="px-4 py-3 align-top text-neutral-600 dark:text-neutral-400">
          {contact.profession ?? "—"}
        </td>
        <td className="px-4 py-3 align-top">
          <button
            type="button"
            onClick={onToggle}
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600 underline-offset-2 hover:underline dark:text-neutral-300"
          >
            {expanded ? "Hide" : "Details"}
          </button>
        </td>
      </tr>

      {expanded ? (
        <tr className="border-b border-neutral-100 bg-neutral-50/50 dark:border-neutral-900 dark:bg-neutral-900/30">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <dl className="grid gap-3 text-xs text-neutral-700 dark:text-neutral-300 sm:grid-cols-2">
                {contact.website_url ? (
                  <div>
                    <dt className="font-semibold text-neutral-500">Website</dt>
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
                    <dt className="font-semibold text-neutral-500">Address</dt>
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
                  <dt className="font-semibold text-neutral-500">Subject sent</dt>
                  <dd>{contact.email_subject}</dd>
                </div>
              </dl>

              <label className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                  Notes (replies, follow-ups)
                </span>
                <textarea
                  defaultValue={contact.notes ?? ""}
                  rows={4}
                  disabled={busy}
                  onBlur={(e) => {
                    const next = e.target.value;
                    if (next === (contact.notes ?? "")) return;
                    onSaveNotes(next);
                  }}
                  className="resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-[13px] text-neutral-900 outline-none ring-neutral-400 transition focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50"
                />
              </label>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
