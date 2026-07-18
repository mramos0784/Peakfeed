import { createClient } from "@/lib/supabase/server";
import { getSystemLists } from "@/lib/systemLists";
import ComingSoon from "@/components/ComingSoon";
import AddToListsButton from "@/components/AddToListsButton";

export default async function MapPage() {
  const supabase = await createClient();
  const systemLists = await getSystemLists(supabase);

  return (
    <>
      <ComingSoon
        title="Map"
        roadmapItem={5}
        note="A live map of Tampa Bay rankings, pins for entries with a location. Needs coordinates stored on entries first."
      />
      <AddToListsButton systemLists={systemLists} />
    </>
  );
}
