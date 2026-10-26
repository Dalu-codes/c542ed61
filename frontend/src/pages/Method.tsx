import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import type { Meta } from "../api/types";
import { ErrorState, Skeleton } from "../components/ui";
import { fmtDayTime, fmtMW, fmtSigned } from "../lib/format";
import { useApi } from "../lib/useApi";

const SECTIONS = [
  ["what", "What ForeCheck answers"],
  ["rule", "Which forecast counts"],
  ["metrics", "How misses are measured"],
  ["gap", "The gap that hindsight doesn't close"],
  ["align", "Hourly forecasts, half-hourly actuals"],
  ["audit", "Data audit"],
  ["publish", "Publish times vs documentation"],
  ["limits", "Limitations"],
  ["sources", "Sources and rebuild"],
] as const;

export function MethodPage() {
  const meta = useApi<Meta>(api.meta());
  const loc = useLocation();
  useEffect(() => {
    if (meta.status === "ok" && loc.hash) document.getElementById(loc.hash.slice(1))?.scrollIntoView();
  }, [meta.status, loc.hash]);

  return (
    <div className="page">
      <div className="method-layout">
        <nav aria-label="On this page" className="toc">
          <span className="eyebrow" style={{ marginBottom: 8 }}>
            On this page
          </span>
          {SECTIONS.map(([id, t], i) => (
            <a key={id} href={`#${id}`}>
              {i + 1} · {t}
            </a>
          ))}
        </nav>
        <article className="prose">
          <span className="eyebrow">Method &amp; limits</span>
          <h1 style={{ fontSize: "var(--fs-2xl)" }}>How every number in ForeCheck is produced</h1>
          <p style={{ color: "var(--ink-2)", fontSize: "var(--fs-lg)" }}>
            What the data covers, what it doesn't, and how to rebuild it. Figures on this page come from the snapshot's audit, not
            typed by hand.
          </p>

          <h2 id="what">1 · What ForeCheck answers</h2>
          <ol>
            <li>
              <strong>Visibility:</strong> what the GB national wind forecast said for tomorrow, as it stood at your decision gate.
            </li>
            <li>
              <strong>Evaluation:</strong> how far that forecast was from what national wind generated, when, and in which direction,
              across the 31 decisions made in January 2026.
            </li>
          </ol>

          <h2 id="rule">2 · Which forecast counts</h2>
          <p>
            For each delivery hour ForeCheck uses <strong>the latest forecast run published at or before the gate</strong> on the day
            before delivery. Runs published after the gate are never used, even when they were more accurate; a missing forecast stays
            missing. Gates: 09:20 (EPEX GB hourly auction), 09:50 (N2EX GB day-ahead gate closure), 15:30 (EPEX GB half-hourly auction),
            all UK time.
          </p>
          <div className="formula">used run(hour) = latest run with publishTime ≤ gate(D−1, UK) that contains startTime = hour</div>

          <h2 id="metrics">3 · How misses are measured</h2>
          <p>
            <strong>Error = forecast − actual.</strong> ▲ Positive: the forecast over-called wind (risk of buying too little). ▼
            Negative: it under-called wind (risk of buying too much). Every period figure is computed from individual hours, never by
            averaging daily figures.
          </p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Measures table">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col">Answers</th>
                  <th scope="col">Formula</th>
                </tr>
              </thead>
              <tbody>
                <tr><th scope="row">Typical miss · MAE</th><td>How far off is a typical hour?</td><td className="num">mean(|e|)</td></tr>
                <tr><th scope="row">Big-miss weight · RMSE</th><td>Do a few large misses dominate?</td><td className="num">√mean(e²)</td></tr>
                <tr><th scope="row">Lean · mean error</th><td>Does it lean one way?</td><td className="num">mean(e)</td></tr>
                <tr><th scope="row">Bias share</th><td>How much of the error is a constant offset?</td><td className="num">mean(e)² ÷ RMSE²</td></tr>
                <tr><th scope="row">Bad hour · P90</th><td>How bad is a bad hour?</td><td className="num">90th percentile of |e|</td></tr>
                <tr><th scope="row">Coverage</th><td>Can the sample be trusted?</td><td className="num">scored ÷ expected hours</td></tr>
              </tbody>
            </table>
          </div>
          <p style={{ color: "var(--ink-2)" }}>MAPE is deliberately not used: it divides by the actual and breaks when wind is near zero.</p>

          {meta.status === "loading" ? (
            <Skeleton h={400} />
          ) : meta.status === "error" ? (
            <ErrorState error={meta.error} onRetry={meta.retry} what="the audit figures" />
          ) : (
            <Findings m={meta.data} />
          )}

          <h2 id="limits">8 · Limitations</h2>
          <ul>
            <li><strong>Not a procurement calculator.</strong> How much to buy depends on your demand, contracts, own wind and prices, none of which are in these datasets.</li>
            <li><strong>National, not yours.</strong> This is GB national wind; your portfolio's wind can behave differently.</li>
            <li><strong>Availability is assumed from publishTime.</strong> See section 7 for the documentation mismatch and its impact.</li>
            <li><strong>One month, one season.</strong> 744 hours of January; other seasons may differ.</li>
            <li><strong>Historical snapshot.</strong> Values as published when the snapshot was pulled.</li>
          </ul>

          <h2 id="sources">9 · Sources and rebuild</h2>
          <ul>
            <li><a href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream">Elexon FUELHH stream</a>: half-hourly outturn, fuelType = WIND, “average MW values over 30 minutes”.</li>
            <li><a href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream">Elexon WINDFOR stream</a>: wind forecast runs for “wind farms which are visible to the ESO and have operational metering”.</li>
            <li><a href="https://support.nordpoolgroup.com/support/solutions/articles/8000088463-about-the-day-ahead-gb-auction">Nord Pool GB day-ahead auction</a>: 09:50 gate closure.</li>
            <li><a href="https://modoenergy.com/research/de/wholesale-trading-markets-explainer-gb-n2ex-epex-dayahead-intraday">Modo Energy GB markets explainer</a>: EPEX 09:20 and 15:30 auctions (secondary source).</li>
          </ul>
          <div className="formula">
            python -m app.elexon.ingest --out ../data/snapshot &nbsp;# re-pull from Elexon
            <br />
            python -m app.audit &nbsp;# regenerate docs/data-audit.md
          </div>
        </article>
      </div>
    </div>
  );
}

