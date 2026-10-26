"""Evaluate decision-time forecasts against actual generation.

Alignment
---------
WINDFOR forecasts are hourly; FUELHH actuals are half-hourly. Scoring
happens on the forecast's own hourly grid:

* ``exact`` (default): forecast for HH:00 vs the actual half-hour that
  starts at HH:00. Pure key match on ``startTime``; nothing is resampled.
* ``hour_mean`` (sensitivity check): forecast for HH:00 vs the mean of the
  HH:00 and HH:30 half-hours. Used to show how much the alignment choice moves
  the metrics.

Missing data is never filled. An interval with no eligible forecast, or with
no actual, is excluded from the metrics and counted under its own reason in
``Coverage``.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Iterable, Mapping, Sequence

from .gates import UK, Gate, decision_cutoff, delivery_day_bounds, steps
from .metrics import Metrics, compute_metrics, signed_error
from .models import ActualPoint
from .selection import ForecastIndex

HALF_HOUR = timedelta(minutes=30)


class Alignment(str, Enum):
    EXACT = "exact"
    HOUR_MEAN = "hour_mean"


class Status(str, Enum):
    SCORED = "scored"
    NO_FORECAST = "no_forecast"  # no run published by the cutoff covers this hour
    NO_ACTUAL = "no_actual"  # outturn missing for the matching half-hour(s)
    NEITHER = "no_forecast_no_actual"


@dataclass(frozen=True, slots=True)
class IntervalResult:
    start_time: datetime
    status: Status
    forecast_mw: float | None
    actual_mw: float | None
    publish_time: datetime | None
    cutoff: datetime

    @property
    def error_mw(self) -> float | None:
        if self.forecast_mw is None or self.actual_mw is None:
            return None
        return signed_error(self.forecast_mw, self.actual_mw)

    @property
    def age_at_cutoff(self) -> timedelta | None:
        return None if self.publish_time is None else self.cutoff - self.publish_time

    @property
    def lead_time(self) -> timedelta | None:
        return None if self.publish_time is None else self.start_time - self.publish_time


@dataclass(frozen=True, slots=True)
class Coverage:
    expected: int
    scored: int
    no_forecast: int
    no_actual: int
    neither: int

    @property
    def ratio(self) -> float:
        return self.scored / self.expected if self.expected else 0.0

    def as_dict(self) -> dict:
        return {
            "expected": self.expected,
            "scored": self.scored,
            "noForecast": self.no_forecast,
            "noActual": self.no_actual,
            "neither": self.neither,
            "ratio": self.ratio,
        }


def coverage_of(intervals: Sequence[IntervalResult]) -> Coverage:
    c = defaultdict(int)
    for iv in intervals:
        c[iv.status] += 1
    return Coverage(
        expected=len(intervals),
        scored=c[Status.SCORED],
        no_forecast=c[Status.NO_FORECAST],
        no_actual=c[Status.NO_ACTUAL],
        neither=c[Status.NEITHER],
    )


def metrics_of(intervals: Iterable[IntervalResult]) -> Metrics:
    """Interval-weighted metrics over scored intervals only."""
    return compute_metrics(
        [(iv.forecast_mw, iv.actual_mw) for iv in intervals if iv.status is Status.SCORED]
    )


@dataclass
class DayEvaluation:
    delivery_day: date
    gate: Gate
    cutoff: datetime
    intervals: list[IntervalResult]
    metrics: Metrics
    coverage: Coverage

    @property
    def runs_used(self) -> list[datetime]:
        return sorted({iv.publish_time for iv in self.intervals if iv.publish_time})


@dataclass
class PeriodEvaluation:
    days: list[DayEvaluation]
    gate: Gate
    alignment: Alignment
    metrics: Metrics = field(init=False)
    coverage: Coverage = field(init=False)

    def __post_init__(self) -> None:
        all_iv = self.intervals
        self.metrics = metrics_of(all_iv)  # from intervals, never from daily metrics
        self.coverage = coverage_of(all_iv)

    @property
    def intervals(self) -> list[IntervalResult]:
        return [iv for d in self.days for iv in d.intervals]

    def by_uk_hour(self) -> dict[int, Metrics]:
        """Metrics per UK clock hour of delivery, pooled across days."""
        groups: dict[int, list[IntervalResult]] = defaultdict(list)
        for iv in self.intervals:
            groups[iv.start_time.astimezone(UK).hour].append(iv)
        return {h: metrics_of(groups[h]) for h in sorted(groups)}

    def largest_misses(self, k: int = 10) -> list[IntervalResult]:
        scored = [iv for iv in self.intervals if iv.status is Status.SCORED]
        return sorted(scored, key=lambda iv: abs(iv.error_mw), reverse=True)[:k]


def _actual_for(
    start: datetime, actuals: Mapping[datetime, ActualPoint], alignment: Alignment
) -> float | None:
    if alignment is Alignment.EXACT:
        a = actuals.get(start)
        return None if a is None else a.generation_mw
    first, second = actuals.get(start), actuals.get(start + HALF_HOUR)
    if first is None or second is None:
        return None
    return (first.generation_mw + second.generation_mw) / 2


def evaluate_day(
    delivery_day: date,
    gate: Gate,
    index: ForecastIndex,
    actuals: Mapping[datetime, ActualPoint],
    alignment: Alignment = Alignment.EXACT,
    grid_minutes: int = 60,
) -> DayEvaluation:
    cutoff = decision_cutoff(delivery_day, gate)
    day_start, day_end = delivery_day_bounds(delivery_day)
    intervals: list[IntervalResult] = []
    for start in steps(day_start, day_end, grid_minutes):
        sel = index.select(start, cutoff)
        actual = _actual_for(start, actuals, alignment)
        if sel is not None and actual is not None:
            status = Status.SCORED
        elif sel is None and actual is None:
            status = Status.NEITHER
        elif sel is None:
            status = Status.NO_FORECAST
        else:
            status = Status.NO_ACTUAL
        intervals.append(
            IntervalResult(
                start_time=start,
                status=status,
                forecast_mw=None if sel is None else sel.generation_mw,
                actual_mw=actual,
                publish_time=None if sel is None else sel.publish_time,
                cutoff=cutoff,
            )
        )
    return DayEvaluation(
        delivery_day, gate, cutoff, intervals, metrics_of(intervals), coverage_of(intervals)
    )


def evaluate_period(
    delivery_days: Sequence[date],
    gate: Gate,
    index: ForecastIndex,
    actuals: Mapping[datetime, ActualPoint],
    alignment: Alignment = Alignment.EXACT,
) -> PeriodEvaluation:
    days = [evaluate_day(d, gate, index, actuals, alignment) for d in delivery_days]
    return PeriodEvaluation(days, gate, alignment)


def after_the_fact_check(
    index: ForecastIndex,
    actuals: Mapping[datetime, ActualPoint],
    window_start: datetime,
    window_end: datetime,
    max_hours_before: int = 6,
) -> Metrics:
    """Score the values each run gives for hours that had ALREADY STARTED when it
    was published (start_time < publish_time, up to ``max_hours_before``).

    These are not forecasts and never enter decision-time metrics. They are a
    diagnostic: if even these after-the-fact values sit far from the metered
    actual, part of the forecast "error" is a gap between what WINDFOR
    describes and what FUELHH meters, not a forecasting miss.
    """
    pairs: list[tuple[float, float]] = []
    for start, run in index.all_points():
        if not (window_start <= start < window_end):
            continue
        lead_h = (start - run.publish_time).total_seconds() / 3600
        if -max_hours_before <= lead_h < 0:
            a = actuals.get(start)
            if a is not None:
                pairs.append((run.generation_mw, a.generation_mw))
    return compute_metrics(pairs)


@dataclass(frozen=True, slots=True)
class LeadBucket:
    lo_hours: int
    hi_hours: int
    metrics: Metrics


def lead_time_profile(
    index: ForecastIndex,
    actuals: Mapping[datetime, ActualPoint],
    window_start: datetime,
    window_end: datetime,
    bucket_hours: int = 6,
    max_hours: int = 48,
) -> list[LeadBucket]:
    """Error by hours-ahead, pooling every run (not just decision-time ones).

    Kept separate from the decision-time view: each bucket mixes forecasts of
    similar lead time, so the buckets are *expected* to differ.
    Only true forecasts count (publish_time strictly before start_time).
    """
    pairs: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for start, run in index.all_points():
        if not (window_start <= start < window_end):
            continue
        lead_h = (start - run.publish_time).total_seconds() / 3600
        if lead_h <= 0 or lead_h > max_hours:
            continue
        a = actuals.get(start)
        if a is None:
            continue
        b = min(int((lead_h - 1e-9) // bucket_hours), max_hours // bucket_hours - 1)
        pairs[b].append((run.generation_mw, a.generation_mw))
    return [
        LeadBucket(b * bucket_hours, (b + 1) * bucket_hours, compute_metrics(pairs[b]))
        for b in range(max_hours // bucket_hours)
    ]
