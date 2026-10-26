import type { ApiErrorBody, Day, IntervalAudit, Meta, Summary } from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network", "Couldn't reach the ForeCheck API.");
  }
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, body?.error.code ?? "http_error", body?.error.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  meta: () => "/api/meta",
  summary: (gate: string) => `/api/summary?gate=${encodeURIComponent(gate)}`,
  day: (date: string, gate: string) => `/api/day/${date}?gate=${encodeURIComponent(gate)}`,
  interval: (startTime: string, gate: string) => `/api/interval/${encodeURIComponent(startTime)}?gate=${encodeURIComponent(gate)}`,
};

export type { Day, IntervalAudit, Meta, Summary };
