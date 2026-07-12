"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/lists");
    router.refresh();
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-xl p-6 shadow-sm border border-black/5">
        <h1 className="font-display text-4xl mb-1" style={{ color: "var(--rust)" }}>PEAKFEED</h1>
        <p className="text-sm opacity-60 mb-6">Log in to vote.</p>
        <input
          type="email" required placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded-md px-3 py-2 mb-3 text-sm"
        />
        <input
          type="password" required placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded-md px-3 py-2 mb-3 text-sm"
        />
        {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
        <button
          disabled={loading}
          className="w-full font-display text-lg tracking-wide rounded-md py-2 text-white"
          style={{ background: "var(--rust)" }}
        >
          {loading ? "Logging in..." : "Log in"}
        </button>
        <p className="text-xs text-center mt-4 opacity-60">
          No account? <Link href="/signup" className="underline">Sign up</Link>
        </p>
      </form>
    </div>
  );
}
