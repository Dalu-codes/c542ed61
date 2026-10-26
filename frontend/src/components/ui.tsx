import type { ReactNode } from "react";
import { ApiError } from "../api/client";
import { direction, directionWord, fmtSigned, glyph } from "../lib/format";

/** Over/under is always glyph + sign (+ optional word), never colour alone. */
export function Dir({ errorMw, word = false }: { errorMw: number | null | undefined; word?: boolean }) {
  const d = direction(errorMw);
  return (
    <span className="dir">
      <span className="dir__g" aria-hidden="true">
        {glyph(d)}
      </span>
      <span className="num">{fmtSigned(errorMw)}</span>
      {word ? <span>{directionWord(d)}</span> : <span className="sr-only">{directionWord(d)}</span>}
    </span>
  );
}

export function Skeleton({ h, w = "100%" }: { h: number; w?: string }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <span className="sr-only" role="status">
        {label}
      </span>
      <Skeleton h={40} w="70%" />
      <Skeleton h={20} w="45%" />
      <div className="tiles">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} h={128} />
        ))}
      </div>
      <Skeleton h={320} />
    </div>
  );
}

export function ErrorState({ error, onRetry, what }: { error: ApiError; onRetry: () => void; what: string }) {
  return (
    <div className="error-state" role="alert">
      <strong>ForeCheck couldn't load {what}.</strong>
      <span style={{ color: "var(--ink-2)" }}>
        {error.status === 404 ? error.message : "Nothing is shown from stale data. Try again; if it keeps failing, the API may be down."}
      </span>
      <button type="button" className="btn btn--primary" onClick={onRetry}>
        Retry
      </button>
      <details>
        <summary style={{ cursor: "pointer", fontSize: "var(--fs-sm)" }}>Technical detail</summary>
        <code className="num" style={{ fontSize: 12 }}>
          {error.status || "network"} · {error.code} · {error.message}
        </code>
      </details>
    </div>
  );
}

export function SectionHead({ title, lede, id, aside }: { title: string; lede?: ReactNode; id: string; aside?: ReactNode }) {
  return (
    <div className="section__head">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 id={id} className="section__title">
          {title}
        </h2>
        {lede ? <p className="section__lede">{lede}</p> : null}
      </div>
      {aside}
    </div>
  );
}
