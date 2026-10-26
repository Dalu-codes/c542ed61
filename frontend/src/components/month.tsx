import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Interval, Metrics, Summary } from "../api/types";
import { fmtDay, fmtDayTime, fmtDom, fmtDow, fmtDuration, fmtMW, fmtPct, fmtTime, ukHour, dayBefore } from "../lib/format";
import { useViewParams } from "../lib/params";
import { Dir, SectionHead } from "./ui";

/* ---------------- metric tiles ---------------- */

export function MetricTiles({ m, coverage, compact = false }: { m: Metrics; coverage: { scored: number; expected: number }; compact?: boolean }) {
  const bias = m.meanErrorMw ?? 0;
  return (
    <div className="tiles" role="list">
      <div className="card tile tile--accent" role="listitem">
        <span className="tile__label">Typical miss · MAE</span>
        <span className="tile__value">
          <span className="v">{fmtMW(m.maeMw)}</span>
          <span className="u">MW</span>
        </span>
        <span className="tile__meaning">Average size of an hourly miss, ignoring direction.</span>
      </div>
      <div className="card tile" role="listitem">
        <span className="tile__label">Big-miss weight · RMSE</span>
        <span className="tile__value">
          <span className="v">{fmtMW(m.rmseMw)}</span>
          <span className="u">MW</span>
        </span>
        <span className="tile__meaning">Well above MAE when a few hours miss badly.</span>
      </div>
      <div className="card tile" role="listitem">
        <span className="tile__label">Lean · mean error</span>
        <span className="tile__value">
          <span className="v">
            <Dir errorMw={m.meanErrorMw} />
          </span>
          <span className="u">MW</span>
        </span>
        <span className="tile__meaning">
          {bias > 0 ? "Forecast ran high: relying on it means buying too little." : bias < 0 ? "Forecast ran low: relying on it means buying too much." : "No overall lean."}
        </span>
        {!compact && m.biasShare != null ? (
          <div role="img" aria-label={`${fmtPct(m.biasShare)} of squared error is constant bias, ${fmtPct(1 - m.biasShare)} varies hour to hour`}>
            <div className="split" aria-hidden="true">
              <span className="split__bias" style={{ width: `${m.biasShare * 100}%` }} />
            </div>
            <div className="split-legend" aria-hidden="true">
              <span>bias {fmtPct(m.biasShare)}</span>
              <span>varying {fmtPct(1 - m.biasShare)}</span>
            </div>
          </div>
        ) : null}
      </div>
      <div className="card tile" role="listitem">
        <span className="tile__label">Bad hour · P90 |error|</span>
        <span className="tile__value">
          <span className="v">{fmtMW(m.p90AbsErrorMw)}</span>
          <span className="u">MW</span>
        </span>
        <span className="tile__meaning">One hour in ten missed by more than this.</span>
      </div>
      <div className="card tile" role="listitem">
        <span className="tile__label">Coverage</span>
        <span className="tile__value">
          <span className="v">{coverage.scored}</span>
          <span className="u">/ {coverage.expected} hours</span>
        </span>
        <span className="tile__meaning">Hours with a forecast from before the gate and an actual.</span>
      </div>
    </div>
  );
}

/* ---------------- insight: the gap ---------------- */

