"""Decision cutoffs ("gates") and delivery-day calendars in UK time.

A procurement decision for delivery day D is taken on D-1 at a configurable
UK local time. The default (09:20) is the EPEX GB hourly day-ahead auction;
09:50 is the N2EX (Nord Pool) GB day-ahead gate closure; 15:30 is the EPEX GB
half-hourly auction. These are presets, not market rules the code depends on.

This module is the only place UK local time is converted to UTC.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

UK = ZoneInfo("Europe/London")


@dataclass(frozen=True, slots=True)
class Gate:
    id: str  # "HHMM", used in URLs
    local_time: time
    label: str
    source: str | None = None


GATE_PRESETS: tuple[Gate, ...] = (
    Gate(
        "0920",
        time(9, 20),
        "EPEX GB hourly day-ahead auction",
        "https://modoenergy.com/research/de/wholesale-trading-markets-explainer-gb-n2ex-epex-dayahead-intraday",
    ),
    Gate(
        "0950",
        time(9, 50),
        "N2EX (Nord Pool) GB day-ahead gate closure",
        "https://support.nordpoolgroup.com/support/solutions/articles/8000088463-about-the-day-ahead-gb-auction",
    ),
    Gate(
        "1530",
        time(15, 30),
        "EPEX GB half-hourly day-ahead auction",
        "https://modoenergy.com/research/de/wholesale-trading-markets-explainer-gb-n2ex-epex-dayahead-intraday",
    ),
)
DEFAULT_GATE_ID = "0920"

_GATE_ID = re.compile(r"^([01]\d|2[0-3])([0-5]\d)$")


def parse_gate(gate_id: str) -> Gate:
    """Return a preset gate, or a custom one for any valid "HHMM" string."""
    for g in GATE_PRESETS:
        if g.id == gate_id:
            return g
    m = _GATE_ID.match(gate_id or "")
    if not m:
        raise ValueError(f"gate must be HHMM in UK time, got {gate_id!r}")
    return Gate(gate_id, time(int(m.group(1)), int(m.group(2))), "Custom cutoff")


def decision_cutoff(delivery_day: date, gate: Gate) -> datetime:
    """UTC instant of the decision for ``delivery_day`` (taken on D-1, UK time)."""
    decision_day = delivery_day - timedelta(days=1)
    local = datetime.combine(decision_day, gate.local_time, tzinfo=UK)
    return local.astimezone(timezone.utc)


def delivery_day_bounds(delivery_day: date) -> tuple[datetime, datetime]:
    """[start, end) of a UK delivery day in UTC (23h or 25h on clock-change days)."""
    start = datetime.combine(delivery_day, time(0), tzinfo=UK).astimezone(timezone.utc)
    end = datetime.combine(delivery_day + timedelta(days=1), time(0), tzinfo=UK).astimezone(
        timezone.utc
    )
    return start, end


def steps(start: datetime, end: datetime, minutes: int) -> list[datetime]:
    """Regular UTC grid of interval starts in [start, end)."""
    out, t, step = [], start, timedelta(minutes=minutes)
    while t < end:
        out.append(t)
        t += step
    return out
