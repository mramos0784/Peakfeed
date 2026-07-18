import type { SupabaseClient } from "@supabase/supabase-js";

export type SystemList = { slug: string; name: string; type: string };

// The live set of system lists, queried fresh rather than hardcoded so it
// never drifts from what's actually seeded in the `lists` table.
export async function getSystemLists(supabase: SupabaseClient): Promise<SystemList[]> {
  const { data } = await supabase
    .from("lists")
    .select("slug, name, type")
    .eq("list_kind", "system")
    .order("name");
  return data ?? [];
}
