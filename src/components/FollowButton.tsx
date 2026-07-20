"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FollowButton({
  targetUserId,
  initiallyFollowing,
}: {
  targetUserId: string;
  initiallyFollowing: boolean;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initiallyFollowing);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    try {
      const res = await fetch("/api/follows", {
        method: following ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followedId: targetUserId }),
      });
      if (res.ok) {
        setFollowing(!following);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className="text-xs px-4 py-1.5 rounded-full font-medium disabled:opacity-50"
      style={
        following
          ? { background: "transparent", border: "1px solid var(--mist-dark)", color: "var(--mist)" }
          : { background: "var(--mist)", color: "var(--rust)" }
      }
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}
