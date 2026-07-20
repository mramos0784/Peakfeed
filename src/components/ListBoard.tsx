"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import InListSearchForm from "@/components/InListSearchForm";
import EntryActionMenu from "@/components/EntryActionMenu";
import type { SystemList } from "@/lib/systemLists";

type Entry = {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  source_url: string | null;
  external_id: string | null;
  metadata?: { sources?: { url: string; title: string }[] } | null;
};

type Item = {
  id: string; // list_item_id
  entry: Entry;
  avgRank: number | null;
  voteCount: number;
};

type ParsedPreview = {
  type: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  external_id: string | null;
  confidence: "high" | "medium" | "low";
  source: string;
};

export default function ListBoard({
  list,
  items,
  myOrder,
  homeCity,
  systemLists,
}: {
  list: { slug: string; name: string; type: string };
  items: Item[];
  myOrder: string[];
  homeCity: string;
  systemLists: SystemList[];
}) {
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ sourceUrl: string; parsed: ParsedPreview } | null>(null);
  const [saving, setSaving] = useState(false);

  // Personal ranking order: start from the user's saved vote, then append
  // any items they haven't ranked yet (community order) so nothing's hidden.
  const initialOrder = useMemo(() => {
    const rest = items.map((i) => i.id).filter((id) => !myOrder.includes(id));
    return [...myOrder.filter((id) => items.some((i) => i.id === id)), ...rest];
  }, [items, myOrder]);
  const [order, setOrder] = useState<string[]>(initialOrder);
  const [voteSaved, setVoteSaved] = useState(false);
  const [voting, setVoting] = useState(false);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  async function handleParse(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setParsing(true);
    setParseError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/parse-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), hintType: list.type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setParseError(data.error ?? "Could not read that link");
        return;
      }
      setPreview(data);
    } finally {
      setParsing(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setSaving(true);
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listSlug: list.slug,
          type: preview.parsed.type,
          title: preview.parsed.title,
          subtitle: preview.parsed.subtitle,
          image_url: preview.parsed.image_url,
          source_url: preview.sourceUrl,
          external_id: preview.parsed.external_id,
        }),
      });
      if (res.ok) {
        setPreview(null);
        setUrl("");
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  function move(index: number, dir: -1 | 1) {
    setOrder((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setVoteSaved(false);
  }

  async function submitVote() {
    setVoting(true);
    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listSlug: list.slug, orderedListItemIds: order }),
      });
      if (res.ok) {
        setVoteSaved(true);
        router.refresh();
      }
    } finally {
      setVoting(false);
    }
  }

  async function share() {
    const shareUrl = typeof window !== "undefined" ? window.location.href : "";
    const text = `My ${list.name} ranking on PeakFeed`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "PeakFeed", text, url: shareUrl });
      } catch {
        // user cancelled, ignore
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      alert("Link copied");
    }
  }

  return (
    <div className="min-h-dvh p-6 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/lists" className="text-xs opacity-50">&larr; My lists</Link>
          <h1 className="font-display text-3xl" style={{ color: "var(--rust)" }}>{list.name.toUpperCase()}</h1>
        </div>
        <button onClick={share} className="text-xs px-3 py-1.5 rounded-full text-white" style={{ background: "var(--rust)" }}>
          Share
        </button>
      </div>

      <form onSubmit={handleParse} className="mb-4 bg-white rounded-lg p-3 border border-black/5">
        <label className="text-[10px] uppercase tracking-wide opacity-50 block mb-1">Share a link to add it</label>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a Spotify, Google Maps, or Instagram link"
            className="flex-1 border rounded-md px-2 py-1.5 text-sm"
          />
          <button
            disabled={parsing}
            className="text-sm px-3 py-1.5 rounded-md text-white shrink-0"
            style={{ background: "var(--slate)" }}
          >
            {parsing ? "Reading..." : "Add"}
          </button>
        </div>
        {parseError && <p className="text-red-600 text-xs mt-2">{parseError}</p>}
      </form>

      <InListSearchForm list={list} homeCity={homeCity} />

      {preview && (
        <div className="mb-4 bg-white rounded-lg p-3 border-2" style={{ borderColor: "var(--sage)" }}>
          <p className="text-[10px] uppercase tracking-wide opacity-50 mb-2">
            Confirm this entry &middot; {preview.parsed.confidence} confidence
          </p>
          <input
            value={preview.parsed.title}
            onChange={(e) => setPreview({ ...preview, parsed: { ...preview.parsed, title: e.target.value } })}
            className="w-full border rounded-md px-2 py-1.5 text-sm mb-2 font-medium"
          />
          <input
            value={preview.parsed.subtitle ?? ""}
            onChange={(e) => setPreview({ ...preview, parsed: { ...preview.parsed, subtitle: e.target.value } })}
            placeholder="Artist / location / year"
            className="w-full border rounded-md px-2 py-1.5 text-sm mb-3 opacity-70"
          />
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="flex-1 text-sm py-1.5 rounded-md text-white"
              style={{ background: "var(--rust)" }}
            >
              {saving ? "Saving..." : "Looks right, add it"}
            </button>
            <button onClick={() => setPreview(null)} className="text-sm px-3 py-1.5 rounded-md border">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-xs uppercase tracking-wide opacity-50 mb-2">Your ranking, drag order with the arrows</h2>
        <div className="space-y-1">
          {order.map((id, i) => {
            const item = itemsById.get(id);
            if (!item) return null;
            return (
              <div key={id} className="flex items-center gap-2 bg-white rounded-md px-2 py-2 border border-black/5">
                <span className="font-display text-lg w-6 text-center opacity-30">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.entry.title}</p>
                  {item.entry.subtitle && <p className="text-xs opacity-50 truncate">{item.entry.subtitle}</p>}
                </div>
                <EntryActionMenu entry={item.entry} systemLists={systemLists} />
                <button onClick={() => move(i, -1)} className="px-1.5 opacity-50 hover:opacity-100">&uarr;</button>
                <button onClick={() => move(i, 1)} className="px-1.5 opacity-50 hover:opacity-100">&darr;</button>
              </div>
            );
          })}
          {order.length === 0 && <p className="text-sm opacity-50">Add something above to start ranking.</p>}
        </div>
        {order.length > 0 && (
          <button
            onClick={submitVote}
            disabled={voting}
            className="w-full mt-3 font-display text-lg tracking-wide rounded-md py-2 text-white"
            style={{ background: "var(--rust)" }}
          >
            {voting ? "Submitting..." : voteSaved ? "Vote saved ✓" : "Submit to vote"}
          </button>
        )}
      </div>

      <div>
        <h2 className="text-xs uppercase tracking-wide opacity-50 mb-2">Tampa community ranking</h2>
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={item.id} className="flex items-center gap-2 bg-white rounded-md px-2 py-2 border border-black/5">
              <span className="font-display text-lg w-6 text-center" style={{ color: "var(--rust)", opacity: 0.4 }}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.entry.title}</p>
                {item.entry.subtitle && <p className="text-xs opacity-50 truncate">{item.entry.subtitle}</p>}
              </div>
              <span className="text-[10px] opacity-40 shrink-0">{item.voteCount} vote{item.voteCount === 1 ? "" : "s"}</span>
              <EntryActionMenu entry={item.entry} systemLists={systemLists} />
            </div>
          ))}
          {items.length === 0 && <p className="text-sm opacity-50">No entries yet, be the first to add one.</p>}
        </div>
      </div>
    </div>
  );
}
