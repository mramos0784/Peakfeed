import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseLink, type EntryType } from "@/lib/parseLink";

// Step 1 of adding something to a list: parse the shared URL into structured
// fields and hand them back for the user to confirm. Nothing is written to
// the database yet, that happens in /api/entries once the user approves it.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { url, hintType } = (await request.json()) as { url?: string; hintType?: EntryType };
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  try {
    const parsed = await parseLink(url, hintType);
    return NextResponse.json({ parsed, sourceUrl: url });
  } catch (err) {
    console.error("parse-link failed", err);
    return NextResponse.json({ error: "Could not read that link" }, { status: 422 });
  }
}
