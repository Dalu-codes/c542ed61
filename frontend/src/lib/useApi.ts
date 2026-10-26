import { useCallback, useEffect, useState } from "react";
import { ApiError, getJson } from "../api/client";

// Tiny fetch hook with an in-memory cache: the snapshot is immutable, so a
// response for a URL never changes during a session.
const cache = new Map<string, unknown>();

export type ApiState<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "error"; data?: undefined; error: ApiError }
  | { status: "ok"; data: T; error?: undefined };

export function useApi<T>(url: string | null): ApiState<T> & { retry: () => void } {
  const [state, setState] = useState<ApiState<T>>(() =>
    url && cache.has(url) ? { status: "ok", data: cache.get(url) as T } : { status: "loading" },
  );
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    if (!url) return;
    if (cache.has(url)) {
      setState({ status: "ok", data: cache.get(url) as T });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: "loading" });
    getJson<T>(url, ctrl.signal)
      .then((data) => {
        cache.set(url, data);
        setState({ status: "ok", data });
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setState({ status: "error", error: e instanceof ApiError ? e : new ApiError(0, "unknown", String(e)) });
      });
    return () => ctrl.abort();
  }, [url, attempt]);

  return { ...state, retry };
}
