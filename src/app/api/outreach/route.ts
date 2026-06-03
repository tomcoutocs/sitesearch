import { NextResponse } from "next/server";

import {
  normalizeOutreachEmail,
  type OutreachContact,
  type RecordOutreachInput,
} from "@/lib/outreach-contacts";
import { createSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function parseRecordInput(payload: unknown): RecordOutreachInput | null {
  if (!payload || typeof payload !== "object") return null;

  const body = payload as Record<string, unknown>;
  const companyRaw = body.company;

  if (!companyRaw || typeof companyRaw !== "object") return null;

  const company = companyRaw as Record<string, unknown>;
  const email =
    typeof company.email === "string" ? company.email.trim() : "";
  const name = typeof company.name === "string" ? company.name.trim() : "";

  const emailSubject =
    typeof body.emailSubject === "string" ? body.emailSubject.trim() : "";
  const emailBody =
    typeof body.emailBody === "string" ? body.emailBody.trim() : "";

  if (!email.includes("@") || !name || !emailSubject || !emailBody) {
    return null;
  }

  return {
    company: {
      placeResourceName:
        typeof company.placeResourceName === "string"
          ? company.placeResourceName
          : "",
      name,
      email,
      phone:
        typeof company.phone === "string" ? company.phone.trim() || null : null,
      websiteUrl:
        typeof company.websiteUrl === "string"
          ? company.websiteUrl.trim() || null
          : null,
      address:
        typeof company.address === "string" ? company.address.trim() : "",
      emailSource:
        typeof company.emailSource === "string"
          ? company.emailSource.trim() || null
          : null,
    },
    profession:
      typeof body.profession === "string" ? body.profession.trim() : undefined,
    searchCorridor:
      typeof body.searchCorridor === "string"
        ? body.searchCorridor.trim()
        : undefined,
    radiusMiles:
      typeof body.radiusMiles === "number" && Number.isFinite(body.radiusMiles)
        ? Math.round(body.radiusMiles)
        : undefined,
    emailSubject,
    emailBody,
  };
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      configured: false,
      contacts: [] as OutreachContact[],
    });
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return jsonError("Supabase client could not be created", 500);
  }

  const { data, error } = await supabase
    .from("outreach_contacts")
    .select("*")
    .order("emailed_at", { ascending: false });

  if (error) {
    return jsonError(error.message, 500);
  }

  return NextResponse.json({
    configured: true,
    contacts: (data ?? []) as OutreachContact[],
  });
}

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return jsonError(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
      503,
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const input = parseRecordInput(payload);
  if (!input) {
    return jsonError(
      "Send { company: { name, email, ... }, emailSubject, emailBody }",
      400,
    );
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return jsonError("Supabase client could not be created", 500);
  }

  const emailNormalized = normalizeOutreachEmail(input.company.email!);

  const { data: existing, error: existingError } = await supabase
    .from("outreach_contacts")
    .select("*")
    .eq("email_normalized", emailNormalized)
    .maybeSingle();

  if (existingError) {
    return jsonError(existingError.message, 500);
  }

  if (existing) {
    return NextResponse.json(
      {
        error: "This email was already contacted",
        contact: existing as OutreachContact,
      },
      { status: 409 },
    );
  }

  const row = {
    email: input.company.email!.trim(),
    email_normalized: emailNormalized,
    place_resource_name: input.company.placeResourceName || null,
    company_name: input.company.name,
    phone: input.company.phone,
    website_url: input.company.websiteUrl,
    address: input.company.address,
    email_source: input.company.emailSource,
    profession: input.profession ?? null,
    search_corridor: input.searchCorridor ?? null,
    radius_miles: input.radiusMiles ?? null,
    email_subject: input.emailSubject,
    email_body: input.emailBody,
  };

  const { data, error } = await supabase
    .from("outreach_contacts")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return jsonError("This email was already contacted", 409);
    }
    return jsonError(error.message, 500);
  }

  return NextResponse.json({ contact: data as OutreachContact }, { status: 201 });
}
