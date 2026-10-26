"""Thin client for the two Elexon Insights stream endpoints we use.

* FUELHH  - half-hourly generation outturn by fuel type (we request WIND only)
  GET /datasets/FUELHH/stream?settlementDateFrom=YYYY-MM-DD&settlementDateTo=YYYY-MM-DD&fuelType=WIND
* WINDFOR - wind generation forecast runs, filtered by publish time
  GET /datasets/WINDFOR/stream?publishDateTimeFrom=ISO&publishDateTimeTo=ISO

Both are public (no API key) and return a bare JSON array. Requests are made
in small windows (one day each) so that a truncated or failed response only
affects one window, which the ingest log makes visible.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any

import httpx

log = logging.getLogger(__name__)

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class ElexonError(RuntimeError):
    pass


@dataclass(frozen=True)
class FetchLog:
    url: str
    params: dict[str, str]
    status: int
    rows: int
    seconds: float


def _iso_z(ts: datetime) -> str:
    if ts.tzinfo is None:
        raise ValueError("naive datetime")
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class ElexonClient:
    def __init__(
        self,
        base_url: str = BASE_URL,
        timeout_s: float = 60.0,
        retries: int = 3,
        backoff_s: float = 2.0,
        http: httpx.Client | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.retries = retries
        self.backoff_s = backoff_s
        self.http = http or httpx.Client(timeout=timeout_s, headers={"Accept": "application/json"})
        self.log: list[FetchLog] = []

    def _get(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        url = f"{self.base_url}{path}"
        last_err: Exception | None = None
        for attempt in range(1, self.retries + 1):
            t0 = time.monotonic()
            try:
                resp = self.http.get(url, params=params)
                if resp.status_code in RETRYABLE_STATUS:
                    raise ElexonError(f"HTTP {resp.status_code}")
                if resp.status_code != 200:
                    # 4xx other than 429 means our request is wrong: do not retry.
                    raise ElexonError(f"HTTP {resp.status_code}: {resp.text[:300]}")
                body = resp.json()
                rows = body.get("data", body) if isinstance(body, dict) else body
                if not isinstance(rows, list):
                    raise ElexonError(f"unexpected payload type {type(rows).__name__}")
                self.log.append(FetchLog(url, params, resp.status_code, len(rows), time.monotonic() - t0))
                return rows
            except (httpx.HTTPError, ElexonError, ValueError) as e:
                last_err = e
                if isinstance(e, ElexonError) and "HTTP 4" in str(e) and "429" not in str(e):
                    break
                log.warning("Elexon %s %s failed (attempt %d/%d): %s", path, params, attempt, self.retries, e)
                if attempt < self.retries:
                    time.sleep(self.backoff_s * attempt)
        raise ElexonError(f"GET {path} {params} failed: {last_err}")

    def windfor(self, publish_from: datetime, publish_to: datetime) -> list[dict[str, Any]]:
        return self._get(
            "/datasets/WINDFOR/stream",
            {"publishDateTimeFrom": _iso_z(publish_from), "publishDateTimeTo": _iso_z(publish_to)},
        )

    def fuelhh_wind(self, settlement_from: date, settlement_to: date) -> list[dict[str, Any]]:
        return self._get(
            "/datasets/FUELHH/stream",
            {
                "settlementDateFrom": settlement_from.isoformat(),
                "settlementDateTo": settlement_to.isoformat(),
                "fuelType": "WIND",
            },
        )
