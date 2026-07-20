import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { webSearchCandidates } from "@/lib/parseLink";
import type { EntryType } from "@/lib/parseLink";

// One of two independent search sources (the other is /api/search/wikidata)
// - see that route's comment for why they're separate handlers.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { query, category, location, date } = (await request.json()) as {
    query?: string;
    category?: EntryType;
    location?: string;
    date?: string;
  };
  if (!query || !category) {
    return NextResponse.json({ error: "Missing query or category" }, { status: 400 });
  }

  try {
    const candidates = await webSearchCandidates(query, category, { location, date });
    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("search/web failed", err);
    return NextResponse.json({ error: "Could not search for that" }, { status: 502 });
  }
}
