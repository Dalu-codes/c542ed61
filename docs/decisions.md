# Decision log

| # | Decision | Alternatives considered | Why |
| --- | --- | --- | --- |
| 1 | Default gate **09:20 UK on D−1** (EPEX GB hourly), with 09:50 and 15:30 presets and any `HHMM` | A generic "hours ahead" slider; noon | Ties the analysis to a real procurement moment; the earliest major GB gate is the conservative choice |
| 2 | Evaluate **decisions made 1–31 Jan** (delivery 2 Jan – 1 Feb) | Delivery days 1–31 Jan | Literal reading of "decisions made in January" |
| 3 | Score on the forecast's **hourly grid, exact `startTime` match** | Interpolate forecasts to half-hours; hour-mean actuals | No invented values; the hour-mean check shows the choice barely matters (2,022 vs 2,039 MW) |
| 4 | Report **raw error, split into bias + spread**, and show the after-the-fact check | Raw only; a bias-corrected view | Shows what a WINDFOR user experienced, without hiding that part of the gap is definitional; a correction would use hindsight |
| 5 | Use **`publishTime` as recorded**; disclose the documentation mismatch with a +60 min sensitivity | Assume the documented schedule; a user setting | A per-record field beats generic docs text; the default view is unaffected |
| 6 | **Frozen snapshot** loaded in memory; no database | Live API calls; SQLite or Postgres | History doesn't change; reproducible, fast, demo-proof; ~20k rows don't need a database |
| 7 | **Plain-Python domain**, no pandas | pandas or numpy | Small data; small pure functions are easier to test and explain; lighter serverless bundle |
| 8 | **All-Vercel deploy** (static build + Python function), Docker for local | Vercel + Render (Docker); Heroku | One URL, no CORS, no cold-start sleep; Heroku has no free tier. Trade-off: production doesn't run the Docker image |
| 9 | **Hand-built SVG charts**, no chart library | Recharts, d3 | Signed fill between series of different resolution, gate marker, direct labels, keyboard scrubbing; about 150 lines that are fully explainable |
| 10 | Palette: Prussian Blue + Orange with **navy chart canvases**; Poppins + JetBrains Mono | All-light with a darker orange; dark mode | Orange is only 2.0:1 on white, but 7.9:1 on navy; Poppins lacks tabular figures, so numbers use JetBrains Mono |

## What would change beyond a pilot

- Scheduled ingest (daily) into a small database, keeping every forecast vintage.
- The utility's own portfolio wind and demand, to move from "how good is the forecast" to "what does it mean for our position".
- More months, seasonal comparison, and uncertainty bands built from the error history (e.g. P10–P90 by forecast level), with confidence intervals on the metrics.
- Confirm the WINDFOR vs FUELHH definition gap with Elexon/NESO, and the true availability time of each run.
- Frontend component tests and visual regression tests.
