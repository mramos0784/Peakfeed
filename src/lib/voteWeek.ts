// Which voting week a vote belongs to, expressed as that week's Monday
// (YYYY-MM-DD). Simplified for the MVP: no Friday 8pm lock window yet,
// every vote just counts toward the current week until that mechanic
// gets built.
export function currentWeekOf(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

// Whether right now falls in the "vote weekend" window the master doc
// defines: rankings lock Friday 8pm local time and stay locked through
// vote night (Sunday 6pm) into Monday's results release. The nav bar's
// Vote Day tab shows a live dot during this window. No lock/cycle backend
// exists yet, so this is real date math against "local" (Tampa) time, not
// a stand-in for state that should come from the database.
export function isVoteWeekend(date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  if (weekday === "Fri") return hour >= 20;
  return weekday === "Sat" || weekday === "Sun";
}
