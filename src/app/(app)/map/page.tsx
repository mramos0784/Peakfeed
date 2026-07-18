import { createClient } from "@/lib/supabase/server";
import { getSystemLists } from "@/lib/systemLists";
import AddToListsButton from "@/components/AddToListsButton";
import MapView from "@/components/MapView";

// A reasonably-scoped real map, not the full master-doc feature set: no
// bounding-box live re-aggregation, no subscribed/suggested-lists dropdown,
// no vote-day notification strip, no three-item action sheet. Just real
// pins from real resolved coordinates - see docs/adr/0007 for what's
// deliberately deferred and why.
export default async function MapPage() {
  const supabase = await createClient();
  const systemLists = await getSystemLists(supabase);

  const { data: entries } = await supabase
    .from("entries")
    .select("id, title, subtitle, type, latitude, longitude")
    .in("type", ["restaurant", "venue", "event"])
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  return (
    <>
      <MapView entries={entries ?? []} />
      <AddToListsButton systemLists={systemLists} />
    </>
  );
}
