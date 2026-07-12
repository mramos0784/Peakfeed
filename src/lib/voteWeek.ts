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
