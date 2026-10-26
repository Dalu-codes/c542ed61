"""Application services: the analyses the API and the data audit both need.

This module orchestrates domain functions over the loaded snapshot. It holds no
formulas of its own (those live in ``domain/``) so the API and the audit report
can never disagree.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from . import config
from .domain.evaluation import (
    Alignment,
    PeriodEvaluation,
    after_the_fact_check,
    evaluate_day,
    evaluate_period,
    lead_time_profile,
)
from .domain.gates import GATE_PRESETS, UK, Gate, delivery_day_bounds
from .domain.metrics import Metrics
from .store import Snapshot


def window_bounds() -> tuple[datetime, datetime]:
    start, _ = delivery_day_bounds(config.FIRST_DELIVERY_DAY)
    _, end = delivery_day_bounds(config.LAST_DELIVERY_DAY)
    return start, end


def evaluate(snap: Snapshot, gate: Gate, alignment: Alignment = Alignment.EXACT) -> PeriodEvaluation:
    return evaluate_period(config.delivery_days(), gate, snap.index, snap.actuals, alignment)


def evaluate_one_day(snap: Snapshot, day: date, gate: Gate, alignment: Alignment = Alignment.EXACT):
    return evaluate_day(day, gate, snap.index, snap.actuals, alignment)


def shifted_gate(gate: Gate, minutes_earlier: int) -> Gate:
    """A gate N minutes earlier: equivalent to assuming every run became
    available N minutes after its recorded publishTime."""
    t = (datetime.combine(date(2000, 1, 2), gate.local_time) - timedelta(minutes=minutes_earlier)).time()
    return Gate(f"{t.hour:02d}{t.minute:02d}", t, f"{gate.label} (runs +{minutes_earlier} min)")


@dataclass
class GateResult:
    gate: Gate
    period: PeriodEvaluation
    runs_used: Counter  # UK clock time of run used -> number of delivery days


def gate_comparison(snap: Snapshot, alignment: Alignment = Alignment.EXACT) -> list[GateResult]:
    out = []
    for g in GATE_PRESETS:
        pe = evaluate(snap, g, alignment)
        used = Counter(
            r.astimezone(UK).strftime("%H:%M") for d in pe.days for r in d.runs_used
        )
        out.append(GateResult(g, pe, used))
    return out


def after_the_fact(snap: Snapshot) -> Metrics:
    lo, hi = window_bounds()
    return after_the_fact_check(snap.index, snap.actuals, lo, hi)


def lead_profile(snap: Snapshot, bucket_hours: int = 6, max_hours: int = 48):
    lo, hi = window_bounds()
    return lead_time_profile(snap.index, snap.actuals, lo, hi, bucket_hours, max_hours)


@dataclass
class ScheduleStats:
    runs: int
    days: int
    runs_per_day: Counter  # n runs -> n days
    points_per_run: Counter
    publish_clock_times: Counter  # "HH:MM" UK -> count
    off_schedule_runs: list[datetime]
    start_minutes: Counter  # minute-of-hour of startTime -> count
    first_run: datetime | None
    last_run: datetime | None


def schedule_stats(snap: Snapshot) -> ScheduleStats:
    runs: dict[datetime, int] = defaultdict(int)
    minutes: Counter = Counter()
    for start, rv in snap.index.all_points():
        runs[rv.publish_time] += 1
        minutes[start.minute] += 1
    clock = Counter(p.astimezone(UK).strftime("%H:%M") for p in runs)
    usual = {t for t, c in clock.items() if c >= max(2, len({p.date() for p in runs}) // 2)}
    off = sorted(p for p in runs if p.astimezone(UK).strftime("%H:%M") not in usual)
    per_day = Counter(p.astimezone(UK).date() for p in runs)
    return ScheduleStats(
        runs=len(runs),
        days=len(per_day),
        runs_per_day=Counter(per_day.values()),
        points_per_run=Counter(runs.values()),
        publish_clock_times=clock,
        off_schedule_runs=off,
        start_minutes=minutes,
        first_run=min(runs) if runs else None,
        last_run=max(runs) if runs else None,
    )


@dataclass
class ActualStats:
    half_hours: int
    expected_half_hours: int
    missing: list[datetime]
    publish_lag_minutes: Counter
    late_publications: list[tuple[datetime, int]]  # (start, lag minutes) where lag > 30


def actual_stats(snap: Snapshot) -> ActualStats:
    lo, hi = window_bounds()
    expected, t = [], lo
    while t < hi:
        expected.append(t)
        t += timedelta(minutes=30)
    missing = [t for t in expected if t not in snap.actuals]
    lags: Counter = Counter()
    late = []
    for start, a in snap.actuals.items():
        if a.publish_time is None:
            continue
        lag = int((a.publish_time - start).total_seconds() // 60)
        lags[lag] += 1
        if lag > 30:
            late.append((start, lag))
    return ActualStats(
        half_hours=sum(1 for t in expected if t in snap.actuals),
        expected_half_hours=len(expected),
        missing=missing,
        publish_lag_minutes=lags,
        late_publications=sorted(late),
    )


def findings(snap: Snapshot) -> dict:
    """Audit findings the UI shows on the Method page (all computed, nothing typed)."""
    from .domain.gates import parse_gate

    def m(pe):
        x = pe.metrics
        return {"n": x.n, "maeMw": x.mae_mw, "meanErrorMw": x.mean_error_mw, "rmseMw": x.rmse_mw}

    def runs(pe):
        return sorted({r.astimezone(UK).strftime("%H:%M") for d in pe.days for r in d.runs_used})

    atf = after_the_fact(snap)
    sched = schedule_stats(snap)
    acts = actual_stats(snap)
    base = parse_gate("0920")
    return {
        "afterTheFact": {"n": atf.n, "meanErrorMw": atf.mean_error_mw, "maeMw": atf.mae_mw},
        "alignment": {
            "exact": m(evaluate(snap, base, Alignment.EXACT)),
            "hourMean": m(evaluate(snap, base, Alignment.HOUR_MEAN)),
        },
        "publishLag60": [
            {
                "gateId": g.id,
                "asRecorded": {"runs": runs(a), **m(a)},
                "plus60": {"runs": runs(b), **m(b)},
            }
            for g in GATE_PRESETS
            for a, b in [(evaluate(snap, g), evaluate(snap, shifted_gate(g, 60)))]
        ],
        "schedule": {
            "runs": sched.runs,
            "days": sched.days,
            "runsPerDay": {str(k): v for k, v in sched.runs_per_day.items()},
            "pointsPerRun": {str(k): v for k, v in sched.points_per_run.items()},
            "publishClockTimes": dict(sorted(sched.publish_clock_times.items())),
            "offSchedule": [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in sched.off_schedule_runs],
            "documentedTimes": ["03:30", "05:30", "08:30", "10:30", "12:30", "16:30", "19:30", "23:30"],
        },
        "actuals": {
            "present": acts.half_hours,
            "expected": acts.expected_half_hours,
            "latePublications": [
                {"startTime": s.strftime("%Y-%m-%dT%H:%M:%SZ"), "lagMinutes": lag} for s, lag in acts.late_publications
            ],
        },
    }
