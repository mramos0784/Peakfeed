import { createClient } from "@/lib/supabase/server";
import { getSystemLists } from "@/lib/systemLists";
import AddToListsButton from "@/components/AddToListsButton";
import MapView from "@/components/MapView";

// A reasonably-scoped real map, not the full master-doc feature set: no
// bounding-box live re-aggregation, no subscribed/suggested-lists dropdown,
// no vote-day notification strip. Pins now do carry the universal action
// menu (ADR 0009) - see docs/adr/0007 for what's still deliberately
// deferred beyond that.
export default async function MapPage() {
  const supabase = await createClient();
  const systemLists = await getSystemLists(supabase);

  const { data: entries } = await supabase
    .from("entries")
    .select("id, title, subtitle, type, latitude, longitude, source_url, external_id, metadata")
    .in("type", ["restaurant", "venue", "event"])
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  return (
    <>
      <MapView entries={entries ?? []} systemLists={systemLists} />
      <AddToListsButton systemLists={systemLists} />
    </>
  );
}
