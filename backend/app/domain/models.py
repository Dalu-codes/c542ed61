"""Core value types for the forecast evaluation domain.

All timestamps are timezone-aware UTC datetimes. Conversion to UK local time
happens in exactly one place (``gates.decision_cutoff``) so that every
comparison in the domain is UTC-vs-UTC.

Units: ``generation_mw`` is power in megawatts (MW), averaged over the
delivery period. It is *not* energy (MWh).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone


def ensure_utc(ts: datetime) -> datetime:
    """Reject naive datetimes and normalise aware ones to UTC.

    Naive timestamps are the classic source of off-by-one-hour bugs, so the
    domain refuses them instead of guessing a zone.
    """
    if ts.tzinfo is None or ts.tzinfo.utcoffset(ts) is None:
        raise ValueError(f"naive datetime not allowed: {ts!r}")
    return ts.astimezone(timezone.utc)


@dataclass(frozen=True, slots=True)
class ForecastPoint:
    """One value from one WINDFOR forecast run."""

    publish_time: datetime  # when the run was published (availability time)
    start_time: datetime  # start of the delivery interval being forecast
    generation_mw: float

    def __post_init__(self) -> None:
        object.__setattr__(self, "publish_time", ensure_utc(self.publish_time))
        object.__setattr__(self, "start_time", ensure_utc(self.start_time))


@dataclass(frozen=True, slots=True)
class ActualPoint:
    """One half-hourly FUELHH outturn value for fuelType=WIND."""

    start_time: datetime
    generation_mw: float
    publish_time: datetime | None = None
    settlement_period: int | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "start_time", ensure_utc(self.start_time))
        if self.publish_time is not None:
            object.__setattr__(self, "publish_time", ensure_utc(self.publish_time))
