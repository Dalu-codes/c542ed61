"""The rules that stop the evaluation from using information from the future."""

from datetime import date, datetime

import pytest
from helpers import actual_day, fp, run, ts

from app.domain.evaluation import Status, evaluate_day
from app.domain.gates import parse_gate
from app.domain.selection import ForecastIndex

GATE_0920 = parse_gate("0920")
DELIVERY = date(2026, 1, 15)
CUTOFF = ts("2026-01-14T09:20")  # D-1 09:20 UK == UTC in January
HOUR = "2026-01-15T12:00"


def test_selects_latest_run_published_before_cutoff():
    idx = ForecastIndex([fp("2026-01-14T02:30", HOUR, 100), fp("2026-01-14T07:30", HOUR, 200)])
    sel = idx.select(ts(HOUR), CUTOFF)
    assert sel.publish_time == ts("2026-01-14T07:30")
    assert sel.generation_mw == 200


def test_later_run_is_excluded_even_when_it_is_closer_to_the_actual():
    """Look-ahead guard: the 09:30 run is perfect, but it did not exist at 09:20."""
    actual = 1000.0
    idx = ForecastIndex(
        [
            fp("2026-01-14T07:30", HOUR, 1500.0),  # eligible, 500 MW too high
            fp("2026-01-14T09:30", HOUR, 1000.0),  # 10 min late, exactly right
        ]
    )
    actuals = actual_day("2026-01-15", lambda i: actual)
    day = evaluate_day(DELIVERY, GATE_0920, idx, actuals)
    iv = next(i for i in day.intervals if i.start_time == ts(HOUR))
    assert iv.publish_time == ts("2026-01-14T07:30")
    assert iv.error_mw == pytest.approx(500.0)


def test_run_published_exactly_at_cutoff_is_eligible():
    idx = ForecastIndex([fp("2026-01-14T07:30", HOUR, 1), fp("2026-01-14T09:20", HOUR, 2)])
    assert idx.select(ts(HOUR), CUTOFF).generation_mw == 2


def test_one_second_after_cutoff_is_not_eligible():
    idx = ForecastIndex([fp("2026-01-14T07:30", HOUR, 1)] + [fp("2026-01-14T09:20:01", HOUR, 2)])
    assert idx.select(ts(HOUR), CUTOFF).generation_mw == 1


def test_many_runs_for_one_interval_pick_latest_eligible_regardless_of_input_order():
    pubs = ["2026-01-14T09:30", "2026-01-13T22:30", "2026-01-14T04:30", "2026-01-14T07:30", "2026-01-14T02:30"]
    idx = ForecastIndex([fp(p, HOUR, i) for i, p in enumerate(pubs)])
    sel = idx.select(ts(HOUR), CUTOFF)
    assert sel.publish_time == ts("2026-01-14T07:30")
    assert [r.publish_time for r in idx.runs_for(ts(HOUR))] == sorted(ts(p) for p in pubs)


def test_no_run_before_cutoff_means_no_forecast_not_a_later_one():
    idx = ForecastIndex(run("2026-01-14T11:30", "2026-01-15", lambda h: 500))
    actuals = actual_day("2026-01-15", lambda i: 400)
    day = evaluate_day(DELIVERY, GATE_0920, idx, actuals)
    assert all(iv.status is Status.NO_FORECAST for iv in day.intervals)
    assert all(iv.forecast_mw is None for iv in day.intervals)
    assert day.metrics.n == 0
    assert day.coverage.no_forecast == 24


def test_age_and_lead_time_are_reported():
    idx = ForecastIndex([fp("2026-01-14T07:30", HOUR, 1)])
    sel = idx.select(ts(HOUR), CUTOFF)
    assert sel.age_at_cutoff.total_seconds() == 110 * 60  # 1h50
    assert sel.lead_time.total_seconds() == (24 + 4.5) * 3600


def test_cutoff_after_delivery_start_is_rejected():
    idx = ForecastIndex([fp("2026-01-14T07:30", HOUR, 1)])
    with pytest.raises(ValueError):
        idx.select(ts(HOUR), ts("2026-01-15T12:30"))


def test_naive_datetimes_are_rejected():
    idx = ForecastIndex([fp("2026-01-14T07:30", HOUR, 1)])
    with pytest.raises(ValueError):
        idx.select(datetime(2026, 1, 15, 12), CUTOFF)


def test_duplicate_run_for_same_interval_is_refused():
    with pytest.raises(ValueError):
        ForecastIndex([fp("2026-01-14T07:30", HOUR, 1), fp("2026-01-14T07:30", HOUR, 2)])
