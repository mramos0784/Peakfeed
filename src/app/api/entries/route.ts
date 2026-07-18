import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tokenOverlap } from "@/lib/parseLink";

// Step 2: the user confirmed (or edited) the parsed fields. Insert the entry
// and attach it to the list's queue. If another user already shared the same
// external_id, entries' unique index means we land on the existing row
// instead of creating a duplicate.
//
// Events are the one exception to "no fuzzy dedup" below: the reduced
// PeakFeed Event ID (date + normalized name, see parseLink.ts) only catches
// two shares whose titles normalize identically, but a Facebook page and an
// Eventbrite listing for the same real show are unlikely to use the exact
// same words. So for events specifically, same-date entries get a fuzzy
// name comparison first - this is what actually makes "multiple sources
// collapse into one Event ID" true rather than a coincidence of wording.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json();
  const { listSlug, type, title, subtitle, image_url, source_url, external_id, date, sources } = body;

  const { data: list, error: listError } = await supabase
    .from("lists")
    .select("id")
    .eq("slug", listSlug)
    .single();
  if (listError || !list) {
    return NextResponse.json({ error: "Unknown list" }, { status: 400 });
  }

  let entryId: string | null = null;

  if (type === "event" && date) {
    const { data: candidates } = await supabase
      .from("entries")
      .select("id, title")
      .eq("type", "event")
      .eq("metadata->>date", date);
    const match = (candidates ?? []).find((c) => tokenOverlap(c.title, title) >= 0.5);
    if (match) entryId = match.id;
  }

  if (!entryId && external_id) {
    const { data: existing } = await supabase
      .from("entries")
      .select("id")
      .eq("type", type)
      .eq("external_id", external_id)
      .maybeSingle();
    if (existing) entryId = existing.id;
  }

  if (!entryId) {
    // No existing entry matched (no clean id, or a genuinely new one). We
    // don't attempt fuzzy dedup for non-event types on purpose: every share
    // becomes its own entry unless a real identifier or, for events, the
    // fuzzy check above says otherwise. Manual "merge duplicates" is a fine
    // follow-up feature once this is live.
    const { data: created, error: insertError } = await supabase
      .from("entries")
      .insert({
        type,
        title,
        subtitle,
        image_url,
        source_url,
        external_id: external_id ?? null,
        created_by: user.id,
        metadata: type === "event" ? { date: date ?? null, sources: sources ?? [] } : {},
      })
      .select("id")
      .single();
    if (insertError || !created) {
      return NextResponse.json({ error: insertError?.message ?? "Insert failed" }, { status: 500 });
    }
    entryId = created.id;
  }

  const { data: listItem, error: listItemError } = await supabase
    .from("list_items")
    .upsert(
      { list_id: list.id, entry_id: entryId, added_by: user.id },
      { onConflict: "list_id,entry_id", ignoreDuplicates: true }
    )
    .select("id")
    .single();

  if (listItemError && !listItem) {
    // Row already existed (upsert + ignoreDuplicates doesn't return it); fetch it.
    const { data: existingItem } = await supabase
      .from("list_items")
      .select("id")
      .eq("list_id", list.id)
      .eq("entry_id", entryId)
      .single();
    return NextResponse.json({ listItemId: existingItem?.id, entryId });
  }

  return NextResponse.json({ listItemId: listItem?.id, entryId });
}
