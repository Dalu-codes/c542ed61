from app.domain.normalise import normalise_actuals, normalise_forecasts


def F(pub, start, gen):
    return {"dataset": "WINDFOR", "publishTime": pub, "startTime": start, "generation": gen}


def A(start, gen, pub=None, fuel="WIND", sp=1):
    return {"dataset": "FUELHH", "startTime": start, "publishTime": pub or start,
            "fuelType": fuel, "generation": gen, "settlementPeriod": sp}


P, S = "2026-01-14T07:30:00Z", "2026-01-15T12:00:00Z"


def test_forecast_exact_duplicates_collapse():
    pts, rep = normalise_forecasts([F(P, S, 100), F(P, S, 100)])
    assert len(pts) == 1 and rep.collapsed_duplicates == 1 and not rep.rejected


def test_forecast_conflicting_duplicates_are_rejected_not_guessed():
    pts, rep = normalise_forecasts([F(P, S, 100), F(P, S, 120), F(P, "2026-01-15T13:00:00Z", 5)])
    assert len(pts) == 1
    assert rep.rejected["conflicting_duplicate"] == 2


def test_forecast_invalid_records_are_counted_by_reason():
    pts, rep = normalise_forecasts(
        [
            F("not-a-date", S, 1),
            F(P, "2026-01-15T12:00:00", 1),  # no zone -> refused
            F(P, S, None),
            F(P, S, "abc"),
            F(P, S, True),
            F(P, S, float("nan")),
            F(P, S, -5),
            F(P, S, 1e6),
            F(P, S, "1234"),  # numeric string is fine
        ]
    )
    assert [p.generation_mw for p in pts] == [1234.0]
    assert rep.received == 9 and rep.accepted == 1
    assert rep.rejected == {
        "bad_timestamp": 2,
        "non_numeric_generation": 4,
        "negative_generation": 1,
        "implausibly_high_generation": 1,
    }


def test_actuals_other_fuels_are_rejected():
    pts, rep = normalise_actuals([A(S, 10), A(S, 99, fuel="CCGT")])
    assert len(pts) == 1 and rep.rejected["not_wind"] == 1


def test_actuals_latest_publication_wins_and_is_counted_as_revision():
    pts, rep = normalise_actuals(
        [A(S, 100, pub="2026-01-15T12:30:00Z"), A(S, 110, pub="2026-01-15T13:00:00Z")]
    )
    assert pts[0].generation_mw == 110
    assert rep.revisions_superseded == 1


def test_actuals_conflicting_values_at_same_publication_are_rejected():
    pts, rep = normalise_actuals([A(S, 100, pub="2026-01-15T12:30:00Z"), A(S, 101, pub="2026-01-15T12:30:00Z")])
    assert pts == [] and rep.rejected["conflicting_duplicate"] == 2
