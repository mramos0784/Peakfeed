import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchWikidata } from "@/lib/wikidataSearch";
import type { EntryType, SearchCandidate } from "@/lib/parseLink";

// Fuzzy name search only applies to Films/Events/Issues. Creator types need
// an exact handle-property SPARQL match instead (P2002/P2003/P7085/P2397,
// per api-integrations-addendum.md), a different mechanism not built yet -
// see docs/adr/0006.
const WIKIDATA_CATEGORIES: EntryType[] = ["movie", "event", "issue"];

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

  if (!WIKIDATA_CATEGORIES.includes(category)) {
    // Not an error - just nothing this source can offer for this category.
    return NextResponse.json({ candidates: [] });
  }

  const results = await searchWikidata(query, category);
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
