"""API contract tests on a tiny, hand-made snapshot (no network, no real data)."""

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import config, store
from app.main import app

DAY = "2026-01-14"


def _z(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    base = datetime(2026, 1, 14, tzinfo=timezone.utc)
    windfor = []
    # Two runs on D-1: 07:30 (forecast 1,500 MW flat) and 09:30 (1,100 MW flat).
    for pub, mw in [("2026-01-13T07:30:00Z", 1500), ("2026-01-13T09:30:00Z", 1100)]:
        for h in range(24):
            windfor.append({"dataset": "WINDFOR", "publishTime": pub, "startTime": _z(base + timedelta(hours=h)), "generation": mw})
    fuelhh = []
    for i in range(48):
        st = base + timedelta(minutes=30 * i)
        fuelhh.append({
            "dataset": "FUELHH", "fuelType": "WIND", "generation": 1000, "settlementDate": DAY,
            "settlementPeriod": i + 1, "startTime": _z(st), "publishTime": _z(st + timedelta(minutes=30)),
        })
    (tmp_path / "windfor.json").write_text(json.dumps(windfor))
    (tmp_path / "fuelhh_wind.json").write_text(json.dumps(fuelhh))
    (tmp_path / "manifest.json").write_text(json.dumps({"generatedAt": "test-snapshot", "requests": []}))
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    store.get_snapshot.cache_clear()
    yield TestClient(app)
    store.get_snapshot.cache_clear()


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "snapshotId": "test-snapshot"}


def test_meta_exposes_gates_conventions_and_quality(client):
    j = client.get("/api/meta").json()
    assert [g["id"] for g in j["gates"]] == ["0920", "0950", "1530"]
    assert j["snapshot"]["live"] is False
    assert "positive = over-forecast" in j["conventions"]["error"]
    assert j["quality"]["windfor"]["accepted"] == 48


def test_summary_scores_only_hours_with_both_values_and_counts_the_rest(client):
    j = client.get("/api/summary").json()
    assert j["coverage"]["expected"] == 744
    assert j["coverage"]["scored"] == 24
    assert j["metrics"]["meanErrorMw"] == pytest.approx(500)  # 07:30 run at the 09:20 gate
    assert j["metrics"]["biasShare"] == pytest.approx(1.0)
    assert len(j["days"]) == 31 and len(j["errorMap"]) == 31
    assert all(len(row["cells"]) == 24 for row in j["errorMap"])


def test_summary_and_day_agree(client):
    s = client.get("/api/summary").json()
    d = client.get(f"/api/day/{DAY}").json()
    day_row = next(x for x in s["days"] if x["deliveryDay"] == DAY)
    assert day_row["metrics"]["maeMw"] == d["metrics"]["maeMw"]
    assert day_row["runUsed"] == d["runUsed"] == "2026-01-13T07:30:00Z"


def test_gate_changes_the_run_used_and_later_runs_are_listed(client):
    early = client.get(f"/api/day/{DAY}?gate=0920").json()
    late = client.get(f"/api/day/{DAY}?gate=0950").json()
    assert early["runUsed"] == "2026-01-13T07:30:00Z" and early["runAgeMinutes"] == 110
    assert [r["publishTime"] for r in early["laterRuns"]] == ["2026-01-13T09:30:00Z"]
    assert late["runUsed"] == "2026-01-13T09:30:00Z" and late["laterRuns"] == []
    assert late["metrics"]["maeMw"] == pytest.approx(100)
    assert len(early["actuals"]) == 48 and len(early["hours"]) == 24


def test_interval_audit_explains_each_run(client):
    j = client.get(f"/api/interval/{DAY}T17:00:00Z").json()
    statuses = {r["publishTime"]: r["status"] for r in j["runs"]}
    assert statuses == {"2026-01-13T07:30:00Z": "used", "2026-01-13T09:30:00Z": "excluded_after_gate"}
    excluded = next(r for r in j["runs"] if r["status"] == "excluded_after_gate")
    assert excluded["minutesFromCutoff"] == 10
    assert j["outcome"]["errorMw"] == pytest.approx(500)
    assert j["rawForecast"]["generation"] == 1500 and j["rawActual"]["settlementPeriod"] == 35


@pytest.mark.parametrize(
    "url,status,code",
    [
        ("/api/summary?gate=2460", 422, "invalid_gate"),
        ("/api/summary?alignment=nearest", 422, "invalid_alignment"),
        ("/api/day/2026-03-01", 404, "day_out_of_range"),
        ("/api/day/not-a-date", 422, "invalid_request"),
        (f"/api/interval/{DAY}T17:30:00Z", 422, "invalid_start_time"),
        ("/api/interval/yesterday", 422, "invalid_start_time"),
    ],
)
def test_errors_share_one_shape(client, url, status, code):
    r = client.get(url)
    assert r.status_code == status
    assert r.json()["error"]["code"] == code


def test_missing_snapshot_is_a_503_not_a_crash(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "nowhere")
    store.get_snapshot.cache_clear()
    r = TestClient(app).get("/api/summary")
    store.get_snapshot.cache_clear()
    assert r.status_code == 503 and r.json()["error"]["code"] == "snapshot_unavailable"
