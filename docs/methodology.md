# Methodology

## Question

How well did the wind forecast **available at the decision time** predict actual national wind generation for the corresponding delivery interval?

## Evaluation set

- **Decisions:** one per day, made 1–31 January 2026, on D−1 at the gate.
- **Delivery days:** 2 January – 1 February 2026 (31 days × 24 hourly forecast points = 744 scored hours).
- **Gates (UK local time, `Europe/London`):** 09:20 (EPEX GB hourly auction, default), 09:50 (N2EX GB day-ahead gate closure), 15:30 (EPEX GB half-hourly auction). Any `HHMM` is accepted.

## Selection rule (look-ahead-proof)

For delivery interval `t` on day `D`, with cutoff `c(D)` = D−1 at the gate, converted to UTC:

```
used run(t) = the run with the greatest publishTime such that publishTime ≤ c(D) and the run contains startTime = t
```

Implemented in `ForecastIndex.select` (`backend/app/domain/selection.py`) using a binary search over sorted publish times. Because eligibility is filtered first and "latest" is chosen only among eligible runs, a later run can never be selected. `tests/test_selection.py::test_later_run_is_excluded_even_when_it_is_closer_to_the_actual` builds a case where the excluded run is perfect.

If no run qualifies, the interval is `no_forecast`: excluded from metrics, counted in coverage, never filled from a later run or by interpolation.

## Alignment

WINDFOR forecasts are hourly (every `startTime` on :00; verified on all 19,272 values). FUELHH actuals are half-hourly averages ("average MW values over 30 minutes"). Each hourly forecast is matched exactly on `startTime` to the actual half-hour starting at that time. Sensitivity: matching against the mean of both half-hours changes MAE at 09:20 from 2,022 to 2,039 MW.

## Metrics

`e = forecast − actual` (MW). Positive = over-forecast (risk of buying too little).

| Metric | Formula | Notes |
| --- | --- | --- |
| MAE | mean(\|e\|) | Typical miss |
| RMSE | √mean(e²) | Punishes large misses |
| Mean error | mean(e) | Bias, signed |
| Spread | √(RMSE² − ME²) | Standard deviation of errors |
| Bias share | ME² / RMSE² | Share of squared error that is a constant offset |
| P90 \|e\| | 90th percentile, linear interpolation | "1 hour in 10 was worse than…" |
| Relative MAE | MAE / mean(actual) | Not MAPE |
| Coverage | scored / expected | Missing forecast vs missing actual counted separately |

All period figures are computed from interval-level errors. `test_period_metrics_are_interval_weighted_not_mean_of_daily_metrics` shows the difference (136 vs 550 MW in a constructed case).

## Diagnostics (never mixed into decision-time metrics)

- **After-the-fact check:** values a run gives for hours that had already started at publication (up to 6 h). January: +1,548 MW mean gap (n = 1,484). This points to a definition gap between WINDFOR and FUELHH.
- **Lead-time profile:** every run scored by hours-ahead bucket; MAE rises from 1,654 MW (0–6 h) to 2,319 MW (42–48 h).
- **Publish-lag sensitivity:** results if runs became available 60 minutes after `publishTime`.

## Data quality policy

See `backend/app/domain/normalise.py`. Bad timestamps, non-numeric or implausible values, and conflicting duplicates are rejected and counted by reason. Exact duplicates are merged. Revised actuals keep the latest publication. In January nothing was rejected (see `docs/data-audit.md`).
