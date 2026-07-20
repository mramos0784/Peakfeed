import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The "Report" action on the universal action menu - capture reliably now,
// no triage/dashboard/notification workflow yet (deferred on purpose, see
// docs/prelaunch-checklist.md). Just an insert; `reports` has no select
// policy for any signed-in user, including the reporter themselves.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { entryId, reason } = (await request.json()) as { entryId?: string; reason?: string | null };
  if (!entryId) return NextResponse.json({ error: "Missing entryId" }, { status: 400 });

  const { error } = await supabase
    .from("reports")
    .insert({ entry_id: entryId, reporter_id: user.id, reason: reason?.trim() || null });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
