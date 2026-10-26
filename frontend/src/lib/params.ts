import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export const DEFAULT_GATE = "0920";
const GATE_RE = /^([01]\d|2[0-3])[0-5]\d$/;

/** Gate and open hour-audit live in the URL so every view can be shared. */
export function useViewParams() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("gate") ?? DEFAULT_GATE;
  const gate = GATE_RE.test(raw) ? raw : DEFAULT_GATE;
  const hour = params.get("hour");

  const setGate = useCallback(
    (g: string) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (g === DEFAULT_GATE) n.delete("gate");
          else n.set("gate", g);
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  const setHour = useCallback(
    (h: string | null) =>
      setParams((p) => {
        const n = new URLSearchParams(p);
        if (h) n.set("hour", h);
        else n.delete("hour");
        return n;
      }),
    [setParams],
  );
  const qs = (extra?: Record<string, string>) => {
    const n = new URLSearchParams();
    if (gate !== DEFAULT_GATE) n.set("gate", gate);
    for (const [k, v] of Object.entries(extra ?? {})) n.set(k, v);
    const s = n.toString();
    return s ? `?${s}` : "";
  };
  return { gate, hour, setGate, setHour, qs };
}
