"""Runtime configuration. Everything has a safe default; override with env vars."""

from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Folder holding windfor.json, fuelhh_wind.json and manifest.json.
DATA_DIR = Path(os.environ.get("FORECHECK_DATA_DIR", REPO_ROOT / "data" / "snapshot"))

# Evaluation set agreed for the pilot: decisions made 1-31 Jan 2026, so
# delivery days 2 Jan - 1 Feb 2026 (inclusive).
FIRST_DELIVERY_DAY = date(2026, 1, 2)
LAST_DELIVERY_DAY = date(2026, 2, 1)

# Comma-separated list of browser origins allowed to call the API. Same-origin
# deployments (Vercel) need none; local dev uses the Vite proxy.
CORS_ORIGINS = [o.strip() for o in os.environ.get("FORECHECK_CORS_ORIGINS", "").split(",") if o.strip()]

# Flag a run as "old at the gate" above this age (hours). Display only.
STALE_RUN_HOURS = float(os.environ.get("FORECHECK_STALE_RUN_HOURS", "6"))


def delivery_days() -> list[date]:
    n = (LAST_DELIVERY_DAY - FIRST_DELIVERY_DAY).days + 1
    return [FIRST_DELIVERY_DAY + timedelta(days=i) for i in range(n)]
