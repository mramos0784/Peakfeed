import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentWeekOf } from "@/lib/voteWeek";

// Submit a user's ranked order for a list: an ordered array of list_item_ids,
// position in the array = rank. Replaces whatever they submitted earlier
// this week, so re-voting before the week closes just overwrites.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { listSlug, orderedListItemIds } = (await request.json()) as {
    listSlug: string;
    orderedListItemIds: string[];
  };

  const { data: list } = await supabase.from("lists").select("id").eq("slug", listSlug).single();
  if (!list) return NextResponse.json({ error: "Unknown list" }, { status: 400 });

  const weekOf = currentWeekOf();

  await supabase
    .from("votes")
    .delete()
    .eq("list_id", list.id)
    .eq("user_id", user.id)
    .eq("week_of", weekOf);

  const rows = orderedListItemIds.map((listItemId, i) => ({
    list_id: list.id,
    user_id: user.id,
    list_item_id: listItemId,
    rank: i + 1,
    week_of: weekOf,
  }));

  const { error } = await supabase.from("votes").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, weekOf });
}
