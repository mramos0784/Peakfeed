"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import InListSearchForm from "@/components/InListSearchForm";
import EntryActionMenu from "@/components/EntryActionMenu";
import type { SystemList } from "@/lib/systemLists";

const TOP_TEN_SIZE = 10;

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
  addedBy: string | null;
  createdAt: string;
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

// Which zone a drag started from doesn't matter for where it can land -
// moveItem always removes the dragged id from both arrays first, so the
// same function handles same-zone reorder and cross-zone promote/demote.
type Zone = "top" | "queue";

export default function ListBoard({
  list,
  items,
  myOrder,
  homeCity,
  systemLists,
  currentUserId,
}: {
  list: { slug: string; name: string; type: string };
  items: Item[];
  myOrder: string[];
  homeCity: string;
  systemLists: SystemList[];
  currentUserId: string;
}) {
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ sourceUrl: string; parsed: ParsedPreview } | null>(null);
  const [saving, setSaving] = useState(false);

  // Two zones (Master Product Data section 2): Top 10 - the only items
  // counting toward the aggregate, seeded from the user's last-submitted
  // vote order - and the Trailing queue - everything else, most-recent-
  // first by when it was added to the list. No lock/cycle state (deferred,
  // continuous live view of whatever's currently submitted), and reorder/
  // promote/demote only touches local state - the aggregate only moves on
  // an explicit Submit, same write path as before this feature.
  const initialZones = useMemo(() => {
    const allIds = new Set(items.map((i) => i.id));
    const topTen = myOrder.filter((id) => allIds.has(id)).slice(0, TOP_TEN_SIZE);
    const topTenSet = new Set(topTen);
    const queue = [...items]
      .filter((i) => !topTenSet.has(i.id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((i) => i.id);
    return { topTen, queue };
  }, [items, myOrder]);
  const [zones, setZones] = useState(initialZones);
  const [voteSaved, setVoteSaved] = useState(false);
  const [voting, setVoting] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  // The one place both drag-and-drop and every button (promote/demote/
  // arrows) funnel through. targetId null means "append to the end" (top
  // zone) or "insert at the front" (queue zone) - the button actions'
  // meaning; a real targetId means "insert at this row's position" - drag
  // and drop's meaning. Promoting into a full top ten bumps the current
  // last slot back into the queue's front, per spec.
  function moveItem(id: string, toZone: Zone, targetId: string | null) {
    setZones((prev) => {
      let topTen = prev.topTen.filter((x) => x !== id);
      let queue = prev.queue.filter((x) => x !== id);

      if (toZone === "top") {
        let bumped: string | null = null;
        if (topTen.length >= TOP_TEN_SIZE) {
          bumped = topTen[topTen.length - 1];
          topTen = topTen.slice(0, -1);
        }
        const idx = targetId ? topTen.indexOf(targetId) : -1;
        const insertAt = idx === -1 ? topTen.length : idx;
        topTen = [...topTen.slice(0, insertAt), id, ...topTen.slice(insertAt)];
        if (bumped) queue = [bumped, ...queue];
      } else {
        const idx = targetId ? queue.indexOf(targetId) : -1;
        const insertAt = idx === -1 ? 0 : idx;
        queue = [...queue.slice(0, insertAt), id, ...queue.slice(insertAt)];
      }
      return { topTen, queue };
    });
    setVoteSaved(false);
  }

  function moveWithinTop(index: number, dir: -1 | 1) {
    setZones((prev) => {
      const next = [...prev.topTen];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, topTen: next };
    });
    setVoteSaved(false);
  }

  function onDragStart(id: string) {
    return () => setDragId(id);
  }
  function onDragOverRow(e: React.DragEvent) {
    e.preventDefault();
  }
  function onDropOnRow(zone: Zone, targetId: string) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      if (dragId && dragId !== targetId) moveItem(dragId, zone, targetId);
      setDragId(null);
    };
  }
  function onDropOnZone(zone: Zone) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      if (dragId) moveItem(dragId, zone, null);
      setDragId(null);
    };
  }

  async function submitVote() {
    setVoting(true);
    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listSlug: list.slug, orderedListItemIds: zones.topTen }),
      });
      if (res.ok) {
        setVoteSaved(true);
        router.refresh();
      }
    } finally {
      setVoting(false);
    }
  }

  async function handleDelete(listItemId: string) {
    setDeleting(true);
    try {
      const res = await fetch("/api/list-items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listItemId }),
      });
      if (res.ok) {
        setZones((prev) => ({
          topTen: prev.topTen.filter((id) => id !== listItemId),
          queue: prev.queue.filter((id) => id !== listItemId),
        }));
        setConfirmDeleteId(null);
        router.refresh();
      }
    } finally {
      setDeleting(false);
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

  function DeleteControl({ item }: { item: Item }) {
    if (item.addedBy !== currentUserId) return null;
    if (confirmDeleteId === item.id) {
      return (
        <span className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => handleDelete(item.id)}
            disabled={deleting}
            className="text-[10px] px-2 py-1 rounded-md text-white disabled:opacity-40"
            style={{ background: "var(--rust)" }}
          >
            Remove?
          </button>
          <button onClick={() => setConfirmDeleteId(null)} className="text-[10px] px-2 py-1 rounded-md border">
            Cancel
          </button>
        </span>
      );
    }
    return (
      <button
        onClick={() => setConfirmDeleteId(item.id)}
        aria-label="Remove from list"
        className="px-1.5 text-sm opacity-40 hover:opacity-100 shrink-0"
      >
        &times;
      </button>
    );
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
        <h2 className="text-xs uppercase tracking-wide opacity-50 mb-2">
          Your top ten &middot; drag to reorder, or use the arrows
        </h2>
        <div className="space-y-1 min-h-[2.5rem]" onDragOver={onDragOverRow} onDrop={onDropOnZone("top")}>
          {zones.topTen.map((id, i) => {
            const item = itemsById.get(id);
            if (!item) return null;
            return (
              <div
                key={id}
                draggable
                onDragStart={onDragStart(id)}
                onDragOver={onDragOverRow}
                onDrop={onDropOnRow("top", id)}
                className="flex items-center gap-2 bg-white rounded-md px-2 py-2 border border-black/5 cursor-grab active:cursor-grabbing"
              >
                <span className="font-display text-lg w-6 text-center opacity-30">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.entry.title}</p>
                  {item.entry.subtitle && <p className="text-xs opacity-50 truncate">{item.entry.subtitle}</p>}
                </div>
                <EntryActionMenu entry={item.entry} systemLists={systemLists} />
                <button onClick={() => moveWithinTop(i, -1)} className="px-1.5 opacity-50 hover:opacity-100">&uarr;</button>
                <button onClick={() => moveWithinTop(i, 1)} className="px-1.5 opacity-50 hover:opacity-100">&darr;</button>
                <button
                  onClick={() => moveItem(id, "queue", null)}
                  title="Send back to trailing queue"
                  className="px-1.5 text-xs opacity-50 hover:opacity-100"
                >
                  &darr; queue
                </button>
                <DeleteControl item={item} />
              </div>
            );
          })}
          {zones.topTen.length === 0 && (
            <p className="text-sm opacity-50">Promote something from the queue below to start your top ten.</p>
          )}
        </div>
        {zones.topTen.length > 0 && (
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

      <div className="mb-6">
        <h2 className="text-xs uppercase tracking-wide opacity-50 mb-2">Trailing queue &middot; most recent first</h2>
        <div className="space-y-1 min-h-[2.5rem]" onDragOver={onDragOverRow} onDrop={onDropOnZone("queue")}>
          {zones.queue.map((id) => {
            const item = itemsById.get(id);
            if (!item) return null;
            return (
              <div
                key={id}
                draggable
                onDragStart={onDragStart(id)}
                onDragOver={onDragOverRow}
                onDrop={onDropOnRow("queue", id)}
                className="flex items-center gap-2 bg-white rounded-md px-2 py-2 border border-black/5 cursor-grab active:cursor-grabbing"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.entry.title}</p>
                  {item.entry.subtitle && <p className="text-xs opacity-50 truncate">{item.entry.subtitle}</p>}
                </div>
                <EntryActionMenu entry={item.entry} systemLists={systemLists} />
                <button
                  onClick={() => moveItem(id, "top", null)}
                  className="text-xs px-2 py-1 rounded-md text-white shrink-0"
                  style={{ background: "var(--slate)" }}
                >
                  Promote
                </button>
                <DeleteControl item={item} />
              </div>
            );
          })}
          {zones.queue.length === 0 && (
            <p className="text-sm opacity-50">Nothing waiting in the queue.</p>
          )}
        </div>
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
