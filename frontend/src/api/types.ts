// Mirrors backend/app/schemas.py. Timestamps are ISO-8601 UTC strings.
// Power values are MW (average over the interval). errorMw = forecastMw - actualMw.

export interface Metrics {
  n: number;
  maeMw: number | null;
  rmseMw: number | null;
  meanErrorMw: number | null;
  p90AbsErrorMw: number | null;
  meanActualMw: number | null;
  relativeMae: number | null;
  spreadMw: number | null;
  biasShare: number | null;
  nOver: number;
  nUnder: number;
  maxOverMw: number | null;
  maxUnderMw: number | null;
}

export interface Coverage {
  expected: number;
  scored: number;
  noForecast: number;
  noActual: number;
  neither: number;
  ratio: number;
}

export type IntervalStatus = "scored" | "no_forecast" | "no_actual" | "no_forecast_no_actual";

export interface Interval {
  startTime: string;
  status: IntervalStatus;
  forecastMw: number | null;
  actualMw: number | null;
  errorMw: number | null;
  publishTime: string | null;
  ageAtCutoffMinutes: number | null;
  leadMinutes: number | null;
}

export interface Gate {
  id: string;
  time: string;
  label: string;
  source: string | null;
}

export interface DaySummary {
  deliveryDay: string;
  decisionCutoff: string;
  runUsed: string | null;
  runAgeMinutes: number | null;
  metrics: Metrics;
  coverage: Coverage;
}

export interface Summary {
  gate: Gate;
  alignment: "exact" | "hour_mean";
  metrics: Metrics;
  coverage: Coverage;
  days: DaySummary[];
  errorMap: { deliveryDay: string; cells: { startTime: string; status: IntervalStatus; errorMw: number | null }[] }[];
  byUkHour: { ukHour: number; metrics: Metrics }[];
  gateComparison: { gate: Gate; runsUsed: Record<string, number>; metrics: Metrics; coverage: Coverage }[];
  largestMisses: Interval[];
}

export interface Day {
  deliveryDay: string;
  gate: Gate;
  alignment: "exact" | "hour_mean";
  decisionCutoff: string;
  runUsed: string | null;
  runAgeMinutes: number | null;
  staleRun: boolean;
  metrics: Metrics;
  coverage: Coverage;
  hours: Interval[];
  actuals: { startTime: string; actualMw: number; settlementPeriod: number | null }[];
  laterRuns: { publishTime: string; minutesAfterCutoff: number; forecasts: { startTime: string; forecastMw: number }[] }[];
  previousDay: string | null;
  nextDay: string | null;
}

export interface IntervalAudit {
  startTime: string;
  deliveryDay: string;
  gate: Gate;
  decisionCutoff: string;
  rule: string;
  outcome: Interval;
  runs: {
    publishTime: string;
    forecastMw: number;
    status: "used" | "eligible_older" | "excluded_after_gate";
    minutesFromCutoff: number;
    reason: string;
  }[];
  rawForecast: Record<string, unknown> | null;
  rawActual: Record<string, unknown> | null;
}

interface MiniMetrics {
  n: number;
  maeMw: number;
  meanErrorMw: number;
  rmseMw: number;
}

export interface Meta {
  product: string;
  snapshot: { id: string; source: string; requests: number; live: boolean; windfor: Record<string, unknown>; fuelhh: Record<string, unknown> };
  evaluation: { firstDeliveryDay: string; lastDeliveryDay: string; decisions: number; timezone: string; decisionRule: string; alignment: string };
  conventions: { units: string; error: string; timestamps: string };
  defaultGate: string;
  gates: Gate[];
  quality: Record<"windfor" | "fuelhh", { received: number; accepted: number; rejected: Record<string, number>; collapsedDuplicates: number; revisionsSuperseded: number }>;
  findings: {
    afterTheFact: { n: number; meanErrorMw: number; maeMw: number };
    alignment: { exact: MiniMetrics; hourMean: MiniMetrics };
    publishLag60: { gateId: string; asRecorded: MiniMetrics & { runs: string[] }; plus60: MiniMetrics & { runs: string[] } }[];
    schedule: {
      runs: number;
      days: number;
      runsPerDay: Record<string, number>;
      pointsPerRun: Record<string, number>;
      publishClockTimes: Record<string, number>;
      offSchedule: string[];
      documentedTimes: string[];
    };
    actuals: { present: number; expected: number; latePublications: { startTime: string; lagMinutes: number }[] };
  };
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
