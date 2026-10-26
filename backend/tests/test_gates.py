from datetime import date

import pytest
from helpers import ts

from app.domain.gates import decision_cutoff, delivery_day_bounds, parse_gate


def test_january_cutoff_is_d_minus_1_at_uk_time_which_is_utc():
    assert decision_cutoff(date(2026, 1, 15), parse_gate("0920")) == ts("2026-01-14T09:20")


def test_first_january_delivery_decision_is_on_new_years_eve():
    assert decision_cutoff(date(2026, 1, 1), parse_gate("0920")) == ts("2025-12-31T09:20")


def test_summer_cutoff_converts_bst_to_utc():
    # 09:20 BST == 08:20 UTC
    assert decision_cutoff(date(2026, 7, 15), parse_gate("0920")) == ts("2026-07-14T08:20")


@pytest.mark.parametrize(
    "day,hours",
    [(date(2026, 1, 15), 24), (date(2026, 3, 29), 23), (date(2026, 10, 25), 25)],
)
def test_uk_delivery_day_length_handles_clock_changes(day, hours):
    start, end = delivery_day_bounds(day)
    assert (end - start).total_seconds() == hours * 3600


def test_presets_and_custom_gates():
    assert parse_gate("0950").label.startswith("N2EX")
    assert parse_gate("0730").local_time.hour == 7


@pytest.mark.parametrize("bad", ["", "920", "2400", "0960", "09:20", "abcd", None])
def test_invalid_gates_are_rejected(bad):
    with pytest.raises(ValueError):
        parse_gate(bad)
