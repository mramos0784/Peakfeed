import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchWikidata, searchWikidataByHandle } from "@/lib/wikidataSearch";
import type { EntryType, SearchCandidate } from "@/lib/parseLink";

// Fuzzy name search (wbsearchentities) for Films/Events/Issues.
const FUZZY_CATEGORIES: EntryType[] = ["movie", "event", "issue"];
// Exact handle-property SPARQL match (P2002/P2003/P7085/P2397) for the four
// Creator types, per api-integrations-addendum.md - a different mechanism
// than fuzzy name search, see wikidataSearch.ts.
const HANDLE_CATEGORIES: EntryType[] = [
  "x_creator", "instagram_creator", "tiktok_creator", "youtube_creator",
];

// One of two independent search sources (the other is /api/search/web) -
// deliberately separate route handlers so the client can fire both in
// parallel and let each populate its own section of the results list the
// moment it resolves, instead of waiting for the slower of the two.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { query, category } = (await request.json()) as { query?: string; category?: EntryType };
  if (!query || !category) {
    return NextResponse.json({ error: "Missing query or category" }, { status: 400 });
  }

  let results;
  if (FUZZY_CATEGORIES.includes(category)) {
    results = await searchWikidata(query, category);
  } else if (HANDLE_CATEGORIES.includes(category)) {
    results = await searchWikidataByHandle(query, category);
  } else {
    // Not an error - just nothing this source can offer for this category.
    return NextResponse.json({ candidates: [] });
  }

  const candidates: SearchCandidate[] = results.map((r) => ({
    category: r.category,
    title: r.label,
    subtitle: r.description,
    image_url: null,
    external_id: `wikidata:${r.qid}`,
    provenance: "wikidata_match",
    sourceLabel: "Wikidata",
  }));

  return NextResponse.json({ candidates });
}
