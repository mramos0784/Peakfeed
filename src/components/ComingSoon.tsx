import Link from "next/link";

// Honest placeholder for nav tabs whose backend doesn't exist yet
// (Map, Vote Day, Feed — roadmap items 2, 3, 5). No fake data, no stubbed
// interactions — just says what it is and points at the tab that works.
export default function ComingSoon({
  title,
  roadmapItem,
  note,
}: {
  title: string;
  roadmapItem: number;
  note: string;
}) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center text-center p-8 gap-3">
      <h1 className="font-display text-4xl" style={{ color: "var(--rust)" }}>
        {title.toUpperCase()}
      </h1>
      <p className="text-sm opacity-60 max-w-xs">{note}</p>
      <p className="text-xs opacity-40">Roadmap item {roadmapItem} — not built yet.</p>
      <Link
        href="/lists"
        className="mt-2 text-xs px-4 py-2 rounded-full text-white"
        style={{ background: "var(--rust)" }}
      >
        Go rank something
      </Link>
    </div>
  );
}
