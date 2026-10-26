"""Decision-time forecast selection.

Rule: for a delivery interval *t* and a decision cutoff *c*, use the most
recent forecast run with ``publish_time <= c`` that contains *t*.

The eligibility filter is applied *before* "take the latest", so a run
published after the cutoff can never be selected, however accurate it is.
That ordering is what prevents look-ahead bias, and
``tests/test_selection.py`` pins it down.
"""

from __future__ import annotations

from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable

from .models import ForecastPoint, ensure_utc


@dataclass(frozen=True, slots=True)
class SelectedForecast:
    start_time: datetime
    publish_time: datetime
    generation_mw: float
    cutoff: datetime

    @property
    def age_at_cutoff(self) -> timedelta:
        """How old the chosen run was when the decision was taken."""
        return self.cutoff - self.publish_time

    @property
    def lead_time(self) -> timedelta:
        """Time from publication to the start of delivery."""
        return self.start_time - self.publish_time


@dataclass(frozen=True, slots=True)
class RunValue:
    publish_time: datetime
    generation_mw: float


class ForecastIndex:
    """Forecast values grouped by delivery interval, ordered by publish time.

    Expects de-duplicated input (one value per (publish_time, start_time));
    see ``normalise.normalise_forecasts``.
    """

    def __init__(self, points: Iterable[ForecastPoint]):
        grouped: dict[datetime, list[RunValue]] = defaultdict(list)
        for p in points:
            grouped[p.start_time].append(RunValue(p.publish_time, p.generation_mw))
        self._by_start: dict[datetime, list[RunValue]] = {}
        self._pub_times: dict[datetime, list[datetime]] = {}
        for start, runs in grouped.items():
            runs.sort(key=lambda r: r.publish_time)
            pubs = [r.publish_time for r in runs]
            if len(pubs) != len(set(pubs)):
                raise ValueError(f"duplicate run for interval {start.isoformat()}")
            self._by_start[start] = runs
            self._pub_times[start] = pubs

    def runs_for(self, start_time: datetime) -> list[RunValue]:
        """Every published value for this interval, oldest first."""
        return list(self._by_start.get(ensure_utc(start_time), ()))

    def select(self, start_time: datetime, cutoff: datetime) -> SelectedForecast | None:
        """Latest value published at or before ``cutoff``; ``None`` if none exists."""
        start_time, cutoff = ensure_utc(start_time), ensure_utc(cutoff)
        if cutoff >= start_time:
            # A "forecast" chosen after delivery has started is not a forecast.
            raise ValueError("cutoff must be before the delivery interval starts")
        pubs = self._pub_times.get(start_time)
        if not pubs:
            return None
        i = bisect_right(pubs, cutoff)  # number of runs with publish_time <= cutoff
        if i == 0:
            return None
        run = self._by_start[start_time][i - 1]
        return SelectedForecast(start_time, run.publish_time, run.generation_mw, cutoff)

    def start_times(self) -> list[datetime]:
        return sorted(self._by_start)

    def all_points(self) -> Iterable[tuple[datetime, RunValue]]:
        for start, runs in self._by_start.items():
            for r in runs:
                yield start, r
