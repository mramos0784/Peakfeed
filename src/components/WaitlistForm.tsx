"use client";

import { useState } from "react";

const INTERESTS = [
  {
    key: "series_location",
    label: "PeakFeed Series — I can offer a location",
    helper: "Own or run a space in Tampa Bay? Offer it for a future episode.",
  },
  {
    key: "series_featured",
    label: "PeakFeed Series — I want to be featured",
    helper: "Have something to say on camera for an episode?",
  },
  {
    key: "app_early_access",
    label: "The App — I want early access",
    helper: "Get in when the app opens for testing.",
  },
] as const;

export default function WaitlistForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function toggleInterest(key: string) {
    setInterests((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (interests.length === 0) {
      setError("Pick at least one option below.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, city, interests }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="wl-form-card wl-form-done">
        <p className="font-display text-2xl" style={{ color: "var(--rust)" }}>You&apos;re on the list</p>
        <p className="text-sm opacity-70 mt-1">We&apos;ll reach out at {email}.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="wl-form-card">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        placeholder="Your name"
        className="wl-input"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        placeholder="Email address"
        className="wl-input"
      />
      <input
        value={city}
        onChange={(e) => setCity(e.target.value)}
        required
        placeholder="City"
        className="wl-input"
      />

      <div className="wl-checks">
        {INTERESTS.map((item) => (
          <label key={item.key} className="wl-check-row">
            <input
              type="checkbox"
              checked={interests.includes(item.key)}
              onChange={() => toggleInterest(item.key)}
            />
            <span>
              <span className="wl-check-label">{item.label}</span>
              <span className="wl-check-helper">{item.helper}</span>
            </span>
          </label>
        ))}
      </div>

      {error && <p className="wl-error">{error}</p>}

      <button type="submit" disabled={submitting || interests.length === 0} className="wl-submit">
        {submitting ? "Joining..." : "Join the waitlist"}
      </button>
    </form>
  );
}
