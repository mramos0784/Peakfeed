import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isVoteWeekend } from "@/lib/voteWeek";
import AppShell from "@/components/AppShell";

// Shared chrome (header + bottom nav) for every authenticated screen:
// Map, Lists, Vote Day, Feed, Profile. Centralizes the auth check that
// used to be duplicated in each page under here.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();

  const initials = (profile?.username ?? user.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <AppShell initials={initials} voteWeekend={isVoteWeekend()}>
      {children}
    </AppShell>
  );
}
