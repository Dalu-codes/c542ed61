import { api } from "../api/client";
import type { Meta, Summary } from "../api/types";
import { HourAuditDrawer } from "../components/HourAuditDrawer";
import { DecisionCalendar, ErrorMap, GapInsight, GateComparison, LargestMisses, MetricTiles } from "../components/month";
import { ErrorState, LoadingBlock } from "../components/ui";
import { fmtMW } from "../lib/format";
import { useViewParams } from "../lib/params";
import { useApi } from "../lib/useApi";

export function MonthPage() {
  const { gate, setHour } = useViewParams();
  const res = useApi<Summary>(api.summary(gate));
  const meta = useApi<Meta>(api.meta());

  if (res.status === "loading") {
    return (
      <div className="page">
        <LoadingBlock label="Loading January results" />
      </div>
    );
  }
  if (res.status === "error") {
    return (
      <div className="page">
        <ErrorState error={res.error} onRetry={res.retry} what="the January results" />
      </div>
    );
  }
  const s = res.data;
  const m = s.metrics;
  const bias = m.meanErrorMw ?? 0;
  return (
    <div className="page">
      <section className="verdict section" aria-labelledby="verdict-h">
        <span className="eyebrow">
          January 2026 · {s.gate.time} gate · {s.gate.label}
        </span>
        <h1 id="verdict-h">
          At the {s.gate.time} gate, the wind forecast missed by <span className="hl">{fmtMW(m.maeMw)} MW</span> in a typical hour
          and ran <span className="hl">{fmtMW(Math.abs(bias))} MW</span> too {bias >= 0 ? "high" : "low"} on average.
        </h1>
        <p>
          One hour in ten missed by more than <span className="num">{fmtMW(m.p90AbsErrorMw)} MW</span>. The forecast was{" "}
          {bias >= 0 ? "above" : "below"} the actual in{" "}
          <span className="num">{bias >= 0 ? m.nOver : m.nUnder}</span> of <span className="num">{m.n}</span> hours.{" "}
          {s.coverage.scored === s.coverage.expected
            ? `Every one of the ${s.coverage.expected} delivery hours was scored.`
            : `${s.coverage.scored} of ${s.coverage.expected} delivery hours were scored.`}
        </p>
      </section>

      <MetricTiles m={m} coverage={s.coverage} />

      <GapInsight m={m} afterTheFactMw={meta.status === "ok" ? meta.data.findings.afterTheFact.meanErrorMw : null} />

      <DecisionCalendar s={s} />
      <ErrorMap s={s} />
      <GateComparison s={s} />
      <LargestMisses misses={s.largestMisses} onAudit={(t) => setHour(t)} />
      <HourAuditDrawer />
    </div>
  );
}
