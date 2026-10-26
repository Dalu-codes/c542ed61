import { useCallback, useEffect, useState } from "react";

/**
 * Width of an element in CSS px, so SVG charts can draw 1 unit = 1 px and keep
 * text legible on phones. Uses a callback ref so it works for elements that
 * mount after the first render (e.g. once data has loaded).
 */
export function useWidth<T extends HTMLElement>(fallback = 1000) {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(fallback);
  const ref = useCallback((node: T | null) => setEl(node), []);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, w] as const;
}
