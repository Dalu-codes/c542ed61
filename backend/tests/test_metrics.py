import math

import pytest

from app.domain.metrics import compute_metrics, percentile, signed_error


def test_sign_convention_positive_means_overestimate():
    assert signed_error(forecast_mw=1200, actual_mw=1000) == 200
    assert signed_error(forecast_mw=800, actual_mw=1000) == -200


def test_metrics_match_hand_computed_values():
    # errors: +10, -10, 0, +30
    m = compute_metrics([(110, 100), (90, 100), (100, 100), (130, 100)])
    assert m.n == 4
    assert m.mae_mw == pytest.approx(12.5)
    assert m.rmse_mw == pytest.approx(math.sqrt(275))
    assert m.mean_error_mw == pytest.approx(7.5)
    assert m.p90_abs_error_mw == pytest.approx(24.0)  # |e| sorted 0,10,10,30 -> 10 + 0.7*20
    assert m.mean_actual_mw == pytest.approx(100)
    assert m.relative_mae == pytest.approx(0.125)
    assert (m.n_over, m.n_under) == (2, 1)
    assert (m.max_over_mw, m.max_under_mw) == (30, -10)


def test_rmse_is_at_least_mae_and_punishes_one_big_miss():
    steady = compute_metrics([(110, 100)] * 4)  # four 10 MW misses
    spiky = compute_metrics([(100, 100)] * 3 + [(140, 100)])  # one 40 MW miss
    assert steady.mae_mw == spiky.mae_mw == pytest.approx(10)
    assert steady.rmse_mw == pytest.approx(10)
    assert spiky.rmse_mw == pytest.approx(20)


def test_rmse_splits_exactly_into_bias_and_spread():
    m = compute_metrics([(110, 100), (90, 100), (100, 100), (130, 100)])  # errors 10,-10,0,30
    # population std of errors: mean 7.5; deviations 2.5,-17.5,-7.5,22.5 -> var 218.75
    assert m.spread_mw == pytest.approx(math.sqrt(218.75))
    assert m.rmse_mw ** 2 == pytest.approx(m.mean_error_mw ** 2 + m.spread_mw ** 2)
    assert m.bias_share == pytest.approx(56.25 / 275)


def test_constant_offset_is_all_bias():
    m = compute_metrics([(1500, 1000), (1700, 1200), (900, 400)])  # every error +500
    assert m.spread_mw == pytest.approx(0)
    assert m.bias_share == pytest.approx(1.0)


def test_zero_bias_can_hide_large_errors():
    m = compute_metrics([(1500, 1000), (500, 1000)])
    assert m.mean_error_mw == 0
    assert m.mae_mw == 500


def test_empty_input_yields_nones_not_zeros():
    m = compute_metrics([])
    assert m.n == 0 and m.mae_mw is None and m.rmse_mw is None and m.mean_error_mw is None


def test_relative_mae_undefined_when_mean_actual_is_zero():
    assert compute_metrics([(10, 0)]).relative_mae is None


def test_percentile_edges():
    assert percentile([5], 90) == 5
    assert percentile([1, 2, 3, 4, 5], 0) == 1
    assert percentile([1, 2, 3, 4, 5], 100) == 5
    assert percentile([1, 2, 3, 4, 5], 50) == 3
    with pytest.raises(ValueError):
        percentile([], 50)
