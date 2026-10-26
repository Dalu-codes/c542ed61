"""Response models: the API contract.

Field names are camelCase on the wire. Timestamps are ISO-8601 UTC strings
ending in "Z"; the frontend formats them in UK time. Power values are MW
(average over the interval) and every MW field name ends in ``Mw``.
Error convention: errorMw = forecastMw - actualMw (positive = over-forecast).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class MetricsOut(Model):
    n: int
    mae_mw: float | None
    rmse_mw: float | None
    mean_error_mw: float | None
    p90_abs_error_mw: float | None
    mean_actual_mw: float | None
    relative_mae: float | None
    spread_mw: float | None
    bias_share: float | None
    n_over: int
    n_under: int
    max_over_mw: float | None
    max_under_mw: float | None


class CoverageOut(Model):
    expected: int
    scored: int
    no_forecast: int
    no_actual: int
    neither: int
    ratio: float


IntervalStatus = Literal["scored", "no_forecast", "no_actual", "no_forecast_no_actual"]


class IntervalOut(Model):
    start_time: str
    status: IntervalStatus
    forecast_mw: float | None
    actual_mw: float | None
    error_mw: float | None
    publish_time: str | None
    age_at_cutoff_minutes: int | None
    lead_minutes: int | None


class GateOut(Model):
    id: str
    time: str
    label: str
    source: str | None


class HealthOut(Model):
    status: Literal["ok"]
    snapshot_id: str


class DaySummaryOut(Model):
    delivery_day: str
    decision_cutoff: str
    run_used: str | None
    run_age_minutes: int | None
    metrics: MetricsOut
    coverage: CoverageOut


class MapCellOut(Model):
    start_time: str
    status: IntervalStatus
    error_mw: float | None


class MapRowOut(Model):
    delivery_day: str
    cells: list[MapCellOut]


class HourProfileOut(Model):
    uk_hour: int
    metrics: MetricsOut


class GateComparisonOut(Model):
    gate: GateOut
    runs_used: dict[str, int]
    metrics: MetricsOut
    coverage: CoverageOut


class SummaryOut(Model):
    gate: GateOut
    alignment: Literal["exact", "hour_mean"]
    metrics: MetricsOut
    coverage: CoverageOut
    days: list[DaySummaryOut]
    error_map: list[MapRowOut]
    by_uk_hour: list[HourProfileOut]
    gate_comparison: list[GateComparisonOut]
    largest_misses: list[IntervalOut]


class ActualOut(Model):
    start_time: str
    actual_mw: float
    settlement_period: int | None


class ForecastValueOut(Model):
    start_time: str
    forecast_mw: float


class LaterRunOut(Model):
    publish_time: str
    minutes_after_cutoff: int
    forecasts: list[ForecastValueOut]


class DayOut(Model):
    delivery_day: str
    gate: GateOut
    alignment: Literal["exact", "hour_mean"]
    decision_cutoff: str
    run_used: str | None
    run_age_minutes: int | None
    stale_run: bool
    metrics: MetricsOut
    coverage: CoverageOut
    hours: list[IntervalOut]
    actuals: list[ActualOut]
    later_runs: list[LaterRunOut]
    previous_day: str | None
    next_day: str | None


RunStatus = Literal["used", "eligible_older", "excluded_after_gate"]


class RunForIntervalOut(Model):
    publish_time: str
    forecast_mw: float
    status: RunStatus
    minutes_from_cutoff: int  # negative = before the gate
    reason: str


class IntervalAuditOut(Model):
    start_time: str
    delivery_day: str
    gate: GateOut
    decision_cutoff: str
    rule: str
    outcome: IntervalOut
    runs: list[RunForIntervalOut]
    raw_forecast: dict | None
    raw_actual: dict | None


class ErrorOut(Model):
    error: dict