export function GapInsight({ m, afterTheFactMw }: { m: Metrics; afterTheFactMw: number | null }) {
  const { qs } = useViewParams();
  return (
    <section className="card card--navy insight on-navy" aria-labelledby="gap-h">
      <div>
        <span className="eyebrow" style={{ color: "var(--ink-on-navy-2)" }}>
          Read this before the numbers
        </span>
        <h2 id="gap-h" style={{ marginTop: 6 }}>
          About half the error is a constant over-forecast, and it doesn't go away with hindsight
        </h2>
        <p>
          Even the values a run gives for hours that had <em>already started</em> when it was published sit above the
          metered actual. So part of what ForeCheck measures is a gap between what WINDFOR forecasts and what FUELHH meters,
          not forecasting skill. Curtailment or differences in coverage are plausible causes, but these two datasets can't
          confirm either.
        </p>
        <p>
          <Link to={`/method${qs()}#gap`} style={{ color: "var(--white)" }}>
            How we checked this
          </Link>
        </p>
      </div>
      <div className="insight__figs">
        <div className="insight__fig">
          <div className="v">{fmtPct(m.biasShare)}</div>
          <div className="l">of squared error is constant bias (RMSE² = bias² + spread²)</div>
        </div>
        <div className="insight__fig">
          <div className="v num">
            {afterTheFactMw == null ? "…" : `${afterTheFactMw > 0 ? "+" : "−"}${fmtMW(Math.abs(afterTheFactMw))}`}
          </div>
          <div className="l">MW average gap, even for hours already under way when published</div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- decision calendar ---------------- */

export function DecisionCalendar({ s }: { s: Summary }) {
  const { qs } = useViewParams();
  const max = Math.max(...s.days.map((d) => d.metrics.maeMw ?? 0), 1);
  // Decisions are made the day before delivery; the grid is laid out by decision date (Mon-first).
  const first = dayBefore(s.days[0].deliveryDay);
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  return (
    <section className="section" aria-labelledby="cal-h">
      <SectionHead
        id="cal-h"
        title="31 decisions, one per morning"
        lede="Each cell is one decision at the gate and the delivery day it covered. Bar = that day's typical miss, on one scale for the month. Select a day to replay it."
        aside={
          <div className="legend" aria-hidden="true">
            <span className="legend__item">▲ over-forecast day</span>
            <span className="legend__item">▼ under-forecast day</span>
          </div>
        }
      />
      <div className="cal">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="cal__dow" aria-hidden="true">
            {d}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`b${i}`} className="cal__blank" aria-hidden="true" />
        ))}
        {s.days.map((d) => {
          const dec = dayBefore(d.deliveryDay);
          const full = d.coverage.scored === d.coverage.expected;
          return (
            <Link
              key={d.deliveryDay}
              className="cal__cell"
              to={`/day/${d.deliveryDay}${qs()}`}
              aria-label={`Decision ${fmtDay(dec)} for delivery ${fmtDay(d.deliveryDay)}: typical miss ${fmtMW(d.metrics.maeMw)} MW, lean ${d.metrics.meanErrorMw && d.metrics.meanErrorMw > 0 ? "over" : "under"} ${fmtMW(Math.abs(d.metrics.meanErrorMw ?? 0))} MW. Open replay.`}
            >
              <span className="cal__top">
                <span className="cal__date">
                  {fmtDow(dec)} {fmtDom(dec)}
                </span>
                <span className="cal__bias">
                  <Dir errorMw={d.metrics.meanErrorMw} />
                </span>
              </span>
              <span className="cal__del">→ delivers {fmtDay(d.deliveryDay)}</span>
              <span className="bar" aria-hidden="true">
                <span style={{ width: `${((d.metrics.maeMw ?? 0) / max) * 100}%` }} />
              </span>
              <span className="cal__mae">
                {full ? (
                  <>
                    MAE <span className="num">{fmtMW(d.metrics.maeMw)}</span> MW
                  </>
                ) : (
                  `${d.coverage.scored}/${d.coverage.expected} hours scored`
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- error map ---------------- */

type Cell = Summary["errorMap"][number]["cells"][number] & { day: string };

export function ErrorMap({ s }: { s: Summary }) {
  const { qs } = useViewParams();
  const [active, setActive] = useState<Cell | null>(null);
  const maxAbs = useMemo(
    () => Math.max(1, ...s.errorMap.flatMap((r) => r.cells.map((c) => Math.abs(c.errorMw ?? 0)))),
    [s],
  );
  const LW = 76, CW = 30, CH = 15, G = 2, TOP = 20;
  const width = LW + 24 * (CW + G);
  const height = TOP + s.errorMap.length * (CH + G);
  const hourMax = Math.max(1, ...s.byUkHour.map((h) => h.metrics.maeMw ?? 0));
  const fill = (e: number | null) => {
    if (e == null) return "#ffffff";
    const a = 0.16 + 0.84 * Math.min(1, Math.abs(e) / maxAbs);
    return e >= 0 ? `rgba(252,163,17,${a.toFixed(3)})` : `rgba(20,33,61,${a.toFixed(3)})`;
  };
  const activeIv = active;

  return (
    <section className="section" aria-labelledby="map-h">
      <SectionHead
        id="map-h"
        title="When the misses happen"
        lede="Rows are delivery days, columns are UK hours. Orange = forecast above actual (▲), navy = below (▼); darker = bigger miss. Look for stripes (a bad hour every day) and blocks (a bad weather spell)."
        aside={
          <div className="legend" role="group" aria-label="Colour scale">
            <span className="legend__item">
              <span className="swatch" style={{ background: "rgba(20,33,61,1)" }} /> ▼ under
            </span>
            <span className="legend__item">
              <span className="swatch" style={{ background: "#e5e5e5" }} /> ≈ 0
            </span>
            <span className="legend__item">
              <span className="swatch" style={{ background: "rgba(252,163,17,1)", boxShadow: "inset 0 0 0 1px #14213d" }} /> ▲ over
            </span>
            <span className="legend__item num">±{fmtMW(maxAbs)} MW max</span>
          </div>
        }
      />
      <div className="map-wrap">
        <div className="card card--pad" style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Error heat map (scrolls sideways on small screens)">
          <svg className="map-svg" viewBox={`0 0 ${width} ${height + 96}`} role="img" aria-label="Heat map of signed forecast error by delivery day and UK hour. Use the day links or the replay pages for exact values." onMouseLeave={() => setActive(null)} style={{ minWidth: 560 }}>
            {Array.from({ length: 24 }, (_, h) =>
              h % 3 === 0 ? (
                <text key={h} x={LW + h * (CW + G) + CW / 2} y={12} fontSize="11" textAnchor="middle" fill="#5b6477" fontFamily="JetBrains Mono, monospace">
                  {String(h).padStart(2, "0")}
                </text>
              ) : null,
            )}
            {s.errorMap.map((row, r) => (
              <g key={row.deliveryDay}>
                <text x={LW - 8} y={TOP + r * (CH + G) + CH - 3} fontSize="11" textAnchor="end" fill="#5b6477">
                  {fmtDay(row.deliveryDay)}
                </text>
                {row.cells.map((c) => {
                  const h = ukHour(c.startTime);
                  const isActive = active?.startTime === c.startTime;
                  return (
                    <rect
                      key={c.startTime}
                      x={LW + h * (CW + G)}
                      y={TOP + r * (CH + G)}
                      width={CW}
                      height={CH}
                      rx={2}
                      fill={c.status === "scored" ? fill(c.errorMw) : "#ffffff"}
                      stroke={c.status === "scored" ? (isActive ? "#000000" : "none") : "#8a909e"}
                      strokeDasharray={c.status === "scored" ? undefined : "2 2"}
                      strokeWidth={isActive ? 2 : 1}
                      onMouseEnter={() => setActive({ ...c, day: row.deliveryDay })}
                    />
                  );
                })}
              </g>
            ))}
            <text x={LW - 8} y={height + 20} fontSize="11" textAnchor="end" fill="#5b6477">
              MAE by hour
            </text>
            {s.byUkHour.map((h) => {
              const bh = ((h.metrics.maeMw ?? 0) / hourMax) * 64;
              return (
                <rect key={h.ukHour} x={LW + h.ukHour * (CW + G) + 4} y={height + 86 - bh} width={CW - 8} height={bh} rx={3} fill="#14213d">
                  <title>{`${String(h.ukHour).padStart(2, "0")}:00 UK · MAE ${fmtMW(h.metrics.maeMw)} MW · mean error ${fmtMW(h.metrics.meanErrorMw)} MW`}</title>
                </rect>
              );
            })}
            <line x1={LW} x2={width} y1={height + 86} y2={height + 86} stroke="#8a909e" strokeWidth="1" />
          </svg>
        </div>
        <section className="card map-detail" aria-live="polite" aria-label="Selected hour">
          <span className="eyebrow">{activeIv ? "Selected hour" : "Hover a cell"}</span>
          {activeIv ? (
            <>
              <strong style={{ fontSize: "var(--fs-lg)" }}>
                {fmtDay(activeIv.day)} · {fmtTime(activeIv.startTime)}
              </strong>
              <dl className="dl">
                <dt>Error</dt>
                <dd>{activeIv.errorMw == null ? "not scored" : <Dir errorMw={activeIv.errorMw} word />}</dd>
              </dl>
              <Link className="btn" to={`/day/${activeIv.day}${qs({ hour: activeIv.startTime })}`}>
                Open this hour
              </Link>
            </>
          ) : (
            <p style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)" }}>
              Point at any cell to see its signed error. Every value is also listed, hour by hour, on each day's replay page.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}

/* ---------------- gate comparison ---------------- */

export function GateComparison({ s }: { s: Summary }) {
  const { setGate } = useViewParams();
  const base = s.gateComparison.find((g) => g.gate.id === "0920");
  const max = Math.max(...s.gateComparison.map((g) => g.metrics.maeMw ?? 0)) * 1.05;
  return (
    <section className="section" aria-labelledby="gate-h">
      <SectionHead
        id="gate-h"
        title="Is waiting for a later gate worth it?"
        lede={`The same ${s.coverage.expected} delivery hours, scored with the forecast available at each gate. This measures forecast accuracy only: a later gate can also mean a different market, less liquidity and less time to act.`}
      />
      <div className="card gates" role="table" aria-label="Accuracy by gate">
        <div className="gate-row gate-row--head" role="row">
          <span role="columnheader">Gate (day before, UK)</span>
          <span role="columnheader">Run used</span>
          <span role="columnheader">Typical miss (MAE)</span>
          <span role="columnheader">Lean</span>
          <span role="columnheader">vs 09:20</span>
        </div>
        {s.gateComparison.map((g) => {
          const current = g.gate.id === s.gate.id;
          const delta = base && g.metrics.maeMw != null && base.metrics.maeMw != null ? g.metrics.maeMw - base.metrics.maeMw : null;
          return (
            <div key={g.gate.id} className={`gate-row${current ? " is-current" : ""}`} role="row">
              <span role="cell" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" className="btn btn--sm" aria-pressed={current} onClick={() => setGate(g.gate.id)}>
                  <span className="num">{g.gate.time}</span>
                </button>
                <span>{g.gate.label.replace(" GB", "").replace(" day-ahead", "")}</span>
              </span>
              <span role="cell" className="num">
                {Object.keys(g.runsUsed).join(", ")}
              </span>
              <span role="cell" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ flex: 1, background: "var(--alabaster)", borderRadius: 5, height: 10 }} aria-hidden="true">
                  <span className="hbar" style={{ display: "block", width: `${((g.metrics.maeMw ?? 0) / max) * 100}%` }} />
                </span>
                <span className="num">{fmtMW(g.metrics.maeMw)} MW</span>
              </span>
              <span role="cell">
                <Dir errorMw={g.metrics.meanErrorMw} />
              </span>
              <span role="cell" className="num">
                {g.gate.id === "0920" ? "baseline" : delta == null ? "—" : `${delta < 0 ? "−" : "+"}${fmtMW(Math.abs(delta))} MW (${delta < 0 ? "−" : "+"}${fmtPct(Math.abs(delta) / (base?.metrics.maeMw ?? 1))})`}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- largest misses ---------------- */

export function LargestMisses({ misses, onAudit }: { misses: Interval[]; onAudit: (startTime: string) => void }) {
  const [filter, setFilter] = useState<"all" | "over" | "under">("all");
  const rows = misses.filter((m) => filter === "all" || (filter === "over" ? (m.errorMw ?? 0) > 0 : (m.errorMw ?? 0) < 0));
  return (
    <section className="section" aria-labelledby="miss-h">
      <SectionHead
        id="miss-h"
        title="The largest misses"
        lede="Sorted by size of miss. Audit any hour to see which forecast run was used and why later runs were excluded."
        aside={
          <div role="group" aria-label="Filter by direction" style={{ display: "flex", gap: 8 }}>
            {(["all", "over", "under"] as const).map((f) => (
              <button key={f} type="button" className="btn btn--sm" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "over" ? "▲ Over only" : "▼ Under only"}
              </button>
            ))}
          </div>
        }
      />
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="data" style={{ minWidth: 760 }}>
          <caption className="sr-only">Largest forecast misses at the selected gate</caption>
          <thead>
            <tr>
              <th scope="col">Delivery hour (UK)</th>
              <th scope="col" className="r">
                Forecast · MW
              </th>
              <th scope="col" className="r">
                Actual · MW
              </th>
              <th scope="col" className="r" aria-sort="descending">
                Error · MW
              </th>
              <th scope="col">Run used</th>
              <th scope="col">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: "var(--ink-2)" }}>
                  None of the largest misses at this gate go that way.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.startTime}>
                  <th scope="row" style={{ fontWeight: 500 }}>
                    {fmtDayTime(m.startTime)}
                  </th>
                  <td className="r num">{fmtMW(m.forecastMw)}</td>
                  <td className="r num">{fmtMW(m.actualMw)}</td>
                  <td className="r" style={{ fontWeight: 600 }}>
                    <Dir errorMw={m.errorMw} />
                  </td>
                  <td style={{ color: "var(--ink-2)" }}>
                    <span className="num">{m.publishTime ? fmtDayTime(m.publishTime) : "—"}</span> · {fmtDuration(m.ageAtCutoffMinutes)} before gate
                  </td>
                  <td className="r">
                    <button type="button" className="btn btn--sm" onClick={() => onAudit(m.startTime)}>
                      Audit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
