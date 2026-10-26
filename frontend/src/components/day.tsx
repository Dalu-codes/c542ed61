import { useId, useMemo } from "react";
import type { Day, Interval } from "../api/types";
import { fmtDayTime, fmtDuration, fmtMW, fmtTime } from "../lib/format";
import { Dir } from "./ui";

const HOUR = 3600_000;

function niceMax(v: number) {
  const step = v > 15000 ? 5000 : 2500;
  return Math.ceil((v * 1.06) / step) * step;
}

/** Spread label y-positions so they never overlap (min gap in px). */
function spread(items: { key: string; y: number }[], gap = 16) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - sorted[i - 1].y < gap) sorted[i].y = sorted[i - 1].y + gap;
  }
  return Object.fromEntries(sorted.map((s) => [s.key, s.y]));
}

/* ---------------- replay chart ---------------- */

export function ReplayChart({
  day,
  showLater,
  active,
  onActive,
  width = 1000,
}: {
  day: Day;
  showLater: boolean;
  active: number;
  onActive: (i: number) => void;
  width?: number;
}) {
  const pid = useId().replace(/:/g, "");
  const narrow = width < 640;
  const W = width, H = narrow ? 300 : 392, L = 44, R = narrow ? 16 : 132, T = 30, B = 34;
  const start = new Date(day.hours[0].startTime).getTime();
  const x = (iso: string | number) => L + ((typeof iso === "string" ? new Date(iso).getTime() : iso) - start) / (24 * HOUR) * (W - L - R);
  const actualAt = useMemo(() => new Map(day.actuals.map((a) => [a.startTime, a.actualMw])), [day]);
  const values = [
    ...day.actuals.map((a) => a.actualMw),
    ...day.hours.map((h) => h.forecastMw ?? 0),
    ...(showLater ? day.laterRuns.flatMap((r) => r.forecasts.map((f) => f.forecastMw)) : []),
  ];
  const yMax = niceMax(Math.max(...values, 1000));
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const ticks = Array.from({ length: Math.floor(yMax / (yMax > 15000 ? 5000 : 2500)) + 1 }, (_, i) => i * (yMax > 15000 ? 5000 : 2500));

  const actualPath = day.actuals.map((a, i) => `${i ? "L" : "M"}${x(a.startTime).toFixed(1)} ${y(a.actualMw).toFixed(1)}`).join("");
  const fc = day.hours.filter((h) => h.forecastMw != null);
  const forecastPath = fc.map((h, i) => `${i ? "L" : "M"}${x(h.startTime).toFixed(1)} ${y(h.forecastMw!).toFixed(1)}`).join("");

  let overFill = "";
  let underFill = "";
  for (let i = 0; i < day.hours.length - 1; i++) {
    const a = day.hours[i], b = day.hours[i + 1];
    const fa = a.forecastMw, fb = b.forecastMw, aa = actualAt.get(a.startTime), ab = actualAt.get(b.startTime);
    if (fa == null || fb == null || aa == null || ab == null) continue;
    const seg = `M${x(a.startTime)} ${y(fa)}L${x(b.startTime)} ${y(fb)}L${x(b.startTime)} ${y(ab)}L${x(a.startTime)} ${y(aa)}Z`;
    if (fa + fb >= aa + ab) overFill += seg;
    else underFill += seg;
  }

  const lastA = day.actuals[day.actuals.length - 1];
  const lastF = fc[fc.length - 1];
  const labels = spread(
    [
      ...(lastA ? [{ key: "a", y: y(lastA.actualMw) + 4 }] : []),
      ...(lastF ? [{ key: "f", y: y(lastF.forecastMw!) + 4 }] : []),
    ],
    18,
  );
  const act = day.hours[active];
  const ax = act ? x(act.startTime) : null;

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${pid}-t`}>
      <title id={`${pid}-t`}>
        Forecast available at the gate versus actual wind generation, {day.deliveryDay}. Exact values are in the hour-by-hour table below.
      </title>
      <defs>
        <pattern id={`${pid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="2" height="6" fill="rgba(255,255,255,0.55)" />
        </pattern>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.12)" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#c9ced8" fontFamily="JetBrains Mono, monospace">
            {t === 0 ? "0" : `${t / 1000}k`}
          </text>
        </g>
      ))}
      {Array.from({ length: narrow ? 5 : 9 }, (_, i) => i * (narrow ? 6 : 3)).map((h) => (
        <text key={h} x={x(start + h * HOUR)} y={H - 12} textAnchor={h === 24 ? "end" : h === 0 ? "start" : "middle"} fontSize="12" fill="#c9ced8" fontFamily="JetBrains Mono, monospace">
          {String(h).padStart(2, "0")}:00
        </text>
      ))}
      <text x={L} y={12} textAnchor="start" fontSize="12" fill="#c9ced8">
        MW, average over each interval
      </text>
      <path d={overFill} fill="rgba(252,163,17,0.5)" />
      <path d={underFill} fill={`url(#${pid}-hatch)`} />
      {showLater
        ? day.laterRuns.map((r) => (
            <path
              key={r.publishTime}
              d={r.forecasts.map((f, i) => `${i ? "L" : "M"}${x(f.startTime)} ${y(f.forecastMw)}`).join("")}
              fill="none"
              stroke="rgba(229,229,229,0.55)"
              strokeWidth="1.5"
              strokeDasharray="5 5"
            />
          ))
        : null}
      <path d={actualPath} fill="none" stroke="#ffffff" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <path d={forecastPath} fill="none" stroke="#fca311" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {fc.map((h) => (
        <circle key={h.startTime} cx={x(h.startTime)} cy={y(h.forecastMw!)} r={h === act ? 6 : 4} fill="#fca311" stroke="#14213d" strokeWidth="2" />
      ))}
      {ax != null ? (
        <g aria-hidden="true">
          <line x1={ax} x2={ax} y1={T} y2={H - B} stroke="rgba(255,255,255,0.55)" strokeWidth="1" />
          {act && actualAt.get(act.startTime) != null ? (
            <circle cx={ax} cy={y(actualAt.get(act.startTime)!)} r={6} fill="#ffffff" stroke="#14213d" strokeWidth="2" />
          ) : null}
        </g>
      ) : null}
      {lastA && !narrow ? (
        <text x={W - R + 10} y={labels.a} fontSize="13" fill="#ffffff" fontWeight="600">
          Actual
        </text>
      ) : null}
      {lastF && !narrow ? (
        <text x={W - R + 10} y={labels.f} fontSize="13" fill="#fca311" fontWeight="600">
          Forecast at gate
        </text>
      ) : null}
      {/* invisible hover targets, one per delivery hour */}
      {day.hours.map((h, i) => (
        <rect
          key={h.startTime}
          x={x(h.startTime) - (W - L - R) / 48}
          y={T}
          width={(W - L - R) / 24}
          height={H - T - B}
          fill="transparent"
          onMouseEnter={() => onActive(i)}
          onTouchStart={() => onActive(i)}
        />
      ))}
    </svg>
  );
}

