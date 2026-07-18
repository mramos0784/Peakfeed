import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for trusted, server-only background processing (the
// geocode cron route today, any future job-queue worker later). Bypasses
// RLS entirely - never import this into a user-facing route or component,
// only into cron/background handlers that never see end-user requests.
//
// Requires SUPABASE_SERVICE_ROLE_KEY, which does not exist in .env.local
// as of this change - only the anon key does. Get it from the Supabase
// project's Settings > API page and add it to .env.local, then add the
// same value in the Vercel dashboard for production.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY - see src/lib/supabase/admin.ts"
    );
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
