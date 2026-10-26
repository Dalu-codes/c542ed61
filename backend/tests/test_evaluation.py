from datetime import date

import pytest
from helpers import actual_day, fp, run, ts

from app.domain.evaluation import (
    Alignment,
    Status,
    after_the_fact_check,
    evaluate_day,
    evaluate_period,
    lead_time_profile,
)
from app.domain.gates import parse_gate
from app.domain.selection import ForecastIndex

G = parse_gate("0920")


def test_exact_alignment_matches_on_start_time_and_ignores_the_half_past_value():
    # Actual: 1000 MW at HH:00, 2000 MW at HH:30.
    actuals = actual_day("2026-01-15", lambda i: 1000 if i % 2 == 0 else 2000)
    idx = ForecastIndex(run("2026-01-14T07:30", "2026-01-15", lambda h: 1100))
    day = evaluate_day(date(2026, 1, 15), G, idx, actuals)
    assert len(day.intervals) == 24
    assert all(iv.actual_mw == 1000 for iv in day.intervals)
    assert day.metrics.mean_error_mw == pytest.approx(100)


def test_hour_mean_alignment_averages_both_half_hours():
    actuals = actual_day("2026-01-15", lambda i: 1000 if i % 2 == 0 else 2000)
    idx = ForecastIndex(run("2026-01-14T07:30", "2026-01-15", lambda h: 1100))
    day = evaluate_day(date(2026, 1, 15), G, idx, actuals, Alignment.HOUR_MEAN)
    assert all(iv.actual_mw == 1500 for iv in day.intervals)
    assert day.metrics.mean_error_mw == pytest.approx(-400)


def test_missing_actual_is_counted_not_scored():
    actuals = actual_day("2026-01-15", lambda i: 1000)
    del actuals[ts("2026-01-15T05:00")]
    idx = ForecastIndex(run("2026-01-14T07:30", "2026-01-15", lambda h: 1000))
    day = evaluate_day(date(2026, 1, 15), G, idx, actuals)
    iv = next(i for i in day.intervals if i.start_time == ts("2026-01-15T05:00"))
    assert iv.status is Status.NO_ACTUAL and iv.error_mw is None
    assert day.coverage.as_dict() == {
        "expected": 24, "scored": 23, "noForecast": 0, "noActual": 1, "neither": 0,
        "ratio": pytest.approx(23 / 24),
    }
    assert day.metrics.n == 23


def test_hour_mean_needs_both_half_hours():
    actuals = actual_day("2026-01-15", lambda i: 1000)
    del actuals[ts("2026-01-15T05:30")]
    idx = ForecastIndex(run("2026-01-14T07:30", "2026-01-15", lambda h: 1000))
    day = evaluate_day(date(2026, 1, 15), G, idx, actuals, Alignment.HOUR_MEAN)
    assert day.coverage.no_actual == 1


def test_partial_run_gives_no_forecast_for_uncovered_hours_without_interpolation():
    pts = [fp("2026-01-14T07:30", f"2026-01-15T{h:02d}:00", 1000) for h in range(24) if h != 13]
    idx = ForecastIndex(pts)
    day = evaluate_day(date(2026, 1, 15), G, idx, actual_day("2026-01-15", lambda i: 900))
    iv = next(i for i in day.intervals if i.start_time == ts("2026-01-15T13:00"))
    assert iv.status is Status.NO_FORECAST and iv.forecast_mw is None


def test_period_metrics_are_interval_weighted_not_mean_of_daily_metrics():
    # Day 1: 24 scored hours, each 100 MW off. Day 2: only 1 scored hour, 1000 MW off.
    idx = ForecastIndex(
        run("2026-01-14T07:30", "2026-01-15", lambda h: 1100)
        + [fp("2026-01-15T07:30", "2026-01-16T00:00", 2000)]
    )
    actuals = {**actual_day("2026-01-15", lambda i: 1000), **actual_day("2026-01-16", lambda i: 1000)}
    period = evaluate_period([date(2026, 1, 15), date(2026, 1, 16)], G, idx, actuals)
    daily = [d.metrics.mae_mw for d in period.days]
    assert daily == [pytest.approx(100), pytest.approx(1000)]
    assert period.metrics.n == 25
    assert period.metrics.mae_mw == pytest.approx((24 * 100 + 1000) / 25)  # 136
    assert period.metrics.mae_mw != pytest.approx(sum(daily) / 2)  # 550 would be wrong
    assert period.coverage.expected == 48 and period.coverage.no_forecast == 23


def test_different_gates_select_different_runs_for_the_same_hours():
    idx = ForecastIndex(
        run("2026-01-14T07:30", "2026-01-15", lambda h: 1500)
        + run("2026-01-14T09:30", "2026-01-15", lambda h: 1100)
    )
    actuals = actual_day("2026-01-15", lambda i: 1000)
    early = evaluate_day(date(2026, 1, 15), parse_gate("0920"), idx, actuals)
    late = evaluate_day(date(2026, 1, 15), parse_gate("0950"), idx, actuals)
    assert early.runs_used == [ts("2026-01-14T07:30")]
    assert late.runs_used == [ts("2026-01-14T09:30")]
    assert early.metrics.mae_mw == 500 and late.metrics.mae_mw == 100


def test_lead_time_profile_buckets_by_hours_ahead_and_skips_non_forecasts():
    hour = "2026-01-15T12:00"
    idx = ForecastIndex(
        [
            fp("2026-01-15T10:00", hour, 1100),  # 2h ahead   -> bucket 0-6
            fp("2026-01-15T03:00", hour, 1300),  # 9h ahead   -> bucket 6-12
            fp("2026-01-15T13:00", hour, 9999),  # after start: not a forecast
        ]
    )
    actuals = actual_day("2026-01-15", lambda i: 1000)
    prof = lead_time_profile(idx, actuals, ts("2026-01-15T00:00"), ts("2026-01-16T00:00"))
    assert prof[0].metrics.n == 1 and prof[0].metrics.mae_mw == 100
    assert prof[1].metrics.n == 1 and prof[1].metrics.mae_mw == 300
    assert sum(b.metrics.n for b in prof) == 2


def test_after_the_fact_check_uses_only_hours_already_started_at_publication():
    hour = "2026-01-15T12:00"
    idx = ForecastIndex(
        [
            fp("2026-01-15T12:30", hour, 1500),  # published 30 min after the hour began
            fp("2026-01-15T17:00", hour, 1300),  # 5 h after
            fp("2026-01-15T19:00", hour, 9999),  # 7 h after: outside the 6 h window
            fp("2026-01-15T10:00", hour, 5000),  # a real forecast: excluded
        ]
    )
    actuals = actual_day("2026-01-15", lambda i: 1000)
    m = after_the_fact_check(idx, actuals, ts("2026-01-15T00:00"), ts("2026-01-16T00:00"))
    assert m.n == 2
    assert m.mean_error_mw == pytest.approx(400)  # (500 + 300) / 2
