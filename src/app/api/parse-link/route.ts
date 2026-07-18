import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseLink, parseEventQuery, type EntryType } from "@/lib/parseLink";

// Step 1 of adding something to a list: parse the shared URL (or, for
// Events only, a typed free-text description with no link at all) into
// structured fields and hand them back for the user to confirm. Nothing is
// written to the database yet, that happens in /api/entries once approved.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { url, query, hintType } = (await request.json()) as {
    url?: string;
    query?: string;
    hintType?: EntryType;
  };
  if (!url && !query) return NextResponse.json({ error: "Missing url or query" }, { status: 400 });

  try {
    if (query) {
      // Typed-text resolution only exists for Events right now (web search,
      // no direct API) - other categories still need a real link.
      if (hintType !== "event") {
        return NextResponse.json(
          { error: "Typed search is only available for Events right now" },
          { status: 400 }
        );
      }
      const parsed = await parseEventQuery(query);
      return NextResponse.json({ parsed, sourceUrl: null });
    }

    const parsed = await parseLink(url!, hintType);
    return NextResponse.json({ parsed, sourceUrl: url });
  } catch (err) {
    console.error("parse-link failed", err);
    return NextResponse.json({ error: "Could not read that link" }, { status: 422 });
  }
}
