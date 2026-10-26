"""Load the committed snapshot once and keep it in memory.

The snapshot is small (~20k forecast values, ~1.5k actuals), so every request
evaluates from memory in milliseconds and no cache of results is needed.
Raw records are kept alongside the cleaned points so the hour-audit view can
show exactly what Elexon returned.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from . import config
from .domain.models import ActualPoint
from .domain.normalise import QualityReport, normalise_actuals, normalise_forecasts, parse_ts
from .domain.selection import ForecastIndex


class SnapshotMissing(RuntimeError):
    pass


@dataclass(frozen=True)
class Snapshot:
    index: ForecastIndex
    actuals: dict[datetime, ActualPoint]
    forecast_report: QualityReport
    actual_report: QualityReport
    manifest: dict
    raw_forecasts: dict[tuple[datetime, datetime], dict]  # (publish, start) -> record
    raw_actuals: dict[datetime, dict]  # start -> record (latest publication)

    @property
    def snapshot_id(self) -> str:
        return self.manifest.get("generatedAt", "unknown")


def _read(path: Path) -> list[dict]:
    if not path.exists():
        raise SnapshotMissing(f"snapshot file not found: {path}")
    with open(path) as f:
        return json.load(f)


def load_snapshot(data_dir: Path) -> Snapshot:
    windfor = _read(data_dir / "windfor.json")
    fuelhh = _read(data_dir / "fuelhh_wind.json")
    manifest_path = data_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    forecasts, f_rep = normalise_forecasts(windfor)
    actuals, a_rep = normalise_actuals(fuelhh)

    raw_f: dict[tuple[datetime, datetime], dict] = {}
    for r in windfor:
        pub, start = parse_ts(r.get("publishTime")), parse_ts(r.get("startTime"))
        if pub and start:
            raw_f[(pub, start)] = r
    raw_a: dict[datetime, dict] = {}
    by_start = {a.start_time: a for a in actuals}
    for r in fuelhh:
        start = parse_ts(r.get("startTime"))
        a = by_start.get(start) if start else None
        if a is not None and parse_ts(r.get("publishTime")) == a.publish_time:
            raw_a[start] = r

    return Snapshot(
        index=ForecastIndex(forecasts),
        actuals=by_start,
        forecast_report=f_rep,
        actual_report=a_rep,
        manifest=manifest,
        raw_forecasts=raw_f,
        raw_actuals=raw_a,
    )


@lru_cache(maxsize=1)
def get_snapshot() -> Snapshot:
    return load_snapshot(config.DATA_DIR)
