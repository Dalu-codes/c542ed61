// One place for every number, time and sign shown in the UI.
const MINUS = "−";
const TZ = "Europe/London";

const int = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 0 });

export const fmtMW = (v: number | null | undefined) => (v == null ? "—" : int.format(Math.round(v)).replace("-", MINUS));

export const fmtSigned = (v: number | null | undefined) => {
  if (v == null) return "—";
  const r = Math.round(v);
  if (r === 0) return "0";
  return (r > 0 ? "+" : MINUS) + int.format(Math.abs(r));
};

export const fmtPct = (v: number | null | undefined) => (v == null ? "—" : pct.format(v));

export type Direction = "over" | "under" | "none";
export const direction = (errorMw: number | null | undefined): Direction =>
  errorMw == null || Math.round(errorMw) === 0 ? "none" : errorMw > 0 ? "over" : "under";
export const glyph = (d: Direction) => (d === "over" ? "▲" : d === "under" ? "▼" : "•");
export const directionWord = (d: Direction) => (d === "over" ? "over-forecast" : d === "under" ? "under-forecast" : "on target");

const dtf = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts });
const tTime = dtf({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const tDay = dtf({ weekday: "short", day: "numeric", month: "short" });
const tDayLong = dtf({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const tDow = dtf({ weekday: "short" });
const tDom = dtf({ day: "numeric" });

const asDate = (s: string) => (s.length === 10 ? new Date(`${s}T12:00:00Z`) : new Date(s));

export const fmtTime = (iso: string | null | undefined) => (iso ? tTime.format(new Date(iso)) : "—");
export const fmtDay = (isoOrDate: string) => tDay.format(asDate(isoOrDate)).replace(",", "");
export const fmtDayLong = (isoOrDate: string) => tDayLong.format(asDate(isoOrDate)).replace(",", "");
export const fmtDayTime = (iso: string) => `${fmtDay(iso)}, ${fmtTime(iso)}`;
export const fmtDow = (isoOrDate: string) => tDow.format(asDate(isoOrDate));
export const fmtDom = (isoOrDate: string) => tDom.format(asDate(isoOrDate));

export const ukHour = (iso: string) => Number(tTime.format(new Date(iso)).slice(0, 2));

export const fmtDuration = (minutes: number | null | undefined) => {
  if (minutes == null) return "—";
  const m = Math.abs(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h ${String(r).padStart(2, "0")}m` : `${r} min`;
};

/** Day before a YYYY-MM-DD date, as YYYY-MM-DD (the decision day). */
export const dayBefore = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};
