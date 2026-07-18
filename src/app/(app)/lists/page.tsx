import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSystemLists } from "@/lib/systemLists";
import AddToListsButton from "@/components/AddToListsButton";

// Auth is enforced once by the shared (app)/layout.tsx, not re-checked here.
export default async function ListsPage() {
  const supabase = await createClient();
  const lists = await getSystemLists(supabase);

  return (
    <div className="p-6 max-w-md mx-auto">
      <h1 className="font-display text-3xl mb-6" style={{ color: "var(--rust)" }}>MY LISTS</h1>
      <div className="space-y-2">
        {lists.map((list) => (
          <Link
            key={list.slug}
            href={`/lists/${list.slug}`}
            className="block bg-white rounded-lg px-4 py-3 border border-black/5 hover:border-black/20 transition"
          >
            <span className="font-medium">{list.name}</span>
          </Link>
        ))}
      </div>
      <AddToListsButton systemLists={lists} />
    </div>
  );
}