export function ChartLegend({ showLater }: { showLater: boolean }) {
  return (
    <div className="legend legend--navy" role="group" aria-label="Chart key">
      <span className="legend__item">
        <span className="key-line" style={{ color: "#fca311" }} /> Forecast at gate (hourly)
      </span>
      <span className="legend__item">
        <span className="key-line" style={{ color: "#ffffff" }} /> Actual (half-hourly)
      </span>
      <span className="legend__item">
        <span className="swatch" style={{ background: "rgba(252,163,17,0.6)" }} /> ▲ over
      </span>
      <span className="legend__item">
        <span className="swatch" style={{ background: "repeating-linear-gradient(45deg, rgba(255,255,255,.6) 0 2px, transparent 2px 6px)", border: "1px solid rgba(255,255,255,.4)" }} /> ▼ under
      </span>
      {showLater ? (
        <span className="legend__item">
          <span className="key-line" style={{ color: "#c9ced8", borderTopStyle: "dashed", borderTopWidth: 2 }} /> Runs after the gate
        </span>
      ) : null}
    </div>
  );
}

/* ---------------- signed error bars ---------------- */

export function ErrorBars({ hours, onPick, width = 1000 }: { hours: Interval[]; onPick: (i: number) => void; width?: number }) {
  const W = width, H = 220, L = 56, R = 8, MID = 110, HALF = 84;
  const maxAbs = Math.max(1, ...hours.map((h) => Math.abs(h.errorMw ?? 0)));
  const bw = Math.min(24, ((W - L - R) / 24) * 0.66);
  const slot = (W - L - R) / 24;
  let worstO = -1, worstU = -1;
  hours.forEach((h, i) => {
    if (h.errorMw == null) return;
    if (h.errorMw > 0 && (worstO < 0 || h.errorMw > (hours[worstO].errorMw ?? 0))) worstO = i;
    if (h.errorMw < 0 && (worstU < 0 || h.errorMw < (hours[worstU].errorMw ?? 0))) worstU = i;
  });
  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Signed error for each delivery hour: bars above the line are over-forecasts, below are under-forecasts. Exact values are in the table below.">
      <text x={L - 8} y={MID - HALF + 10} textAnchor="end" fontSize="12" fill="#5b6477">
        ▲ over
      </text>
      <text x={L - 8} y={MID + 4} textAnchor="end" fontSize="12" fill="#5b6477">
        0
      </text>
      <text x={L - 8} y={MID + HALF} textAnchor="end" fontSize="12" fill="#5b6477">
        ▼ under
      </text>
      {hours.map((h, i) => {
        if (h.errorMw == null) return null;
        const len = (Math.abs(h.errorMw) / maxAbs) * HALF;
        const bx = L + i * slot + (slot - bw) / 2;
        const over = h.errorMw > 0;
        return (
          <g key={h.startTime} onMouseEnter={() => onPick(i)} style={{ cursor: "default" }}>
            <rect x={L + i * slot} y={MID - HALF} width={slot} height={HALF * 2} fill="transparent" />
            <rect
              x={bx}
              y={over ? MID - len : MID}
              width={bw}
              height={Math.max(1, len)}
              rx={3}
              fill={over ? "#fca311" : "#14213d"}
              stroke={over ? "#14213d" : "none"}
              strokeWidth={1}
            >
              <title>{`${fmtTime(h.startTime)} · ${over ? "+" : "−"}${fmtMW(Math.abs(h.errorMw))} MW`}</title>
            </rect>
          </g>
        );
      })}
      <line x1={L} x2={W - R} y1={MID} y2={MID} stroke="#14213d" strokeWidth="1" />
      {[0, 6, 12, 18].map((h) => (
        <text key={h} x={L + h * slot + slot / 2} y={H - 4} textAnchor="middle" fontSize="12" fill="#5b6477" fontFamily="JetBrains Mono, monospace">
          {String(h).padStart(2, "0")}:00
        </text>
      ))}
      {worstO >= 0 ? (
        <text x={L + worstO * slot + slot / 2} y={MID - ((hours[worstO].errorMw ?? 0) / maxAbs) * HALF - 6} textAnchor="middle" fontSize="12" fontWeight="600" fill="#14213d">
          +{fmtMW(hours[worstO].errorMw)}
        </text>
      ) : null}
      {worstU >= 0 ? (
        <text x={L + worstU * slot + slot / 2} y={MID + (Math.abs(hours[worstU].errorMw ?? 0) / maxAbs) * HALF + 16} textAnchor="middle" fontSize="12" fontWeight="600" fill="#14213d">
          −{fmtMW(Math.abs(hours[worstU].errorMw ?? 0))}
        </text>
      ) : null}
    </svg>
  );
}

