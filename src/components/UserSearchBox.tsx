"use client";

import { useState } from "react";
import Link from "next/link";

type UserResult = { username: string; city: string | null };

// Temporary home for username search - the real discovery mechanism for
// follow/unfollow this session (no user directory, no linked usernames
// anywhere else in the app). Moves to Feed once that screen exists;
// this session isn't blocked on that.
export default function UserSearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setResults(data.results ?? []);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mb-8">
      <h2 className="text-xs uppercase tracking-wide opacity-50 mb-2">Find people</h2>
      <form onSubmit={handleSearch} className="flex gap-2 mb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by username"
          className="flex-1 border rounded-md px-2 py-1.5 text-sm"
        />
        <button
          disabled={searching}
          className="text-sm px-3 py-1.5 rounded-md text-white shrink-0 disabled:opacity-50"
          style={{ background: "var(--slate)" }}
        >
          {searching ? "..." : "Search"}
        </button>
      </form>
      {results !== null && (
        <div className="space-y-1">
          {results.map((r) => (
            <Link
              key={r.username}
              href={`/profile/${r.username}`}
              className="block bg-white rounded-md px-3 py-2 border border-black/5 text-sm hover:border-black/20 transition"
            >
              <span className="font-medium">@{r.username}</span>
              {r.city && <span className="opacity-50 ml-2">{r.city}</span>}
            </Link>
          ))}
          {results.length === 0 && <p className="text-sm opacity-50">No matches.</p>}
        </div>
      )}
    </div>
  );
}
