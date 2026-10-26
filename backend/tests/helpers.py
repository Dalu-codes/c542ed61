from datetime import datetime, timedelta, timezone

from app.domain.models import ActualPoint, ForecastPoint


def ts(s: str) -> datetime:
    """'2026-01-14T07:30' -> aware UTC datetime."""
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def fp(pub: str, start: str, mw: float) -> ForecastPoint:
    return ForecastPoint(ts(pub), ts(start), mw)


def ap(start: str, mw: float, pub: str | None = None) -> ActualPoint:
    return ActualPoint(ts(start), mw, ts(pub) if pub else None)


def actual_day(day: str, mw_by_halfhour) -> dict:
    """48 half-hourly actuals for a UTC day. ``mw_by_halfhour(i)`` gives the value."""
    start = ts(f"{day}T00:00")
    out = {}
    for i in range(48):
        t = start + timedelta(minutes=30 * i)
        out[t] = ActualPoint(t, float(mw_by_halfhour(i)))
    return out


def run(pub: str, day: str, mw_by_hour) -> list[ForecastPoint]:
    """One forecast run covering the 24 hours of a UTC day."""
    start = ts(f"{day}T00:00")
    return [
        ForecastPoint(ts(pub), start + timedelta(hours=h), float(mw_by_hour(h))) for h in range(24)
    ]
