import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSystemLists } from "@/lib/systemLists";
import ListBoard from "@/components/ListBoard";
import AddToListsButton from "@/components/AddToListsButton";

// Auth is enforced once by the shared (app)/layout.tsx, not re-checked here.
export default async function ListDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: list } = await supabase.from("lists").select("*").eq("slug", slug).single();
  if (!list) notFound();

  const systemLists = await getSystemLists(supabase);

  const { data: profile } = await supabase.from("profiles").select("city").eq("id", user.id).single();

  const { data: items } = await supabase
    .from("list_items")
    .select("id, entry:entries(id, title, subtitle, image_url, source_url, external_id)")
    .eq("list_id", list.id);

  const { data: allVotes } = await supabase
    .from("votes")
    .select("list_item_id, rank, user_id");

  // Community ranking: average rank across every vote ever cast for each
  // item (simplified for the MVP, no weekly lock/aggregation window yet).
  const rankSums = new Map<string, { sum: number; count: number }>();
  for (const v of allVotes ?? []) {
    const cur = rankSums.get(v.list_item_id) ?? { sum: 0, count: 0 };
    cur.sum += v.rank;
    cur.count += 1;
    rankSums.set(v.list_item_id, cur);
  }

  const myVotes = (allVotes ?? [])
    .filter((v) => v.user_id === user.id)
    .sort((a, b) => a.rank - b.rank)
    .map((v) => v.list_item_id);

  const enrichedItems = (items ?? []).map((item) => {
    const stats = rankSums.get(item.id);
    return {
      id: item.id,
      entry: Array.isArray(item.entry) ? item.entry[0] : item.entry,
      avgRank: stats ? stats.sum / stats.count : null,
      voteCount: stats?.count ?? 0,
    };
  });

  enrichedItems.sort((a, b) => {
    if (a.avgRank === null && b.avgRank === null) return 0;
    if (a.avgRank === null) return 1;
    if (b.avgRank === null) return -1;
    return a.avgRank - b.avgRank;
  });

  return (
    <>
      <ListBoard
        list={{ slug: list.slug, name: list.name, type: list.type }}
        items={enrichedItems}
        myOrder={myVotes}
        homeCity={profile?.city ?? "Tampa"}
      />
      <AddToListsButton
        systemLists={systemLists}
        listContext={{ slug: list.slug, name: list.name, type: list.type }}
      />
    </>
  );
}
