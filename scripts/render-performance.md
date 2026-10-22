# Production rendering measurements

`measure_render_performance.mjs` uses the installed Playwright development tools.
Build production output, serve it on localhost, and keep its runtime sources and
artifacts unchanged throughout collection. Run one workload at a time, without
concurrent builds, tests or other benchmarks.

Create a protocol file in an ignored measurement directory:

```json
{
  "schema": "space-sim.render-protocol/1",
  "baseURL": "http://127.0.0.1:4173",
  "distDir": "dist",
  "warmupMs": 10000,
  "windowMs": 30000,
  "windows": 2,
  "probeMs": 3000,
  "cases": [
    { "id": "classic", "game": "classic", "tiles": 0 },
    { "id": "vector", "tiles": 0 },
    { "id": "tiles", "tiles": 0.5 }
  ]
}
```

```sh
node scripts/measure_render_performance.mjs --protocol=private-docs/measurements/protocol.json --out=private-docs/measurements/control
```

Case defaults are Chromium, named hardware WebGL, successor pad, air off, low
graphics, void background, one view, 640x480 CSS pixels and DPR1. Cases can select
`backend: "software"` (named SwiftShader) or `"canvas"` (native fallback), and
Firefox/WebKit Canvas. The strict schema in `scripts/lib/render-performance.mjs`
also defines preset, tile size, camera, zoom, rotation, pan and viewport options.
Actual backend identity is checked; unavailable backends are reported explicitly.

`--cases=id,id` selects a subset. `--resume` requires the same protocol, artifacts,
harness and case selection. Use a new output directory for different evidence.
`--probe-only` collects short instrumented smoke evidence without qualifying
cadence. Diagnostic `skip-cells` deliberately omits pixels and never qualifies an
optimization or visible coverage.

Each normal case has two raw windows of at least 30 seconds in an unpatched
context, followed by a fresh context for separate API counters, source-profiler
history, optional GPU queries, sampled Chromium CPU profiles and post-GC backing
estimates. GPU spans exclude preceding clears and guest contexts; disjoint samples
are rejected. API bytes and post-GC estimates are not native GPU memory peaks.
Device DPR is recorded; renderer quality policies still determine backing scale.

The report records base commit, dirty source hashes, production artifact hashes
and harness hashes. This alone does not prove that old output was compiled from
current sources. An optional `buildProof` file must be recorded from the frozen
sources and their actual build: `{ "commit": "...", "runtimeSourceSha256":
{ "apps/web/src/changed.ts": "..." }, "artifactSha256": { "index.html": "..." } }`.
It must include every dirty runtime path and every production artifact. A mismatch
fails attribution; absence is explicitly reported as unverified coupling.

Keep raw evidence private. `collectionValidated` describes collection completeness;
target budgets, pixel/contact correctness and release acceptance are separate.
