from datetime import date, datetime, timezone

import httpx
import pytest

from app.elexon.client import ElexonClient, ElexonError


def make(handler, retries=3):
    return ElexonClient(http=httpx.Client(transport=httpx.MockTransport(handler)), retries=retries, backoff_s=0)


def test_windfor_sends_utc_publish_window_and_returns_rows():
    seen = {}

    def handler(req: httpx.Request):
        seen.update(req.url.params)
        return httpx.Response(200, json=[{"publishTime": "x"}])

    rows = make(handler).windfor(
        datetime(2026, 1, 14, tzinfo=timezone.utc), datetime(2026, 1, 15, tzinfo=timezone.utc)
    )
    assert rows == [{"publishTime": "x"}]
    assert seen == {"publishDateTimeFrom": "2026-01-14T00:00:00Z", "publishDateTimeTo": "2026-01-15T00:00:00Z"}


def test_fuelhh_requests_wind_only_and_accepts_wrapped_payload():
    def handler(req: httpx.Request):
        assert req.url.params["fuelType"] == "WIND"
        return httpx.Response(200, json={"data": [{"fuelType": "WIND"}]})

    assert make(handler).fuelhh_wind(date(2026, 1, 2), date(2026, 1, 2)) == [{"fuelType": "WIND"}]


def test_transient_errors_are_retried():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return httpx.Response(503) if calls["n"] < 3 else httpx.Response(200, json=[])

    c = make(handler)
    assert c.fuelhh_wind(date(2026, 1, 2), date(2026, 1, 2)) == []
    assert calls["n"] == 3 and len(c.log) == 1


def test_client_errors_are_not_retried():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return httpx.Response(400, text="bad params")

    with pytest.raises(ElexonError):
        make(handler).fuelhh_wind(date(2026, 1, 2), date(2026, 1, 2))
    assert calls["n"] == 1


def test_persistent_failure_raises_after_retries():
    with pytest.raises(ElexonError):
        make(lambda req: httpx.Response(500), retries=2).fuelhh_wind(date(2026, 1, 2), date(2026, 1, 2))
