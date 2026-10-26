import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { IntervalAudit } from "../api/types";
import { fmtDay, fmtDayTime, fmtDuration, fmtMW, fmtTime } from "../lib/format";
import { useViewParams } from "../lib/params";
import { useApi } from "../lib/useApi";
import { Dir, ErrorState, Skeleton } from "./ui";

/** Provenance for one delivery hour. Opened from any "Audit" button via ?hour=. */
export function HourAuditDrawer() {
  const { gate, hour, setHour } = useViewParams();
  const res = useApi<IntervalAudit>(hour ? api.interval(hour, gate) : null);
  const panel = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!hour) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    title.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHour(null);
      if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>('a[href], button, summary, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      returnTo.current?.focus?.();
    };
  }, [hour, setHour]);

  if (!hour) return null;
  const d = res.status === "ok" ? res.data : null;
  const end = new Date(new Date(hour).getTime() + 3600_000).toISOString();

  return (
    <>
      <div className="scrim" onClick={() => setHour(null)} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" ref={panel}>
        <div className="drawer__head on-navy">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="eyebrow">Hour audit</span>
            <h2 id="drawer-title" tabIndex={-1} ref={title}>
              {fmtDay(hour)} · {fmtTime(hour)}–{fmtTime(end)}
            </h2>
            {d ? (
              <p>
                Decision {fmtDayTime(d.decisionCutoff)} UK · {d.gate.label}
              </p>
            ) : null}
          </div>
          <button type="button" className="drawer__close" onClick={() => setHour(null)} aria-label="Close hour audit">
            ×
          </button>
        </div>
        <div className="drawer__body">
          {res.status === "loading" ? (
            <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span className="sr-only" role="status">
                Loading the audit for this hour
              </span>
              <Skeleton h={48} />
              <Skeleton h={96} />
              <Skeleton h={320} />
            </div>
          ) : res.status === "error" ? (
            <ErrorState error={res.error} onRetry={res.retry} what="this hour's audit" />
          ) : d ? (
            <>
              <p className="rule">
                <strong>Rule:</strong> use the latest forecast run published <strong>at or before</strong> the gate,{" "}
                {fmtDayTime(d.decisionCutoff)} UK.
              </p>

              <dl className="dl card" style={{ padding: 16, fontSize: "var(--fs-md)" }}>
                <dt>Forecast used</dt>
                <dd className="num" style={{ fontWeight: 600 }}>
                  {fmtMW(d.outcome.forecastMw)} MW
                </dd>
                <dt>Actual (half-hour from {fmtTime(hour)})</dt>
                <dd className="num">{fmtMW(d.outcome.actualMw)} MW</dd>
                <dt>Error (forecast − actual)</dt>
                <dd style={{ fontWeight: 600 }}>{d.outcome.errorMw == null ? "not scored" : <Dir errorMw={d.outcome.errorMw} />}</dd>
                <dd style={{ gridColumn: "1 / -1", textAlign: "left", color: "var(--ink-2)", fontSize: "var(--fs-sm)" }}>
                  {d.outcome.errorMw == null
                    ? d.outcome.status === "no_forecast"
                      ? "No run had been published by the gate, so this hour is not scored and no later run is substituted."
                      : "The actual for this half-hour is missing, so this hour is not scored."
                    : d.outcome.errorMw > 0
                      ? "Over-forecast: relying on this forecast alone would have meant buying too little for this hour."
                      : "Under-forecast: relying on this forecast alone would have meant buying too much for this hour."}
                </dd>
              </dl>

              <section aria-labelledby="runs-h" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <h3 id="runs-h" style={{ fontSize: "var(--fs-lg)" }}>
                    Every run that forecast this hour
                  </h3>
                  <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-2)" }}>oldest first · {d.runs.length} runs in total</span>
                </div>
                <ol className="runs">
                  {visibleRuns(d.runs, showAll).map(({ r, i }) => {
                    const gateBefore = r.status === "excluded_after_gate" && (i === 0 || d.runs[i - 1].status !== "excluded_after_gate");
                    return (
                      <FragmentRow key={r.publishTime} gateBefore={gateBefore} cutoff={d.decisionCutoff}>
                        <li className={r.status === "used" ? "is-used" : r.status === "excluded_after_gate" ? "is-excluded" : undefined}>
                          <span className="num">{fmtDayTime(r.publishTime)}</span>
                          <span>
                            <span className="status">
                              {r.status === "used" ? "✓ Used" : r.status === "eligible_older" ? "• Eligible, older" : "⊘ Excluded"}
                            </span>
                            <span className="reason">
                              {r.status === "used"
                                ? `Latest run by the gate · ${fmtDuration(-r.minutesFromCutoff)} before it`
                                : r.status === "eligible_older"
                                  ? "Before the gate, but a newer run exists"
                                  : r.reason.startsWith("Published after this hour")
                                    ? "Published after this hour had begun"
                                    : `Published ${fmtDuration(r.minutesFromCutoff)} after the gate`}
                            </span>
                          </span>
                          <span className="num" style={{ textAlign: "right" }}>
                            {fmtMW(r.forecastMw)}
                          </span>
                        </li>
                      </FragmentRow>
                    );
                  })}
                </ol>
                {d.runs.length > visibleRuns(d.runs, false).length ? (
                  <button type="button" className="btn btn--sm" style={{ alignSelf: "flex-start" }} onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                    {showAll ? "Show fewer runs" : `Show all ${d.runs.length} runs`}
                  </button>
                ) : null}
              </section>

              <section aria-labelledby="why-h" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <h3 id="why-h" style={{ fontSize: "var(--fs-lg)" }}>
                  Why not a later run?
                </h3>
                <p style={{ color: "var(--ink-2)" }}>
                  Later runs are usually closer to what happened, but they didn't exist when the bid was due. Scoring with them
                  would make the forecast look better than it was at decision time (look-ahead bias).
                </p>
              </section>

              <details className="card" style={{ padding: "12px 16px" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 28 }}>Source records (raw, UTC)</summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                  <pre className="raw">{JSON.stringify(d.rawForecast, null, 1)}</pre>
                  <pre className="raw">{JSON.stringify(d.rawActual, null, 1)}</pre>
                  <button
                    type="button"
                    className="btn btn--sm"
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => navigator.clipboard?.writeText(JSON.stringify({ forecast: d.rawForecast, actual: d.rawActual }, null, 2))}
                  >
                    Copy JSON
                  </button>
                </div>
              </details>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** By default show the 3 runs before the gate (ending with the one used) and the first 3 after it. */
function visibleRuns<T extends { status: string }>(runs: T[], all: boolean) {
  const indexed = runs.map((r, i) => ({ r, i }));
  if (all) return indexed;
  const firstExcluded = runs.findIndex((r) => r.status === "excluded_after_gate");
  const cut = firstExcluded < 0 ? runs.length : firstExcluded;
  return indexed.filter(({ i }) => (i < cut && i >= cut - 3) || (i >= cut && i < cut + 3));
}

function FragmentRow({ gateBefore, cutoff, children }: { gateBefore: boolean; cutoff: string; children: ReactNode }) {
  return (
    <>
      {gateBefore ? (
        <li className="gate-line">
          <span aria-hidden="true">◆</span>&nbsp;Gate closes {fmtDayTime(cutoff)}: nothing below was available
        </li>
      ) : null}
      {children}
    </>
  );
}
