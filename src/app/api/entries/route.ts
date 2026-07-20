import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tokenOverlap } from "@/lib/parseLink";
import { songDedupKey, placeDedupKey } from "@/lib/normalize";
import { enqueueJob } from "@/lib/jobs";

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
  let { external_id, provenance } = body;
  const { listSlug, type, title, subtitle, image_url, source_url, date, sources, sectionTag, sectionOtherText, entryId: existingEntryId } = body;

  const { data: list, error: listError } = await supabase
    .from("lists")
    .select("id")
    .eq("slug", listSlug)
    .single();
  if (listError || !list) {
    return NextResponse.json({ error: "Unknown list" }, { status: 400 });
  }

  // Universal action menu's "Add to list" (docs/api-integrations-addendum.md
  // section 6): the entry already exists and already carries a resolved
  // identifier, so this skips the whole dedup/create block below entirely -
  // straight to attaching the known entry to this list, no re-resolution.
  if (existingEntryId) {
    return attachToList(supabase, list.id, existingEntryId, user.id);
  }

  // No real identifier from any resolution tier (no direct catalog API
  // exists for Songs or Restaurants/Venues yet) - fall back to a
  // normalized title+artist / name+city key PeakFeed computes itself, so
  // at least some dedup happens instead of every fallback-resolved share
  // becoming its own entry forever. Tagged with its own provenance value
  // so this is visibly a best-effort match, not a verified external id.
  if (!external_id) {
    if (type === "song" && title && subtitle) {
      external_id = `internal:song:${songDedupKey(title, subtitle)}`;
      provenance = "internal_key";
    } else if ((type === "restaurant" || type === "venue") && title && subtitle) {
      external_id = `internal:${type}:${placeDedupKey(title, subtitle)}`;
      provenance = "internal_key";
    }
  }

  let entryId: string | null = null;
  let isNewEntry = false;

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
        // Closes the ADR 0005 gap: nothing wrote this column until the
        // multi-source search feature made a real provenance value
        // available on every save path, single-link resolve included
        // (mapped server-side in /api/parse-link via sourceToProvenance).
        provenance: provenance ?? null,
        created_by: user.id,
        metadata: type === "event" ? { date: date ?? null, sources: sources ?? [] } : {},
        // Issues' section tag (docs/api-integrations-addendum.md section 8):
        // a descriptive attribute of the entry, not resolution metadata, so
        // it belongs in `attributes` alongside future genre/nationality/etc
        // fields, not `metadata`. Stored as two separate keys, never
        // collapsed into one - an "Other" pick and a real tag pick must stay
        // distinguishable when the Other bucket gets reviewed later.
        attributes: type === "issue" && sectionTag ? { section_tag: sectionTag, section_other_text: sectionOtherText ?? null } : {},
      })
      .select("id")
      .single();
    if (insertError || !created) {
      return NextResponse.json({ error: insertError?.message ?? "Insert failed" }, { status: 500 });
    }
    entryId = created.id;
    isNewEntry = true;
  }

  // Entry creation is never blocked on geocoding - enqueue a job and move
  // on immediately. Only for genuinely new rows: a deduped-onto-existing
  // entry either already has a coordinate or already has a job in flight.
  // Only Restaurants/Venues/Events have a physical location to plot.
  if (isNewEntry && entryId) {
    if (type === "restaurant" || type === "venue") {
      await enqueueJob(supabase, {
        jobType: "geocode",
        entryId,
        payload: { query: subtitle ? `${title}, ${subtitle}` : title },
      });
    } else if (type === "event") {
      const venue = (subtitle ?? "").split(" · ")[0]?.trim();
      // Nothing to geocode without a venue name - don't enqueue a job with
      // no usable query, the entry just stays permanently off the map,
      // same as a job that tried and failed.
      if (venue) {
        await enqueueJob(supabase, {
          jobType: "geocode",
          entryId,
          payload: { query: `${venue}, Tampa, FL` },
        });
      }
    }
  }

  return attachToList(supabase, list.id, entryId!, user.id);
}

// Shared by both the resolve-and-create path above and the "Add to list"
// shortcut (existingEntryId given, resolution skipped entirely) - the last
// step is identical either way: attach a known entry_id to a list.
async function attachToList(
  supabase: Awaited<ReturnType<typeof createClient>>,
  listId: string,
  entryId: string,
  userId: string
) {
  const { data: listItem, error: listItemError } = await supabase
    .from("list_items")
    .upsert(
      { list_id: listId, entry_id: entryId, added_by: userId },
      { onConflict: "list_id,entry_id", ignoreDuplicates: true }
    )
    .select("id")
    .single();

  if (listItemError && !listItem) {
    // Row already existed (upsert + ignoreDuplicates doesn't return it); fetch it.
    const { data: existingItem } = await supabase
      .from("list_items")
      .select("id")
      .eq("list_id", listId)
      .eq("entry_id", entryId)
      .single();
    return NextResponse.json({ listItemId: existingItem?.id, entryId });
  }

  return NextResponse.json({ listItemId: listItem?.id, entryId });
}
