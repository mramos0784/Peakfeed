"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SystemList } from "@/lib/systemLists";

export type MenuEntry = {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  source_url: string | null;
  external_id: string | null;
  metadata?: { sources?: { url: string; title: string }[] } | null;
};

type Step = "menu" | "add" | "sources" | "report";

// "Open in" per docs/api-integrations-addendum.md section 6: the literal
// pasted URL if we have one, otherwise reconstructed from whatever
// identifier the resolution tier that found this entry left behind.
// event:/internal: prefixed ids are PeakFeed's own, not a real platform's,
// so those correctly yield no link - "Open in" is disabled for them.
function externalLinkFor(entry: MenuEntry): string | null {
  if (entry.source_url) return entry.source_url;
  const id = entry.external_id;
  if (!id) return null;
  if (id.startsWith("spotify:")) return `https://open.spotify.com/track/${id.slice("spotify:".length)}`;
  if (id.startsWith("google_place:")) return `https://www.google.com/maps/place/?q=place_id:${id.slice("google_place:".length)}`;
  if (id.startsWith("google_ftid:")) return `https://www.google.com/maps?ftid=${id.slice("google_ftid:".length)}`;
  if (id.startsWith("wikidata:")) return `https://www.wikidata.org/wiki/${id.slice("wikidata:".length)}`;
  return null;
}

