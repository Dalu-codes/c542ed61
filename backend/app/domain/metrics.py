"""Forecast error metrics.

Sign convention, used everywhere (backend, UI, tests, docs)::

    error = forecast - actual
    error > 0  -> forecast OVERestimated wind (risk: buying too little)
    error < 0  -> forecast UNDERestimated wind (risk: buying too much)

All period metrics are computed from interval-level errors. They are never
averaged from daily metrics: the mean of daily MAEs only equals the overall
MAE when every day has the same number of scored intervals.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence


def signed_error(forecast_mw: float, actual_mw: float) -> float:
    return forecast_mw - actual_mw


def percentile(values: Sequence[float], q: float) -> float:
    """Linear-interpolation percentile (same as numpy's default), q in [0, 100]."""
    if not values:
        raise ValueError("percentile of empty sequence")
    if not 0 <= q <= 100:
        raise ValueError("q must be within [0, 100]")
    xs = sorted(values)
    pos = (len(xs) - 1) * q / 100
    lo, hi = math.floor(pos), math.ceil(pos)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


@dataclass(frozen=True, slots=True)
class Metrics:
    n: int  # scored intervals
    mae_mw: float | None
    rmse_mw: float | None
    mean_error_mw: float | None  # bias; positive = over-forecast
    p90_abs_error_mw: float | None
    mean_actual_mw: float | None
    relative_mae: float | None  # MAE / mean actual (a fraction, not %)
    n_over: int  # intervals where the forecast was above actual
    n_under: int
    max_over_mw: float | None  # largest positive error
    max_under_mw: float | None  # most negative error

    @property
    def spread_mw(self) -> float | None:
        """The varying part of the error: standard deviation of the errors.

        Exact identity: RMSE^2 = mean_error^2 + spread^2. It splits the squared
        error into a constant offset (bias) and everything that moves hour to
        hour. Nothing is "corrected"; this is a decomposition.
        """
        if self.rmse_mw is None or self.mean_error_mw is None:
            return None
        return math.sqrt(max(0.0, self.rmse_mw**2 - self.mean_error_mw**2))

    @property
    def bias_share(self) -> float | None:
        """Fraction of the mean squared error explained by the constant bias."""
        if not self.rmse_mw:
            return None
        return (self.mean_error_mw**2) / (self.rmse_mw**2)

    def as_dict(self) -> dict:
        d = {k: getattr(self, k) for k in self.__slots__}
        d["spread_mw"] = self.spread_mw
        d["bias_share"] = self.bias_share
        return d


def compute_metrics(pairs: Sequence[tuple[float, float]]) -> Metrics:
    """Metrics over (forecast_mw, actual_mw) pairs. Empty input -> n=0, Nones."""
    n = len(pairs)
    if n == 0:
        return Metrics(0, None, None, None, None, None, None, 0, 0, None, None)
    errors = [signed_error(f, a) for f, a in pairs]
    abs_errors = [abs(e) for e in errors]
    mae = sum(abs_errors) / n
    rmse = math.sqrt(sum(e * e for e in errors) / n)
    me = sum(errors) / n
    mean_actual = sum(a for _, a in pairs) / n
    return Metrics(
        n=n,
        mae_mw=mae,
        rmse_mw=rmse,
        mean_error_mw=me,
        p90_abs_error_mw=percentile(abs_errors, 90),
        mean_actual_mw=mean_actual,
        relative_mae=(mae / mean_actual) if mean_actual > 0 else None,
        n_over=sum(1 for e in errors if e > 0),
        n_under=sum(1 for e in errors if e < 0),
        max_over_mw=max(errors) if max(errors) > 0 else None,
        max_under_mw=min(errors) if min(errors) < 0 else None,
    )
