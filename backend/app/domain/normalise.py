"""Turn raw Elexon records into clean domain points, recording every decision.

Nothing is dropped silently: each rejected or merged record is counted in a
``QualityReport`` with a reason, and the report is exposed by the API and the
data audit.

Policies
--------
Forecasts (WINDFOR), keyed by (publishTime, startTime):
  * missing/unparseable timestamps or non-numeric/non-finite generation -> rejected
  * negative or implausibly large generation -> rejected (``MAX_PLAUSIBLE_MW``)
  * exact duplicates (same key, same value) -> collapsed to one
  * conflicting duplicates (same key, different values) -> that key is
    rejected entirely; we do not guess which value is right
Actuals (FUELHH):
  * fuelType other than WIND -> rejected (the request filters, this double-checks)
  * same startTime published more than once -> keep the latest publishTime
    (Elexon re-publishes outturn when it is revised); counted as a revision
  * same startTime and publishTime with different values -> rejected
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable

from .models import ActualPoint, ForecastPoint

# GB wind (transmission + embedded) is ~30 GW of capacity in 2026; anything far
# above that is a data error rather than weather.
MAX_PLAUSIBLE_MW = 40_000.0


@dataclass
class QualityReport:
    dataset: str
    received: int = 0
    accepted: int = 0
    rejected: Counter = field(default_factory=Counter)  # reason -> count
    collapsed_duplicates: int = 0
    revisions_superseded: int = 0
    examples: dict[str, list[dict]] = field(default_factory=lambda: defaultdict(list))

    def reject(self, reason: str, record: Any) -> None:
        self.rejected[reason] += 1
        if len(self.examples[reason]) < 3:
            self.examples[reason].append(record if isinstance(record, dict) else {"value": repr(record)})

    def as_dict(self) -> dict:
        return {
            "dataset": self.dataset,
            "received": self.received,
            "accepted": self.accepted,
            "rejected": dict(self.rejected),
            "collapsedDuplicates": self.collapsed_duplicates,
            "revisionsSuperseded": self.revisions_superseded,
            "examples": {k: v for k, v in self.examples.items()},
        }


def parse_ts(value: Any) -> datetime | None:
    """Parse an ISO-8601 timestamp; must carry a zone (Elexon uses 'Z')."""
    if not isinstance(value, str):
        return None
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return ts if ts.tzinfo is not None else None


def parse_mw(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _plausibility(mw: float) -> str | None:
    if mw < 0:
        return "negative_generation"
    if mw > MAX_PLAUSIBLE_MW:
        return "implausibly_high_generation"
    return None


def normalise_forecasts(records: Iterable[dict]) -> tuple[list[ForecastPoint], QualityReport]:
    rep = QualityReport("WINDFOR")
    by_key: dict[tuple[datetime, datetime], list[float]] = defaultdict(list)
    for r in records:
        rep.received += 1
        pub, start, mw = parse_ts(r.get("publishTime")), parse_ts(r.get("startTime")), parse_mw(r.get("generation"))
        if pub is None or start is None:
            rep.reject("bad_timestamp", r)
            continue
        if mw is None:
            rep.reject("non_numeric_generation", r)
            continue
        if reason := _plausibility(mw):
            rep.reject(reason, r)
            continue
        by_key[(pub, start)].append(mw)

    points: list[ForecastPoint] = []
    for (pub, start), values in by_key.items():
        if len(set(values)) > 1:
            for v in values:
                rep.reject("conflicting_duplicate", {"publishTime": pub.isoformat(), "startTime": start.isoformat(), "generation": v})
            continue
        rep.collapsed_duplicates += len(values) - 1
        points.append(ForecastPoint(pub, start, values[0]))
    points.sort(key=lambda p: (p.start_time, p.publish_time))
    rep.accepted = len(points)
    return points, rep


def normalise_actuals(records: Iterable[dict]) -> tuple[list[ActualPoint], QualityReport]:
    rep = QualityReport("FUELHH")
    by_start: dict[datetime, list[tuple[datetime | None, float, int | None]]] = defaultdict(list)
    for r in records:
        rep.received += 1
        if r.get("fuelType") != "WIND":
            rep.reject("not_wind", r)
            continue
        start, pub, mw = parse_ts(r.get("startTime")), parse_ts(r.get("publishTime")), parse_mw(r.get("generation"))
        if start is None:
            rep.reject("bad_timestamp", r)
            continue
        if mw is None:
            rep.reject("non_numeric_generation", r)
            continue
        if reason := _plausibility(mw):
            rep.reject(reason, r)
            continue
        sp = r.get("settlementPeriod")
        by_start[start].append((pub, mw, sp if isinstance(sp, int) else None))

    points: list[ActualPoint] = []
    for start, versions in by_start.items():
        # Latest publication wins; None publish times sort first.
        versions.sort(key=lambda v: (v[0] is not None, v[0] or datetime.min.replace(tzinfo=start.tzinfo)))
        latest_pub = versions[-1][0]
        latest = [v for v in versions if v[0] == latest_pub]
        if len({v[1] for v in latest}) > 1:
            for v in latest:
                rep.reject("conflicting_duplicate", {"startTime": start.isoformat(), "generation": v[1]})
            continue
        rep.collapsed_duplicates += len(latest) - 1
        rep.revisions_superseded += len(versions) - len(latest)
        pub, mw, sp = latest[0]
        points.append(ActualPoint(start, mw, pub, sp))
    points.sort(key=lambda p: p.start_time)
    rep.accepted = len(points)
    return points, rep