// Universal action menu (docs/api-integrations-addendum.md section 6):
// every place an entry is shown gets this, same order every time. "Add to
// list" skips resolution entirely (the entry already has an id and a
// resolved identifier) and goes straight to a single-checkbox confirm,
// the same shape AddToListsButton's confirm step already uses - group
// lists don't exist yet, so today this is always exactly one destination,
// not a bug.
//
// Two ways to use this component:
// - Default (no `hideTrigger`): renders its own "⋯" trigger button and
//   manages its own open/close state - drop it straight into a row.
// - `hideTrigger` + `open`/`onClose`: for surfaces where the trigger can't
//   be a React child of this tree (MapView's Leaflet popup is raw HTML,
//   not JSX) - the caller controls visibility instead.
export default function EntryActionMenu({
  entry,
  systemLists,
  hideTrigger,
  open: controlledOpen,
  onClose,
}: {
  entry: MenuEntry;
  systemLists: SystemList[];
  hideTrigger?: boolean;
  open?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [step, setStep] = useState<Step>("menu");
  const menuOpen = hideTrigger ? !!controlledOpen : internalOpen;

  const [addStatus, setAddStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [reportReason, setReportReason] = useState("");
  const [reportStatus, setReportStatus] = useState<"idle" | "saving" | "done" | "error">("idle");

  const destination = systemLists.find((l) => l.type === entry.type);
  const externalLink = externalLinkFor(entry);
  const sources = entry.metadata?.sources ?? [];

  function closeMenu() {
    setStep("menu");
    setAddStatus("idle");
    setReportStatus("idle");
    setReportReason("");
    if (hideTrigger) onClose?.();
    else setInternalOpen(false);
  }

  async function confirmAdd() {
    if (!destination) return;
    setAddStatus("saving");
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listSlug: destination.slug, entryId: entry.id }),
      });
      if (!res.ok) {
        setAddStatus("error");
        return;
      }
      setAddStatus("done");
      router.refresh();
    } catch {
      setAddStatus("error");
    }
  }

  function handleOpenIn() {
    if (!externalLink) return;
    window.open(externalLink, "_blank", "noopener,noreferrer");
    closeMenu();
  }

  async function handleShare() {
    const shareUrl = typeof window !== "undefined" ? window.location.href : "";
    const text = `${entry.title} on PeakFeed`;
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
    closeMenu();
  }

  async function submitReport() {
    setReportStatus("saving");
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, reason: reportReason.trim() || null }),
      });
      if (!res.ok) {
        setReportStatus("error");
        return;
      }
      setReportStatus("done");
    } catch {
      setReportStatus("error");
    }
  }

  return (
    <>
      {!hideTrigger && (
        <button
          onClick={() => setInternalOpen(true)}
          aria-label="Entry actions"
          className="px-2 py-1 text-base leading-none opacity-40 hover:opacity-100 shrink-0"
        >
          &#8942;
        </button>
      )}

      {menuOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={closeMenu}>
          <div
            className="w-full max-w-md mx-auto bg-white rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium truncate pr-4">{entry.title}</p>
              <button onClick={closeMenu} className="text-sm opacity-50 shrink-0">Close</button>
            </div>

            {step === "menu" && (
              <div className="space-y-1">
                <MenuItem label="Add to list" onClick={() => setStep("add")} />
                <MenuItem label="Open in" onClick={handleOpenIn} disabled={!externalLink} />
                <MenuItem label="See sources" onClick={() => setStep("sources")} />
                <MenuItem label="Share" onClick={handleShare} />
                <MenuItem label="Report" onClick={() => setStep("report")} />
              </div>
            )}

            {step === "add" && (
              <div>
                {destination ? (
                  <>
                    <label className="flex items-center gap-2 text-sm mb-4">
                      <input type="checkbox" checked readOnly />
                      {destination.name}
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={confirmAdd}
                        disabled={addStatus === "saving" || addStatus === "done"}
                        className="text-sm px-3 py-1.5 rounded-md text-white disabled:opacity-40"
                        style={{ background: "var(--rust)" }}
                      >
                        {addStatus === "saving" ? "Adding..." : addStatus === "done" ? "Added ✓" : "Add it"}
                      </button>
                      <button onClick={() => setStep("menu")} className="text-sm px-3 py-1.5 rounded-md border">
                        Back
                      </button>
                    </div>
                    {addStatus === "error" && (
                      <p className="text-red-600 text-xs mt-2">Could not add that. Try again.</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs opacity-50">No matching list for this yet.</p>
                )}
              </div>
            )}

            {step === "sources" && (
              <div>
                {sources.length > 0 ? (
                  <div className="space-y-1.5 mb-3">
                    {sources.map((s, i) => (
                      <a
                        key={i}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block bg-white border rounded-md px-3 py-2 text-sm hover:border-black/30 transition truncate"
                      >
                        {s.title}
                      </a>
                    ))}
                  </div>
                ) : entry.source_url ? (
                  <a
                    href={entry.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-white border rounded-md px-3 py-2 text-sm hover:border-black/30 transition mb-3 truncate"
                  >
                    {entry.source_url}
                  </a>
                ) : (
                  <p className="text-xs opacity-50 mb-3">No sources available for this entry.</p>
                )}
                <button onClick={() => setStep("menu")} className="text-sm px-3 py-1.5 rounded-md border">
                  Back
                </button>
              </div>
            )}

            {step === "report" && (
              <div>
                {reportStatus === "done" ? (
                  <p className="text-sm mb-3">Reported. Thanks for flagging it.</p>
                ) : (
                  <>
                    <textarea
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      placeholder="What's wrong with this? (optional)"
                      className="w-full border rounded-md px-2 py-1.5 text-sm mb-3"
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={submitReport}
                        disabled={reportStatus === "saving"}
                        className="text-sm px-3 py-1.5 rounded-md text-white disabled:opacity-40"
                        style={{ background: "var(--rust)" }}
                      >
                        {reportStatus === "saving" ? "Reporting..." : "Submit report"}
                      </button>
                      <button onClick={() => setStep("menu")} className="text-sm px-3 py-1.5 rounded-md border">
                        Back
                      </button>
                    </div>
                    {reportStatus === "error" && (
                      <p className="text-red-600 text-xs mt-2">Could not submit that. Try again.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function MenuItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left text-sm px-3 py-2.5 rounded-md hover:bg-black/5 transition disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {label}
    </button>
  );
}
