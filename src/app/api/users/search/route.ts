import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The real discovery mechanism for follow/unfollow this session (no user
// directory, no "added by" links anywhere - system lists stay
// unattributed publicly, per instruction). Partial, case-insensitive match
// on username only.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });

  const { data } = await supabase
    .from("profiles")
    .select("username, city")
    .not("username", "is", null)
    .ilike("username", `%${q}%`)
    .limit(10);

  return NextResponse.json({ results: data ?? [] });
}
