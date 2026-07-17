import { NextResponse } from "next/server";

const VALID_INTERESTS = ["series_location", "series_featured", "app_early_access"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Forwards waitlist signups to the Google Apps Script Web App at
// WAITLIST_SCRIPT_URL (server-only env var — never sent to the client).
// The form calls this route, not the script URL directly, so the URL
// never appears in the browser bundle or network tab.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { name, email, city, interests } = body ?? {};

  if (
    typeof name !== "string" || !name.trim() ||
    typeof email !== "string" || !EMAIL_RE.test(email) ||
    typeof city !== "string" || !city.trim() ||
    !Array.isArray(interests) || interests.length === 0 ||
    !interests.every((i) => VALID_INTERESTS.includes(i))
  ) {
    return NextResponse.json({ error: "Please fill in every field and pick at least one option." }, { status: 400 });
  }

  const scriptUrl = process.env.WAITLIST_SCRIPT_URL;
  if (!scriptUrl) {
    return NextResponse.json({ error: "Waitlist isn't configured yet — try again later." }, { status: 500 });
  }

  try {
    const res = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), email: email.trim(), city: city.trim(), interests }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Could not reach the waitlist service. Please try again." }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ error: "Could not reach the waitlist service. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