/* ---------------- hour table ---------------- */

export function HourTable({ day, active, onAudit }: { day: Day; active: number; onAudit: (startTime: string) => void }) {
  const maxAbs = Math.max(1, ...day.hours.map((h) => Math.abs(h.errorMw ?? 0)));
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
      <table className="data hour-table">
        <caption className="sr-only">Forecast at the gate versus actual generation for each delivery hour</caption>
        <thead>
          <tr>
            <th scope="col">Hour (UK)</th>
            <th scope="col" className="r">
              Forecast · MW
            </th>
            <th scope="col" className="r">
              Actual · MW
            </th>
            <th scope="col" className="r">
              Error · MW
            </th>
            <th scope="col" className="hide-sm" style={{ width: 200 }}>
              Size
            </th>
            <th scope="col" className="hide-sm">Run used</th>
            <th scope="col">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {day.hours.map((h, i) => (
            <tr key={h.startTime} className={i === active ? "is-hl" : undefined}>
              <th scope="row" className="num" style={{ fontWeight: 500 }}>
                {fmtTime(h.startTime)}
              </th>
              <td className="r num">{fmtMW(h.forecastMw)}</td>
              <td className="r num">{fmtMW(h.actualMw)}</td>
              <td className="r" style={{ fontWeight: 600 }}>
                {h.status === "scored" ? <Dir errorMw={h.errorMw} /> : <span style={{ color: "var(--ink-2)" }}>not scored</span>}
              </td>
              <td aria-hidden="true" className="hide-sm">
                <span className="bar" style={{ display: "block" }}>
                  <span style={{ width: `${(Math.abs(h.errorMw ?? 0) / maxAbs) * 100}%`, background: (h.errorMw ?? 0) > 0 ? "#fca311" : "#14213d" }} />
                </span>
              </td>
              <td className="num hide-sm" style={{ color: "var(--ink-2)" }}>
                {h.publishTime ? fmtDayTime(h.publishTime) : "—"}
              </td>
              <td className="r">
                <button type="button" className="btn btn--sm" onClick={() => onAudit(h.startTime)} aria-label={`Audit ${fmtTime(h.startTime)}`}>
                  Audit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const ageText = (m: number | null) => (m == null ? "—" : `${fmtDuration(m)} old at the gate`);
