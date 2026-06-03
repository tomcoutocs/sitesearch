import { NextResponse } from "next/server";

import {
  isOutreachStatus,
  type OutreachContact,
} from "@/lib/outreach-contacts";
import { createSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: Request, context: RouteContext) {
  if (!isSupabaseConfigured()) {
    return jsonError(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
      503,
    );
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return jsonError("Missing contact id", 400);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (!payload || typeof payload !== "object") {
    return jsonError("Invalid JSON body", 400);
  }

  const body = payload as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  if ("status" in body) {
    if (!isOutreachStatus(body.status)) {
      return jsonError("status must be contacted, replied, or closed", 400);
    }
    updates.status = body.status;
  }

  if ("notes" in body) {
    if (body.notes !== null && typeof body.notes !== "string") {
      return jsonError("notes must be a string or null", 400);
    }
    updates.notes =
      typeof body.notes === "string" ? body.notes.trim() || null : null;
  }

  if (!Object.keys(updates).length) {
    return jsonError("Send { status? } and/or { notes? }", 400);
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return jsonError("Supabase client could not be created", 500);
  }

  const { data, error } = await supabase
    .from("outreach_contacts")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    return jsonError(error.message, 500);
  }

  if (!data) {
    return jsonError("Contact not found", 404);
  }

  return NextResponse.json({ contact: data as OutreachContact });
}
