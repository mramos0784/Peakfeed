import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function ListsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: lists } = await supabase
    .from("lists")
    .select("slug, name, type")
    .eq("list_kind", "system")
    .order("name");

  return (
    <div className="min-h-dvh p-6 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl" style={{ color: "var(--rust)" }}>MY LISTS</h1>
        <form action="/api/auth/signout" method="post">
          <button className="text-xs opacity-50 underline">Log out</button>
        </form>
      </div>
      <div className="space-y-2">
        {(lists ?? []).map((list) => (
          <Link
            key={list.slug}
            href={`/lists/${list.slug}`}
            className="block bg-white rounded-lg px-4 py-3 border border-black/5 hover:border-black/20 transition"
          >
            <span className="font-medium">{list.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
