"""Pull the January 2026 evaluation data from Elexon into a reproducible snapshot.

Usage (from backend/):
    python -m app.elexon.ingest --out ../data/snapshot

Defaults cover the agreed evaluation set: decisions made 1-31 Jan 2026 for
delivery 2 Jan - 1 Feb 2026.
  * WINDFOR runs published 31 Dec 2025 00:00Z .. 2 Feb 2026 00:00Z (includes
    runs after each cutoff, needed for later gates and the lead-time view)
  * FUELHH WIND for settlement dates 2 Jan .. 1 Feb 2026

Raw records are written exactly as received, plus a manifest of every request
made (URL, params, status, row count), so the snapshot can be audited and
regenerated.
"""

from __future__ import annotations

import argparse
import json
import logging
from dataclasses import asdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from .client import ElexonClient

log = logging.getLogger("ingest")


def _day_windows(first: date, last_exclusive: date):
    d = first
    while d < last_exclusive:
        yield (
            datetime.combine(d, time(0), tzinfo=timezone.utc),
            datetime.combine(d + timedelta(days=1), time(0), tzinfo=timezone.utc),
        )
        d += timedelta(days=1)


def ingest(
    out_dir: Path,
    windfor_from: date = date(2025, 12, 31),
    windfor_to: date = date(2026, 2, 2),
    fuelhh_from: date = date(2026, 1, 2),
    fuelhh_to: date = date(2026, 2, 1),
    client: ElexonClient | None = None,
) -> dict:
    client = client or ElexonClient()
    out_dir.mkdir(parents=True, exist_ok=True)

    windfor: list[dict] = []
    for lo, hi in _day_windows(windfor_from, windfor_to):
        rows = client.windfor(lo, hi)
        log.info("WINDFOR %s: %d rows", lo.date(), len(rows))
        windfor.extend(rows)

    fuelhh: list[dict] = []
    d = fuelhh_from
    while d <= fuelhh_to:
        rows = client.fuelhh_wind(d, d)
        log.info("FUELHH %s: %d rows", d, len(rows))
        fuelhh.extend(rows)
        d += timedelta(days=1)

    def dump(name: str, rows: list[dict]) -> None:
        with open(out_dir / name, "w") as f:
            f.write("[\n")
            f.write(",\n".join(json.dumps(r, separators=(",", ":"), sort_keys=True) for r in rows))
            f.write("\n]\n")

    dump("windfor.json", windfor)
    dump("fuelhh_wind.json", fuelhh)
    manifest = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Elexon Insights API (https://data.elexon.co.uk/bmrs/api/v1)",
        "windfor": {"publishFrom": f"{windfor_from}T00:00:00Z", "publishTo": f"{windfor_to}T00:00:00Z", "rows": len(windfor)},
        "fuelhh": {"settlementDateFrom": str(fuelhh_from), "settlementDateTo": str(fuelhh_to), "fuelType": "WIND", "rows": len(fuelhh)},
        "requests": [asdict(r) for r in client.log],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[3] / "data" / "snapshot")
    p.add_argument("--windfor-from", type=date.fromisoformat, default=date(2025, 12, 31))
    p.add_argument("--windfor-to", type=date.fromisoformat, default=date(2026, 2, 2), help="exclusive")
    p.add_argument("--fuelhh-from", type=date.fromisoformat, default=date(2026, 1, 2))
    p.add_argument("--fuelhh-to", type=date.fromisoformat, default=date(2026, 2, 1), help="inclusive")
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    m = ingest(a.out, a.windfor_from, a.windfor_to, a.fuelhh_from, a.fuelhh_to)
    print(json.dumps({k: m[k] for k in ("generatedAt", "windfor", "fuelhh")}, indent=2))


if __name__ == "__main__":
    main()
