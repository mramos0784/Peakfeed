import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Follow/unfollow (Master Product Data section 8): unlimited, one tap, no
// approval step - so this is the entire model, a single insert/delete on
// the follows join row, no request/accept state machine to manage.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { followedId } = (await request.json()) as { followedId?: string };
  if (!followedId) return NextResponse.json({ error: "Missing followedId" }, { status: 400 });
  if (followedId === user.id) return NextResponse.json({ error: "Can't follow yourself" }, { status: 400 });

  // Composite primary key on follows means a repeat follow just upserts
  // onto the same row instead of erroring - "already following" is a
  // no-op success, not a special case the client needs to handle.
  const { error } = await supabase
    .from("follows")
    .upsert({ follower_id: user.id, followed_id: followedId }, { onConflict: "follower_id,followed_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { followedId } = (await request.json()) as { followedId?: string };
  if (!followedId) return NextResponse.json({ error: "Missing followedId" }, { status: 400 });

  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", user.id)
    .eq("followed_id", followedId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
