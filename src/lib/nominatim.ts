import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeForDedup } from "@/lib/normalize";

// OSM's public Nominatim instance requires a valid custom User-Agent
// identifying the application - "stock User-Agents as set by http
// libraries will not do" per their usage policy
// (operations.osmfoundation.org/policies/nominatim). Reuses the same
// PeakFeedBot identity already used elsewhere in this codebase.
const NOMINATIM_UA = "PeakFeedBot/0.1 (+https://peakfeed.app)";

export type GeocodeResult = { latitude: number; longitude: number } | null;
export type GeocodeOutcome = { result: GeocodeResult; fromCache: boolean };

// Nominatim's policy requires caching results, and this is also what keeps
// repeat lookups for the same city/address from ever re-spending the tight
// budget (4 requests/minute for a recurring script - see the cron route).
// Negative results are cached too, so a confirmed-unfindable address isn't
// re-queried by every subsequent retry. `fromCache` lets the caller only
// pace (sleep) around real Nominatim requests, not cache hits - with one
// cron invocation a day, every real request against the budget counts.
export async function geocode(
  supabaseAdmin: SupabaseClient,
  query: string
): Promise<GeocodeOutcome> {
  const queryKey = normalizeForDedup(query);

  const { data: cached } = await supabaseAdmin
    .from("geocode_cache")
    .select("latitude, longitude, resolved")
    .eq("query_key", queryKey)
    .maybeSingle();

  if (cached) {
    return {
      result: cached.resolved ? { latitude: cached.latitude, longitude: cached.longitude } : null,
      fromCache: true,
    };
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": NOMINATIM_UA },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    // A transient/HTTP-level failure, not "confirmed not found" - don't
    // cache this, so a later retry actually re-checks Nominatim instead of
    // treating a network hiccup as a permanent negative result.
    throw new Error(`Nominatim request failed: ${res.status}`);
  }

  const results: { lat: string; lon: string }[] = await res.json();
  const top = results[0];

  if (!top) {
    await supabaseAdmin.from("geocode_cache").insert({
      query_key: queryKey,
      resolved: false,
    });
    return { result: null, fromCache: false };
  }

  const latitude = Number(top.lat);
  const longitude = Number(top.lon);
  await supabaseAdmin.from("geocode_cache").insert({
    query_key: queryKey,
    latitude,
    longitude,
    resolved: true,
  });
  return { result: { latitude, longitude }, fromCache: false };
}
