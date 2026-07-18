"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SystemList } from "@/lib/systemLists";

type ListContext = { slug: string; name: string; type: string };

type ParsedResult = {
  type: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  external_id: string | null;
  confidence: "high" | "medium" | "low";
  source: "spotify_page" | "url_id" | "ai" | "unsupported";
  message?: string;
};

type Step = "input" | "typed-unsupported" | "parsing" | "confirm" | "saving" | "done" | "error";

function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return true;
  // People often paste a bare domain without the protocol, e.g.
  // "open.spotify.com/track/...". Treat anything domain-shaped as a link.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(trimmed);
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Persistent global entry point for adding something to a list, reachable
// from Map, the Lists index, and any individual list - separate from the
// per-list add box, which stays in place until this is confirmed working.
// See docs/adr/0003-global-add-button.md for why this is scoped the way it
// is (no live search / LLM-search / group-list destinations yet).
export default function AddToListsButton({
  systemLists,
  listContext,
}: {
  systemLists: SystemList[];
  listContext?: ListContext;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [destChecked, setDestChecked] = useState(true);

  function reset() {
    setInput("");
    setStep("input");
    setErrorMsg(null);
    setSourceUrl(null);
    setParsed(null);
    setTitle("");
    setSubtitle("");
    setDestChecked(true);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    if (!looksLikeUrl(trimmed)) {
      setStep("typed-unsupported");
      return;
    }

    const url = normalizeUrl(trimmed);
    setStep("parsing");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/parse-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, hintType: listContext?.type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "Could not read that link.");
        setStep("error");
        return;
      }
      setSourceUrl(url);
      setParsed(data.parsed);
      setTitle(data.parsed.title ?? "");
      setSubtitle(data.parsed.subtitle ?? "");
      setDestChecked(true);
      setStep("confirm");
    } catch {
      setErrorMsg("Could not reach the server. Try again.");
      setStep("error");
    }
  }

  const destination = parsed ? systemLists.find((l) => l.type === parsed.type) : undefined;

  async function handleConfirm() {
    if (!parsed || !sourceUrl || !destination || !destChecked) return;
    setStep("saving");
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listSlug: destination.slug,
          type: parsed.type,
          title: title.trim(),
          subtitle: subtitle.trim() || null,
          image_url: parsed.image_url,
          source_url: sourceUrl,
          external_id: parsed.external_id,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error ?? "Could not save that entry.");
        setStep("error");
        return;
      }
      setStep("done");
      router.refresh();
    } catch {
      setErrorMsg("Could not reach the server. Try again.");
      setStep("error");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed right-4 z-40 flex items-center justify-center rounded-full text-white shadow-lg"
        style={{ background: "var(--rust)", width: 52, height: 52, bottom: 84 }}
        aria-label="Add to Lists"
      >
        <span className="text-2xl leading-none" aria-hidden>+</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={close}>
          <div
            className="w-full max-w-md mx-auto bg-white rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-display text-2xl" style={{ color: "var(--rust)" }}>
                Add to Lists
              </h2>
              <button onClick={close} className="text-sm opacity-50">Close</button>
            </div>
            {listContext && (
              <p className="text-xs opacity-50 mb-3">Adding from {listContext.name}</p>
            )}

            {step === "input" && (
              <form onSubmit={handleSubmit} className="mt-3">
                <input
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Paste a link"
                  className="w-full border rounded-md px-3 py-2 text-sm mb-3"
                />
                <button
                  className="w-full font-display text-lg tracking-wide rounded-md py-2 text-white"
                  style={{ background: "var(--rust)" }}
                >
                  Continue
                </button>
              </form>
            )}

            {step === "typed-unsupported" && (
              <div className="mt-3">
                <p className="text-sm opacity-70 mb-4">
                  Paste a link for now — typed search is coming soon.
                </p>
                <button onClick={() => setStep("input")} className="text-sm px-3 py-1.5 rounded-md border">
                  Back
                </button>
              </div>
            )}

            {step === "parsing" && <p className="text-sm opacity-60 mt-3">Reading that link...</p>}

            {step === "error" && (
              <div className="mt-3">
                <p className="text-red-600 text-sm mb-4">{errorMsg}</p>
                <button onClick={() => setStep("input")} className="text-sm px-3 py-1.5 rounded-md border">
                  Try again
                </button>
              </div>
            )}

            {step === "confirm" && parsed && (
              <div className="mt-3">
                {parsed.source === "unsupported" ? (
                  <p className="text-sm opacity-70 mb-3">{parsed.message}</p>
                ) : (
                  <p className="text-[10px] uppercase tracking-wide opacity-50 mb-2">
                    Confirm this entry &middot; {parsed.confidence} confidence
                  </p>
                )}
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title"
                  className="w-full border rounded-md px-3 py-2 text-sm mb-2 font-medium"
                />
                <input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="Artist / location / year"
                  className="w-full border rounded-md px-3 py-2 text-sm mb-3 opacity-70"
                />

                {destination ? (
                  <label className="flex items-center gap-2 text-sm mb-4">
                    <input
                      type="checkbox"
                      checked={destChecked}
                      onChange={(e) => setDestChecked(e.target.checked)}
                    />
                    {destination.name}
                  </label>
                ) : (
                  <p className="text-xs opacity-50 mb-4">No matching list for this yet.</p>
                )}

                <button
                  onClick={handleConfirm}
                  disabled={!title.trim() || !destination || !destChecked}
                  className="w-full font-display text-lg tracking-wide rounded-md py-2 text-white disabled:opacity-40"
                  style={{ background: "var(--rust)" }}
                >
                  Add it
                </button>
              </div>
            )}

            {step === "saving" && <p className="text-sm opacity-60 mt-3">Saving...</p>}

            {step === "done" && (
              <div className="mt-3">
                <p className="text-sm mb-4">Added to {destination?.name}.</p>
                <button
                  onClick={close}
                  className="w-full font-display text-lg tracking-wide rounded-md py-2 text-white"
                  style={{ background: "var(--rust)" }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