function Findings({ m }: { m: Meta }) {
  const f = m.findings;
  const q = m.quality;
  return (
    <>
      <h2 id="gap">4 · The gap that hindsight doesn't close</h2>
      <p>
        Each run also contains values for hours that had already started when it was published. They aren't forecasts and never enter
        the decision-time numbers, but they are a useful check: across {f.afterTheFact.n.toLocaleString("en-GB")} such values the run
        still sat <strong className="num">{fmtSigned(f.afterTheFact.meanErrorMw)} MW</strong> away from the metered actual on average.
        Part of every “error” is therefore a difference between what WINDFOR forecasts and what FUELHH meters. Curtailment or a
        coverage difference are plausible causes; these datasets can't confirm either. ForeCheck shows the raw error, which is what a
        buyer relying on WINDFOR experienced, and splits it into a constant part (bias) and a varying part (spread).
      </p>

      <h2 id="align">5 · Hourly forecasts, half-hourly actuals</h2>
      <p>
        WINDFOR forecasts one value per hour; FUELHH reports every half-hour. ForeCheck scores each forecast hour against the actual
        half-hour starting at the same time. Nothing is resampled. As a check, the same hours scored against the mean of both
        half-hours:
      </p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Alignment check table">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Alignment (09:20 gate)</th>
              <th scope="col" className="r">MAE · MW</th>
              <th scope="col" className="r">Mean error · MW</th>
              <th scope="col" className="r">Hours</th>
            </tr>
          </thead>
          <tbody>
            <tr><th scope="row">Exact start time (used)</th><td className="r num">{fmtMW(f.alignment.exact.maeMw)}</td><td className="r num">{fmtSigned(f.alignment.exact.meanErrorMw)}</td><td className="r num">{f.alignment.exact.n}</td></tr>
            <tr><th scope="row">Mean of both half-hours (check)</th><td className="r num">{fmtMW(f.alignment.hourMean.maeMw)}</td><td className="r num">{fmtSigned(f.alignment.hourMean.meanErrorMw)}</td><td className="r num">{f.alignment.hourMean.n}</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="audit">6 · Data audit</h2>
      <p>Every record received is either accepted or counted under a reason.</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Data audit table">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Dataset</th>
              <th scope="col" className="r">Received</th>
              <th scope="col" className="r">Accepted</th>
              <th scope="col">Rejected</th>
              <th scope="col" className="r">Duplicates merged</th>
            </tr>
          </thead>
          <tbody>
            {(["windfor", "fuelhh"] as const).map((k) => (
              <tr key={k}>
                <th scope="row">{k === "windfor" ? "WINDFOR · forecast values" : "FUELHH · WIND half-hours"}</th>
                <td className="r num">{q[k].received.toLocaleString("en-GB")}</td>
                <td className="r num">{q[k].accepted.toLocaleString("en-GB")}</td>
                <td>{Object.keys(q[k].rejected).length ? JSON.stringify(q[k].rejected) : "none"}</td>
                <td className="r num">{q[k].collapsedDuplicates}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul>
        <li>
          <span className="num">{f.schedule.runs}</span> forecast runs over <span className="num">{f.schedule.days}</span> days (
          {Object.entries(f.schedule.runsPerDay).map(([n, d]) => `${n} a day on ${d} days`).join(", ")}), each with{" "}
          {Object.keys(f.schedule.pointsPerRun).join(", ")} hourly points.
        </li>
        <li>
          Off-schedule runs: {f.schedule.offSchedule.length ? f.schedule.offSchedule.map(fmtDayTime).join(", ") : "none"}.
        </li>
        <li>
          Actual half-hours present: <span className="num">{f.actuals.present.toLocaleString("en-GB")}</span> of{" "}
          <span className="num">{f.actuals.expected.toLocaleString("en-GB")}</span>
          {f.actuals.latePublications.length
            ? `; ${f.actuals.latePublications.length} published late (${f.actuals.latePublications.map((l) => `${fmtDayTime(l.startTime)} +${l.lagMinutes} min`).join(", ")}).`
            : "."}
        </li>
      </ul>

      <h2 id="publish">7 · Publish times vs documentation</h2>
      <p>
        Elexon's documentation says runs are published at {f.schedule.documentedTimes.join(", ")}. The January publishTime values are
        one hour earlier ({Object.keys(f.schedule.publishClockTimes).join(", ")}); July data matches the documentation. ForeCheck uses
        publishTime as recorded. If runs really became available 60 minutes later:
      </p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Publish-time sensitivity table">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Gate</th>
              <th scope="col">Run used · as recorded</th>
              <th scope="col" className="r">MAE</th>
              <th scope="col">Run used · +60 min</th>
              <th scope="col" className="r">MAE</th>
            </tr>
          </thead>
          <tbody>
            {f.publishLag60.map((g) => (
              <tr key={g.gateId}>
                <th scope="row" className="num">{g.gateId.slice(0, 2)}:{g.gateId.slice(2)}</th>
                <td className="num">{g.asRecorded.runs.join(", ")}</td>
                <td className="r num">{fmtMW(g.asRecorded.maeMw)}</td>
                <td className="num">{g.plus60.runs.join(", ")}</td>
                <td className="r num">{fmtMW(g.plus60.maeMw)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: "var(--ink-2)" }}>The default 09:20 view is unaffected either way.</p>
    </>
  );
}
