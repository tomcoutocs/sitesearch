import type { CompanyRow } from "@/lib/company";

export const OUTREACH_STATUSES = ["contacted", "replied", "closed"] as const;

export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export type OutreachContact = {
  id: string;
  created_at: string;
  updated_at: string;
  emailed_at: string;
  email: string;
  email_normalized: string;
  place_resource_name: string | null;
  company_name: string;
  phone: string | null;
  website_url: string | null;
  address: string | null;
  email_source: string | null;
  profession: string | null;
  search_corridor: string | null;
  radius_miles: number | null;
  email_subject: string;
  email_body: string;
  status: OutreachStatus;
  notes: string | null;
};

export type RecordOutreachInput = {
  company: Pick<
    CompanyRow,
    | "placeResourceName"
    | "name"
    | "email"
    | "phone"
    | "websiteUrl"
    | "address"
    | "emailSource"
  >;
  profession?: string;
  searchCorridor?: string;
  radiusMiles?: number;
  emailSubject: string;
  emailBody: string;
};

export function normalizeOutreachEmail(email: string) {
  return email.trim().toLowerCase();
}

export function formatOutreachDate(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function isOutreachStatus(value: unknown): value is OutreachStatus {
  return (
    typeof value === "string" &&
    OUTREACH_STATUSES.includes(value as OutreachStatus)
  );
}
