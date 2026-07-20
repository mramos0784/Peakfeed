import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Removes an entry from a list entirely - the "delete" action in either of
// the Lists screen's two zones (ADR 0010). Only ever touches list_items,
// the join row for this entry's membership in this specific list, never
// entries itself: the same entry may sit in other lists' list_items rows
// (other users' shares, future personal/group lists), and entries has no
// column referencing list_items to even cascade through by accident.
//
// RLS (auth.uid() = added_by, schema.sql) is the actual enforcement, not
// this handler - a delete() call that matches zero rows (wrong id, or a
// row someone else added) just succeeds with no rows affected rather than
// erroring, so this can't be used to probe which ids exist.
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { listItemId } = (await request.json()) as { listItemId?: string };
  if (!listItemId) return NextResponse.json({ error: "Missing listItemId" }, { status: 400 });

  const { error } = await supabase.from("list_items").delete().eq("id", listItemId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
