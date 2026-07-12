"use client";

import { createBrowserClient } from "@supabase/ssr";

// Client-side Supabase instance. Safe to use the anon key here: it's
// public by design, real access control lives in the RLS policies in
// supabase/schema.sql, not in keeping this key secret.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
