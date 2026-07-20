import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSystemLists } from "@/lib/systemLists";
import EntryActionMenu from "@/components/EntryActionMenu";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const systemLists = await getSystemLists(supabase);

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, city, created_at")
    .eq("id", user.id)
    .single();

  const { data: rawVotes } = await supabase
    .from("votes")
    .select(
      "rank, week_of, list:lists(name), list_item:list_items(entry:entries(id, type, title, subtitle, source_url, external_id, metadata))"
    )
    .eq("user_id", user.id)
    .order("week_of", { ascending: false })
    .order("rank", { ascending: true })
    .limit(20);

  // Nested to-one relations come back as an object or a single-element array
  // depending on how Supabase resolves the FK; normalize either shape.
  const votes = (rawVotes ?? []).map((v) => {
    const list = Array.isArray(v.list) ? v.list[0] : v.list;
    const listItem = Array.isArray(v.list_item) ? v.list_item[0] : v.list_item;
    const entry = listItem && (Array.isArray(listItem.entry) ? listItem.entry[0] : listItem.entry);
    return { rank: v.rank, week_of: v.week_of, listName: list?.name, entry };
  });

  const username = profile?.username ?? user.email?.split("@")[0] ?? "you";
  const initials = username.slice(0, 2).toUpperCase();
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  return (
    <div className="min-h-full">
      <div className="px-6 pt-8 pb-6" style={{ background: "var(--rust)" }}>
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center font-display text-xl"
            style={{ background: "var(--rust-mid)", color: "var(--mist)" }}
          >
            {initials}
          </div>
          <div>
            <p className="text-base font-medium" style={{ color: "var(--mist)" }}>@{username}</p>
            <p className="text-xs opacity-70" style={{ color: "var(--mist-dark)" }}>
              {profile?.city ?? "Tampa"}
              {memberSince && ` · Member since ${memberSince}`}
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-md mx-auto">
        <h2 className="text-xs uppercase tracking-wide opacity-50 mb-2">Recent votes</h2>
        <div className="space-y-1 mb-8">
          {votes.map((v, i) => (
            <div
              key={i}
              className="flex items-center gap-2 bg-white rounded-md px-3 py-2 border border-black/5"
            >
              <span className="font-display text-lg w-6 text-center" style={{ color: "var(--rust)", opacity: 0.4 }}>
                {v.rank}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{v.entry?.title ?? "Untitled entry"}</p>
                <p className="text-xs opacity-50 truncate">{v.listName} · week of {v.week_of}</p>
              </div>
              {v.entry && <EntryActionMenu entry={v.entry} systemLists={systemLists} />}
            </div>
          ))}
          {votes.length === 0 && (
            <p className="text-sm opacity-50">No votes yet — head to Lists and submit a top ten.</p>
          )}
        </div>

        <form action="/api/auth/signout" method="post">
          <button className="text-xs opacity-50 underline">Log out</button>
        </form>
      </div>
    </div>
  );
}
