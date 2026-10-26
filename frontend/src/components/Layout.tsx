import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Meta } from "../api/types";
import { useViewParams } from "../lib/params";
import { useApi } from "../lib/useApi";
import { api } from "../api/client";

const GATES = [
  { id: "0920", time: "09:20", name: "EPEX hourly" },
  { id: "0950", time: "09:50", name: "N2EX hourly" },
  { id: "1530", time: "15:30", name: "EPEX half-hourly" },
];

function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#fca311" />
      <path d="M7 21 L13 15 L18 18 L25 10" fill="none" stroke="#14213d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GateControl() {
  const { gate, setGate } = useViewParams();
  const custom = !GATES.some((g) => g.id === gate);
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="field-label">Decision gate · day before delivery, UK time</legend>
      <div className="segmented" role="radiogroup" aria-label="Decision gate">
        {GATES.map((g) => (
          <span key={g.id} style={{ display: "contents" }}>
            <input type="radio" id={`gate-${g.id}`} name="gate" value={g.id} checked={gate === g.id} onChange={() => setGate(g.id)} />
            <label htmlFor={`gate-${g.id}`}>
              <span className="seg-time">{g.time}</span>
              <span className="seg-name">{g.name}</span>
            </label>
          </span>
        ))}
        {custom ? (
          <span style={{ display: "contents" }}>
            <input type="radio" id="gate-custom" name="gate" value={gate} checked readOnly />
            <label htmlFor="gate-custom">
              <span className="seg-time">
                {gate.slice(0, 2)}:{gate.slice(2)}
              </span>
              <span className="seg-name">Custom (from URL)</span>
            </label>
          </span>
        ) : null}
      </div>
    </fieldset>
  );
}

export function Layout({ children, toolbar = true }: { children: ReactNode; toolbar?: boolean }) {
  const meta = useApi<Meta>(api.meta());
  const { qs } = useViewParams();
  const loc = useLocation();
  const reviewActive = loc.pathname === "/" || loc.pathname.startsWith("/day");
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header on-navy">
        <div className="wrap site-header__row">
          <Link to={`/${qs()}`} className="brand" aria-label="ForeCheck home">
            <BrandMark />
            <span className="brand__name">ForeCheck</span>
            <span className="brand__tag">Wind forecast audit · GB national wind</span>
          </Link>
          <nav className="nav" aria-label="Primary">
            <Link to={`/${qs()}`} aria-current={reviewActive ? "page" : undefined}>
              January review
            </Link>
            <Link to={`/method${qs()}`} aria-current={loc.pathname === "/method" ? "page" : undefined}>
              Method &amp; limits
            </Link>
          </nav>
        </div>
      </header>
      {toolbar ? (
        <section className="toolbar" aria-label="Evaluation settings">
          <div className="wrap toolbar__row">
            <GateControl />
            <div>
              <span className="field-label">Evaluation set</span>
              <span className="toolbar__fact">31 decisions · made 1–31 Jan 2026 · delivery 2 Jan – 1 Feb</span>
            </div>
            <div>
              <span className="field-label">Units · times</span>
              <span className="toolbar__fact">MW, average over the interval · UK time (GMT)</span>
            </div>
          </div>
        </section>
      ) : null}
      <aside className="wrap" style={{ paddingTop: 16 }} aria-label="Data status">
        <div className="banner" role="note">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flex: "none", marginTop: 2 }}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6M12 7.5v.5" />
          </svg>
          <span>
            <strong>Historical snapshot, not live.</strong> Elexon FUELHH and WINDFOR
            {meta.status === "ok" ? (
              <>
                , pulled <span className="num">{meta.data.snapshot.id.replace("T", " ").replace("Z", " UTC")}</span>
              </>
            ) : null}
            . GB national wind, not your own portfolio. <Link to={`/method${qs()}#audit`}>See the data audit</Link>
          </span>
        </div>
      </aside>
      <main id="main" tabIndex={-1}>
        <div className="wrap">{children}</div>
      </main>
      <footer className="site-footer">
        <div className="wrap site-footer__grid">
          <div>
            <strong>What ForeCheck can't tell you</strong>
            <ul>
              <li>How much power to buy: that needs your demand, contracts, own wind and prices.</li>
              <li>Your own wind output: this is GB national wind.</li>
              <li>Any savings: accuracy is measured, money is not.</li>
            </ul>
          </div>
          <div>
            <strong>Sources</strong>
            <ul>
              <li>
                <a href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream">Elexon FUELHH</a>: actual generation, WIND
              </li>
              <li>
                <a href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream">Elexon WINDFOR</a>: wind forecast runs
              </li>
              <li>Gate times: Nord Pool, EPEX (see Method)</li>
            </ul>
          </div>
          <div>
            <strong>This build</strong>
            <span>
              Pilot · January 2026 decisions only. Snapshot{" "}
              <span className="num">{meta.status === "ok" ? meta.data.snapshot.id : "…"}</span>
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
