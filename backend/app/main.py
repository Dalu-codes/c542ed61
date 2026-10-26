"""FastAPI routes. Thin by design: parse and validate the request, call the
domain/service layer, and shape JSON. No metric is calculated here.

Run locally (from backend/):  uvicorn app.main:app --reload
OpenAPI docs:                 http://localhost:8000/api/docs
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config, schemas
from .domain.evaluation import Alignment, DayEvaluation, IntervalResult
from .domain.gates import GATE_PRESETS, DEFAULT_GATE_ID, UK, Gate, decision_cutoff, parse_gate
from .domain.metrics import Metrics
from .domain.models import ensure_utc
from .domain.normalise import parse_ts
from functools import lru_cache

from .service import evaluate, evaluate_one_day, findings, gate_comparison
from .store import SnapshotMissing, get_snapshot

log = logging.getLogger("forecheck")

app = FastAPI(
    title="ForeCheck API",
    version="1.0.0",
    description="Decision-time evaluation of GB national wind forecasts (Elexon WINDFOR) "
    "against actual wind generation (Elexon FUELHH), January 2026 decisions.",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)
if config.CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["GET"], allow_headers=["*"]
    )


# ---------- errors: one JSON shape everywhere ----------

class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


@app.exception_handler(ApiError)
async def _api_error(_: Request, e: ApiError):
    return JSONResponse(status_code=e.status, content={"error": {"code": e.code, "message": e.message}})


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, e: RequestValidationError):
    first = e.errors()[0] if e.errors() else {}
    msg = f"{'.'.join(str(x) for x in first.get('loc', []))}: {first.get('msg', 'invalid request')}"
    return JSONResponse(status_code=422, content={"error": {"code": "invalid_request", "message": msg}})


@app.exception_handler(SnapshotMissing)
async def _snapshot_missing(_: Request, e: SnapshotMissing):
    log.error("snapshot missing: %s", e)
    return JSONResponse(status_code=503, content={"error": {"code": "snapshot_unavailable", "message": "The data snapshot could not be loaded."}})


# ---------- helpers ----------

def iso(ts: datetime | None) -> str | None:
    return None if ts is None else ensure_utc(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


def minutes(td: timedelta | None) -> int | None:
    return None if td is None else int(td.total_seconds() // 60)


def gate_or_422(gate_id: str) -> Gate:
    try:
        return parse_gate(gate_id)
    except ValueError as e:
        raise ApiError(422, "invalid_gate", str(e)) from None


def alignment_or_422(value: str) -> Alignment:
    try:
        return Alignment(value)
    except ValueError:
        raise ApiError(422, "invalid_alignment", "alignment must be 'exact' or 'hour_mean'") from None


def day_in_window_or_404(day: date) -> date:
    if not (config.FIRST_DELIVERY_DAY <= day <= config.LAST_DELIVERY_DAY):
        raise ApiError(
            404,
            "day_out_of_range",
            f"delivery day must be between {config.FIRST_DELIVERY_DAY} and {config.LAST_DELIVERY_DAY}",
        )
    return day


def gate_out(g: Gate) -> schemas.GateOut:
    return schemas.GateOut(id=g.id, time=g.local_time.strftime("%H:%M"), label=g.label, source=g.source)


def metrics_out(m: Metrics) -> schemas.MetricsOut:
    return schemas.MetricsOut(**m.as_dict())


def coverage_out(c) -> schemas.CoverageOut:
    return schemas.CoverageOut(**{
        "expected": c.expected, "scored": c.scored, "no_forecast": c.no_forecast,
        "no_actual": c.no_actual, "neither": c.neither, "ratio": c.ratio,
    })


def interval_out(iv: IntervalResult) -> schemas.IntervalOut:
    return schemas.IntervalOut(
        start_time=iso(iv.start_time),
        status=iv.status.value,
        forecast_mw=iv.forecast_mw,
        actual_mw=iv.actual_mw,
        error_mw=iv.error_mw,
        publish_time=iso(iv.publish_time),
        age_at_cutoff_minutes=minutes(iv.age_at_cutoff),
        lead_minutes=minutes(iv.lead_time),
    )


def day_summary(d: DayEvaluation) -> schemas.DaySummaryOut:
    run = d.runs_used[0] if len(d.runs_used) == 1 else None
    return schemas.DaySummaryOut(
        delivery_day=d.delivery_day.isoformat(),
        decision_cutoff=iso(d.cutoff),
        run_used=iso(run),
        run_age_minutes=minutes(d.cutoff - run) if run else None,
        metrics=metrics_out(d.metrics),
        coverage=coverage_out(d.coverage),
    )


# ---------- routes ----------

@app.get("/api/health", response_model=schemas.HealthOut, response_model_by_alias=True, tags=["meta"])
def health():
    return schemas.HealthOut(status="ok", snapshot_id=get_snapshot().snapshot_id)


@app.get("/api/meta", tags=["meta"])
def meta():
    """Gates, evaluation window, conventions, and the data-quality reports."""
    snap = get_snapshot()
    return {
        "product": "ForeCheck",
        "snapshot": {
            "id": snap.snapshot_id,
            "source": snap.manifest.get("source"),
            "windfor": snap.manifest.get("windfor"),
            "fuelhh": snap.manifest.get("fuelhh"),
            "requests": len(snap.manifest.get("requests", [])),
            "live": False,
        },
        "evaluation": {
            "firstDeliveryDay": config.FIRST_DELIVERY_DAY.isoformat(),
            "lastDeliveryDay": config.LAST_DELIVERY_DAY.isoformat(),
            "decisions": len(config.delivery_days()),
            "timezone": "Europe/London",
            "decisionRule": "Latest WINDFOR run with publishTime <= gate on the day before delivery (UK time).",
            "alignment": "exact: hourly forecast vs the half-hour actual starting at the same time",
        },
        "conventions": {
            "units": "MW, average power over the interval",
            "error": "forecastMw - actualMw; positive = over-forecast (risk of buying too little)",
            "timestamps": "ISO-8601 UTC",
        },
        "defaultGate": DEFAULT_GATE_ID,
        "gates": [gate_out(g).model_dump(by_alias=True) for g in GATE_PRESETS],
        "quality": {
            "windfor": snap.forecast_report.as_dict(),
            "fuelhh": snap.actual_report.as_dict(),
        },
        "findings": _findings(snap.snapshot_id),
    }


@lru_cache(maxsize=4)
def _findings(snapshot_id: str) -> dict:
    # Keyed by snapshot id: the snapshot is immutable, so the findings are too.
    return findings(get_snapshot())


@app.get("/api/summary", response_model=schemas.SummaryOut, response_model_by_alias=True, tags=["evaluation"])
def summary(
    gate: str = Query(DEFAULT_GATE_ID, description="Decision gate, HHMM in UK time on D-1"),
    alignment: str = Query("exact", description="exact | hour_mean"),
    misses: int = Query(10, ge=1, le=50),
):
    g, al = gate_or_422(gate), alignment_or_422(alignment)
    snap = get_snapshot()
    pe = evaluate(snap, g, al)
    return schemas.SummaryOut(
        gate=gate_out(g),
        alignment=al.value,
        metrics=metrics_out(pe.metrics),
        coverage=coverage_out(pe.coverage),
        days=[day_summary(d) for d in pe.days],
        error_map=[
            schemas.MapRowOut(
                delivery_day=d.delivery_day.isoformat(),
                cells=[schemas.MapCellOut(start_time=iso(iv.start_time), status=iv.status.value, error_mw=iv.error_mw) for iv in d.intervals],
            )
            for d in pe.days
        ],
        by_uk_hour=[schemas.HourProfileOut(uk_hour=h, metrics=metrics_out(m)) for h, m in pe.by_uk_hour().items()],
        gate_comparison=[
            schemas.GateComparisonOut(
                gate=gate_out(r.gate), runs_used=dict(r.runs_used),
                metrics=metrics_out(r.period.metrics), coverage=coverage_out(r.period.coverage),
            )
            for r in gate_comparison(snap, al)
        ],
        largest_misses=[interval_out(iv) for iv in pe.largest_misses(misses)],
    )


@app.get("/api/day/{delivery_day}", response_model=schemas.DayOut, response_model_by_alias=True, tags=["evaluation"])
def day(delivery_day: date, gate: str = Query(DEFAULT_GATE_ID), alignment: str = Query("exact")):
    g, al = gate_or_422(gate), alignment_or_422(alignment)
    d = day_in_window_or_404(delivery_day)
    snap = get_snapshot()
    ev = evaluate_one_day(snap, d, g, al)
    run = ev.runs_used[-1] if ev.runs_used else None
    age = (ev.cutoff - run) if run else None

    day_start = min(iv.start_time for iv in ev.intervals)
    day_end = max(iv.start_time for iv in ev.intervals) + timedelta(hours=1)
    actuals = [
        schemas.ActualOut(start_time=iso(t), actual_mw=a.generation_mw, settlement_period=a.settlement_period)
        for t, a in sorted(snap.actuals.items()) if day_start <= t < day_end
    ]
    # Runs the team could NOT have used: published after the gate, before delivery began.
    later: dict[datetime, list[schemas.ForecastValueOut]] = {}
    for iv in ev.intervals:
        for rv in snap.index.runs_for(iv.start_time):
            if ev.cutoff < rv.publish_time < day_start:
                later.setdefault(rv.publish_time, []).append(
                    schemas.ForecastValueOut(start_time=iso(iv.start_time), forecast_mw=rv.generation_mw)
                )
    days = config.delivery_days()
    i = days.index(d)
    return schemas.DayOut(
        delivery_day=d.isoformat(),
        gate=gate_out(g),
        alignment=al.value,
        decision_cutoff=iso(ev.cutoff),
        run_used=iso(run),
        run_age_minutes=minutes(age),
        stale_run=bool(age and age.total_seconds() > config.STALE_RUN_HOURS * 3600),
        metrics=metrics_out(ev.metrics),
        coverage=coverage_out(ev.coverage),
        hours=[interval_out(iv) for iv in ev.intervals],
        actuals=actuals,
        later_runs=[
            schemas.LaterRunOut(publish_time=iso(p), minutes_after_cutoff=minutes(p - ev.cutoff), forecasts=v)
            for p, v in sorted(later.items())
        ],
        previous_day=days[i - 1].isoformat() if i > 0 else None,
        next_day=days[i + 1].isoformat() if i < len(days) - 1 else None,
    )


@app.get("/api/interval/{start_time}", response_model=schemas.IntervalAuditOut, response_model_by_alias=True, tags=["evaluation"])
def interval(start_time: str, gate: str = Query(DEFAULT_GATE_ID), alignment: str = Query("exact")):
    """Provenance for one delivery hour: every run that forecast it, and why one was used."""
    g, al = gate_or_422(gate), alignment_or_422(alignment)
    t = parse_ts(start_time)
    if t is None:
        raise ApiError(422, "invalid_start_time", "startTime must be ISO-8601 with a zone, e.g. 2026-01-14T17:00:00Z")
    t = t.astimezone(timezone.utc)
    if t.minute != 0 or t.second != 0:
        raise ApiError(422, "invalid_start_time", "forecasts are hourly: startTime must be on the hour")
    d = day_in_window_or_404(t.astimezone(UK).date())
    snap = get_snapshot()
    ev = evaluate_one_day(snap, d, g, al)
    outcome = next((iv for iv in ev.intervals if iv.start_time == t), None)
    if outcome is None:
        raise ApiError(404, "hour_not_found", "no delivery hour starts at that time")
    cutoff = decision_cutoff(d, g)

    runs = []
    for rv in snap.index.runs_for(t):
        delta = minutes(rv.publish_time - cutoff)
        if outcome.publish_time == rv.publish_time:
            status, reason = "used", "Latest run published at or before the gate"
        elif rv.publish_time <= cutoff:
            status, reason = "eligible_older", "Published before the gate; a newer eligible run exists"
        elif rv.publish_time >= t:
            status, reason = "excluded_after_gate", "Published after this hour had begun"
        else:
            status, reason = "excluded_after_gate", f"Published {delta} min after the gate"
        runs.append(schemas.RunForIntervalOut(
            publish_time=iso(rv.publish_time), forecast_mw=rv.generation_mw, status=status,
            minutes_from_cutoff=delta, reason=reason,
        ))
    raw_f = snap.raw_forecasts.get((outcome.publish_time, t)) if outcome.publish_time else None
    return schemas.IntervalAuditOut(
        start_time=iso(t),
        delivery_day=d.isoformat(),
        gate=gate_out(g),
        decision_cutoff=iso(cutoff),
        rule="Use the latest forecast run published at or before the gate on the day before delivery.",
        outcome=interval_out(outcome),
        runs=runs,
        raw_forecast=raw_f,
        raw_actual=snap.raw_actuals.get(t),
    )
