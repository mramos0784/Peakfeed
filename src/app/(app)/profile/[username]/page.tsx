import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FollowButton from "@/components/FollowButton";

// Any user's profile, by username - the follow/unfollow entry point.
// Deliberately thinner than the self-view /profile: no recent votes, no
// log out, nothing personal - just what Master Product Data's public
// profile fields actually call for (display name/city/streak/public
// lists/follower counts), scoped down to what's actually built (city,
// join date, follower/following counts; streak and public lists are
// separate, unbuilt pieces per the last status check).
export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, city, created_at")
    .eq("username", username)
    .single();
  if (!profile) notFound();

  // Own username visited here - one canonical self-view rather than a
  // second, diverging copy of the same page.
  if (profile.id === user.id) redirect("/profile");

  const { count: followerCount } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("followed_id", profile.id);
  const { count: followingCount } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("follower_id", profile.id);

  const { data: existingFollow } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", user.id)
    .eq("followed_id", profile.id)
    .maybeSingle();

  const initials = profile.username.slice(0, 2).toUpperCase();
  const memberSince = profile.created_at
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
          <div className="flex-1 min-w-0">
            <p className="text-base font-medium" style={{ color: "var(--mist)" }}>@{profile.username}</p>
            <p className="text-xs opacity-70" style={{ color: "var(--mist-dark)" }}>
              {profile.city ?? "Tampa"}
              {memberSince && ` · Member since ${memberSince}`}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--mist)" }}>
              <span className="font-medium">{followerCount ?? 0}</span> followers
              <span className="opacity-50"> &middot; </span>
              <span className="font-medium">{followingCount ?? 0}</span> following
            </p>
          </div>
          <FollowButton targetUserId={profile.id} initiallyFollowing={!!existingFollow} />
        </div>
      </div>
    </div>
  );
}
