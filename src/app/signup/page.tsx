"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 text-center">
        <div>
          <h1 className="font-display text-3xl mb-2" style={{ color: "var(--rust)" }}>Check your email</h1>
          <p className="text-sm opacity-70">Confirm your address, then <Link href="/login" className="underline">log in</Link>.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-xl p-6 shadow-sm border border-black/5">
        <h1 className="font-display text-4xl mb-1" style={{ color: "var(--rust)" }}>PEAKFEED</h1>
        <p className="text-sm opacity-60 mb-6">Create an account.</p>
        <input
          type="email" required placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded-md px-3 py-2 mb-3 text-sm"
        />
        <input
          type="password" required minLength={6} placeholder="Password (min 6 characters)" value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded-md px-3 py-2 mb-3 text-sm"
        />
        {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
        <button
          disabled={loading}
          className="w-full font-display text-lg tracking-wide rounded-md py-2 text-white"
          style={{ background: "var(--rust)" }}
        >
          {loading ? "Creating..." : "Sign up"}
        </button>
        <p className="text-xs text-center mt-4 opacity-60">
          Already have an account? <Link href="/login" className="underline">Log in</Link>
        </p>
      </form>
    </div>
  );
}
