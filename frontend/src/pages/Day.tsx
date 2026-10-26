import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Day } from "../api/types";
import { ChartLegend, ErrorBars, HourTable, ReplayChart, ageText } from "../components/day";
import { HourAuditDrawer } from "../components/HourAuditDrawer";
import { MetricTiles } from "../components/month";
import { Dir, ErrorState, LoadingBlock } from "../components/ui";
import { dayBefore, fmtDay, fmtDayLong, fmtDayTime, fmtMW, fmtTime } from "../lib/format";
import { useViewParams } from "../lib/params";
import { useApi } from "../lib/useApi";
import { useWidth } from "../lib/useWidth";

export function DayPage() {
  const { date = "" } = useParams();
  const { gate, qs, hour, setHour } = useViewParams();
  const nav = useNavigate();
  const res = useApi<Day>(api.day(date, gate));
  const [showLater, setShowLater] = useState(true);
  const [active, setActive] = useState(17);
  const [chartRef, chartW] = useWidth<HTMLDivElement>();
  const [barsRef, barsW] = useWidth<HTMLDivElement>();

  // Opening a day at a specific hour (from the error map or a link) moves the scrubber there.
  useEffect(() => {
    if (res.status !== "ok" || !hour) return;
    const i = res.data.hours.findIndex((h) => h.startTime === hour);
    if (i >= 0) setActive(i);
  }, [res.status, res.data, hour]);

  useEffect(() => {
    document.title = `${fmtDay(date)} · ForeCheck`;
    return () => {
      document.title = "ForeCheck · Wind forecast audit";
    };
  }, [date]);

  if (res.status === "loading") {
    return (
      <div className="page">
        <LoadingBlock label={`Loading ${date}`} />
      </div>
    );
  }
  if (res.status === "error") {
    return (
      <div className="page">
        <ErrorState error={res.error} onRetry={res.retry} what={`delivery day ${date}`} />
      </div>
    );
  }
  const d = res.data;
  const h = d.hours[active];
  const worst = d.hours.reduce((w, x, i) => (Math.abs(x.errorMw ?? 0) > Math.abs(d.hours[w].errorMw ?? 0) ? i : w), 0);

  return (
    <div className="page">
      <div className="section" style={{ gap: 16 }}>
        <nav aria-label="Breadcrumb" style={{ fontSize: "var(--fs-sm)" }}>
          <Link to={`/${qs()}`}>January review</Link> <span aria-hidden="true">/</span> <span aria-current="page">Decision replay</span>
        </nav>
        <div className="section__head">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="eyebrow">Decision replay</span>
            <h1 style={{ fontSize: "var(--fs-2xl)" }}>Delivery · {fmtDayLong(d.deliveryDay)}</h1>
            <p style={{ color: "var(--ink-2)" }}>
              Decided {fmtDayTime(d.decisionCutoff)} UK, at the {d.gate.label} gate
            </p>
          </div>
          <div className="pager">
            <button type="button" className="btn" disabled={!d.previousDay} onClick={() => d.previousDay && nav(`/day/${d.previousDay}${qs()}`)}>
              ‹ {d.previousDay ? fmtDay(d.previousDay) : "—"}
            </button>
            <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "var(--fs-xs)", color: "var(--ink-2)" }}>
              Delivery day
              <select className="select" value={d.deliveryDay} onChange={(e) => nav(`/day/${e.target.value}${qs()}`)}>
                {Array.from({ length: 31 }, (_, i) => {
                  const t = new Date(Date.UTC(2026, 0, 2 + i)).toISOString().slice(0, 10);
                  return (
                    <option key={t} value={t}>
                      {fmtDay(t)}
                    </option>
                  );
                })}
              </select>
            </label>
            <button type="button" className="btn" disabled={!d.nextDay} onClick={() => d.nextDay && nav(`/day/${d.nextDay}${qs()}`)}>
              {d.nextDay ? fmtDay(d.nextDay) : "—"} ›
            </button>
          </div>
        </div>
      </div>

      <section className="card context" aria-label="Decision context">
        <div>
          <span className="k">Decision</span>
          <span className="v">{fmtDayTime(d.decisionCutoff)} UK</span>
          <span className="s">{fmtDay(dayBefore(d.deliveryDay))}, the day before delivery</span>
        </div>
        <div style={{ boxShadow: "inset 0 4px 0 var(--orange)" }}>
          <span className="k">Forecast used</span>
          <span className="v">{d.runUsed ? `Run published ${fmtDayTime(d.runUsed)}` : "No run before the gate"}</span>
          <span className="s">{d.runUsed ? `✓ before the gate · ${ageText(d.runAgeMinutes)}` : "Not scored; nothing substituted"}</span>
        </div>
        <div>
          <span className="k">Delivery</span>
          <span className="v">{fmtDay(d.deliveryDay)} · 00:00–24:00</span>
          <span className="s">
            {d.hours.length} forecast hours · {d.actuals.length} actual half-hours
          </span>
        </div>
        <div>
          <span className="k">Coverage</span>
          <span className="v">
            {d.coverage.scored}/{d.coverage.expected} hours scored
          </span>
          <span className="s">{d.staleRun ? "⏱ Old forecast at the gate" : d.coverage.scored === d.coverage.expected ? "✓ No data gaps" : "◐ Some hours not scored"}</span>
        </div>
      </section>

      <section className="card card--navy chart-card on-navy" aria-labelledby="replay-h">
        <div className="chart-head">
          <div>
            <h2 id="replay-h">What you could see at {d.gate.time}, and what happened</h2>
            <p>Forecast points are hourly; actuals are half-hourly. The shaded gap is the miss.</p>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={showLater} onChange={(e) => setShowLater(e.target.checked)} />
            Show runs published after the gate ({d.laterRuns.length})
          </label>
        </div>
        <ChartLegend showLater={showLater} />
        <div style={{ marginTop: 12 }} ref={chartRef}>
          <ReplayChart day={d} showLater={showLater} active={active} onActive={setActive} width={chartW} />
        </div>
        <div className="readout" aria-live="polite">
          <label style={{ display: "flex", alignItems: "center", gap: 12, flex: "1 1 260px", color: "var(--white)" }}>
            <span style={{ whiteSpace: "nowrap" }}>Hour</span>
            <input
              type="range"
              min={0}
              max={d.hours.length - 1}
              value={active}
              onChange={(e) => setActive(Number(e.target.value))}
              style={{ flex: 1, accentColor: "#fca311", minHeight: 32 }}
              aria-valuetext={h ? `${fmtTime(h.startTime)} UK` : undefined}
            />
          </label>
          {h ? (
            <>
              <strong className="num">
                {fmtTime(h.startTime)}–{fmtTime(new Date(new Date(h.startTime).getTime() + 3600_000).toISOString())}
              </strong>
              <span>
                Forecast <strong className="num">{fmtMW(h.forecastMw)}</strong>
              </span>
              <span>
                Actual <strong className="num">{fmtMW(h.actualMw)}</strong>
              </span>
              <span>
                Error <strong>{h.errorMw == null ? "not scored" : <Dir errorMw={h.errorMw} />}</strong> MW
              </span>
              <button type="button" className="btn btn--sm" onClick={() => setHour(h.startTime)}>
                Audit this hour
              </button>
            </>
          ) : null}
        </div>
      </section>

      <section className="section" aria-labelledby="daynum-h">
        <h2 id="daynum-h" className="section__title" style={{ fontSize: "var(--fs-lg)" }}>
          This day in numbers
        </h2>
        <MetricTiles m={d.metrics} coverage={d.coverage} compact />
        <p style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)" }}>
          Worst hour: <strong className="num">{fmtTime(d.hours[worst].startTime)}</strong> (<Dir errorMw={d.hours[worst].errorMw} /> MW). 24 hours is a
          small sample; read one day alongside the month view.
        </p>
      </section>

      <section className="section" aria-labelledby="bars-h">
        <h2 id="bars-h" className="section__title" style={{ fontSize: "var(--fs-lg)" }}>
          Signed error by hour
        </h2>
        <div className="card card--pad">
          <div ref={barsRef}>
            <ErrorBars hours={d.hours} onPick={setActive} width={barsW} />
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="tbl-h">
        <h2 id="tbl-h" className="section__title" style={{ fontSize: "var(--fs-lg)" }}>
          Hour by hour
        </h2>
        <HourTable day={d} active={active} onAudit={(t) => setHour(t)} />
      </section>
      <HourAuditDrawer />
    </div>
  );
}
