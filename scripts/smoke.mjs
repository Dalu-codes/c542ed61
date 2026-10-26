// End-to-end smoke check against a running ForeCheck (local or deployed).
//   node scripts/smoke.mjs https://<your-app>.vercel.app
// Exits non-zero if any check fails. Needs Node 18+ (built-in fetch).
const base = (process.argv[2] ?? "http://localhost:8080").replace(/\/$/, "");
let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
};
const json = async (path) => {
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

await check("frontend serves the app shell", async () => {
  const r = await fetch(base + "/");
  assert(r.ok, `HTTP ${r.status}`);
  assert((await r.text()).includes('id="root"'), "no #root in index.html");
});
await check("client route falls back to the app (deep link)", async () => {
  const r = await fetch(base + "/day/2026-01-14");
  assert(r.ok && (await r.text()).includes('id="root"'), `HTTP ${r.status}`);
});
await check("GET /api/health", async () => assert((await json("/api/health")).status === "ok", "status != ok"));
let s0920;
await check("GET /api/summary scores all 744 hours", async () => {
  s0920 = await json("/api/summary?gate=0920");
  assert(s0920.coverage.expected === 744, `expected=${s0920.coverage.expected}`);
  assert(s0920.days.length === 31, `days=${s0920.days.length}`);
});
await check("gate changes the forecast run used", async () => {
  const early = await json("/api/day/2026-01-14?gate=0920");
  const late = await json("/api/day/2026-01-14?gate=1530");
  assert(early.runUsed !== late.runUsed, `same run used at both gates (${early.runUsed})`);
  assert(new Date(late.runUsed) <= new Date(late.decisionCutoff), "15:30 run used was published after the gate");
  const s1530 = await json("/api/summary?gate=1530");
  assert(s1530.metrics.maeMw !== s0920.metrics.maeMw, "MAE identical across gates");
});
await check("summary and day agree for 14 Jan", async () => {
  const d = await json("/api/day/2026-01-14?gate=0920");
  const row = s0920.days.find((x) => x.deliveryDay === "2026-01-14");
  assert(Math.abs(row.metrics.maeMw - d.metrics.maeMw) < 1e-9, "MAE mismatch");
  assert(new Date(d.runUsed) <= new Date(d.decisionCutoff), "run used was published after the gate!");
});
await check("hour audit never uses a run published after the gate", async () => {
  const a = await json("/api/interval/2026-01-14T17:00:00Z?gate=0920");
  const used = a.runs.find((r) => r.status === "used");
  assert(used && used.minutesFromCutoff <= 0, "used run is after the gate");
});
await check("bad input returns the JSON error shape", async () => {
  const r = await fetch(base + "/api/summary?gate=9999");
  assert(r.status === 422 && (await r.json()).error.code === "invalid_gate", `HTTP ${r.status}`);
});
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
