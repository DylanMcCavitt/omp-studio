// Display formatting helpers shared across views. Each accepts loose input
// (ISO string or epoch number) so callers can pass raw domain values directly.

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const DATE_TIME = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});
const NUMBER = new Intl.NumberFormat("en");

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

/** Human "3 minutes ago" / "in 2 days" relative to now. */
export function formatRelativeTime(iso: string | number): string {
  const then = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  let duration = (then - Date.now()) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return RELATIVE.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return RELATIVE.format(Math.round(duration), "year");
}

/** Localized absolute timestamp, e.g. "Jun 19, 2026, 7:20 AM". */
export function formatDateTime(iso: string | number): string {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return DATE_TIME.format(ms);
}

/** Byte count with binary units (KB/MB/...). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(
    Math.max(Math.floor(Math.log(n) / Math.log(1024)), 0),
    units.length - 1,
  );
  const value = n / 1024 ** exp;
  return `${value.toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

/** Grouped integer/decimal formatting. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return NUMBER.format(n);
}
