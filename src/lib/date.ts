export function dateOffset(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function formatDate(value: string, short = false) {
  return new Date(value + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", ...(short ? {} : { weekday: "short" }), timeZone: "UTC" });
}
export function formatTime(value: string) {
  const [h, m] = value.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
export function duration(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` }
