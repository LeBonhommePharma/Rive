# Transit

A public-transit atlas for Québec, Montréal, Sherbrooke and Trois-Rivières, built
from the agencies' own GTFS publications. Free, no account, no subscription.

Live at [thebonhomme.com/transit/](https://thebonhomme.com/transit/).

**On the name.** This repository is `Transit`, the published route is `/transit`, and
the product card on thebonhomme.com is titled *Transit*. The application itself still
identifies as **Rive** — `package.json` `name`, the PWA `manifest.json`, the browser
title, `NOTICE`, and `dist/Rive.app`. Documentation leads with *Transit* because that
is what the repository, the URL and the public entry point all say; *Rive* is the
in-application name and has not been renamed. Converging the two is open work.

## iPhone and iPad app

The native **Rive** app uses SwiftUI, MapKit and the bundled GTFS timetables to search
stops, read departures, keep favourites and plan trips offline. Open
[`ios/Rive.xcodeproj`](ios/Rive.xcodeproj), scheme **Rive**. Test, signing and App Store
export instructions are in [`ios/README.md`](ios/README.md).

## What it does that a trip planner doesn't

Read the next departures **at a stop you are not standing at.** Most transit apps
anchor to your GPS position; this one takes a stop as an argument
(`departuresAtStop` in `src/lib/planner.ts`) and geolocation is optional
(`Permissions-Policy: geolocation=(self)`, `next.config.ts`). Look up your
connection before you leave the house.

Also:

- Map with the agencies' official route colours and GPS trajectories (GTFS `shapes`).
- Walk-plus-transit itineraries with **at most one transfer**. Walk-only up to
  2 800 m; a road-time alternative between 500 m and 200 km (`planner.ts`).
- Nearby bikeshare where a GBFS feed is registered: àVélo in Québec, BIXI in
  Montréal. Sherbrooke and Trois-Rivières have no bikeshare feed in
  `src/lib/registry.json` and show none.

## Coverage

| City | Agencies | Source |
| --- | --- | --- |
| Québec | RTC, STLévis | [RTC](https://www.rtcquebec.ca/donnees-ouvertes), [STLévis](https://www.stlevis.ca/stlevis/donnees-ouvertes) |
| Montréal | STM, STL (Laval), RTL (Longueuil) | [STM](https://www.stm.info/fr/a-propos/developpeurs), [STL](https://stlaval.ca/affaires/donnees-ouvertes), [RTL](https://www.rtl-longueuil.qc.ca/donnees-ouvertes) |
| Sherbrooke | STS | [STS](https://www.sts.qc.ca/a-propos/la-sts/donnees-ouvertes/) |
| Trois-Rivières | STTR | [Données Québec](https://www.donneesquebec.ca/recherche/dataset/gtsf) |

Feed URLs and per-city configuration live in `src/lib/registry.json`. exo, the REM and
the intercity corridor are not covered.

Schedules are the agencies' **planned** timetables. No agency endorses this project.

## Data freshness — read this

The refresh runs every six hours. A feed that cannot be fetched is rebuilt from its
last good archive and flagged in that city's `meta.staleFeeds`; a city with no usable
archive keeps its previous atlas and is named in `index.json` `refreshFailures`.

What does hold, and is enforced in code:

- Ingest refuses a feed whose GTFS calendar has already ended
  (`assertCoverageIncludesToday`, `scripts/gtfs-coverage.mjs`). An expired feed cannot
  be built into the atlas in the first place.
- Past the end of a service window, `activeServices` (`src/lib/services.ts`) matches
  nothing, so the app returns **no departures** rather than wrong ones. The failure
  mode is silence, not a fabricated timetable.

What does not hold: nothing re-checks published data as time passes, and the shipped
UI displays no "last updated" value. The served commit is recoverable from page source
only — `publish-transit.mjs` injects `<meta name="build-sha">` into `index.html`.

## Run locally

Needs `curl` and `unzip` on `PATH` — the ingest script shells out to both. There is no
`engines` field, but `npm test` and `npm run tui` use `--experimental-strip-types` and
`module.registerHooks`, so an early 22.x will not run them. CI pins Node 22; the
commands below were last run on Node v26.7.0 / npm 11.19.0.

```bash
npm install
npm test        # 268 tests — no network
npm run ingest  # downloads official GTFS zips — needs network, no API key
npm run dev
```

`npm run ingest -- --city sherbrooke` rebuilds one city; `RIVE_INGEST_CITY` does the
same through the environment. `npm run ingest:force` re-downloads instead of reusing
the `.cache/gtfs` zips.

`npm run dev` serves the Next application; `/Transit` is rewritten to the standalone
static atlas (`next.config.ts`), which is the artifact that actually ships.

`npm run build` builds the Next application.

## Data pipeline

**Ingest** — `scripts/ingest-gtfs.mjs` reads `src/lib/registry.json`, downloads each
agency zip with `curl -L --fail` into `.cache/gtfs/`, validates the archive (entry-name
allowlist, entry count, compressed and uncompressed size caps, mandatory `routes.txt`),
merges the feeds of a city into one atlas, asserts calendar coverage, and writes
`public/data/<city>/{atlas,timetable,meta}.json` plus a top-level `public/data/index.json`.

Linked per city: stops and stations, routes with official colours, `shapes`
trajectories, and `stop_times` resolved against `calendar` / `calendar_dates`.

**Refresh** — `.github/workflows/update-gtfs.yml`, cron `17 */6 * * *` (every six
hours). Runs the ingest with `--force`, commits `public/data` only if it changed, then
explicitly starts the deploy gate. It installs no dependencies: the ingest uses Node
built-ins and the checked-in catalog only.

**Gate** — `.github/workflows/deploy.yml`. Gate A runs `npm test` and refuses to ship a
red build. Gate B composes the publishable tree with `scripts/publish-transit.mjs
compose` and verifies it with `verify-artifact`, which fails the run on any of: an
`index.html` under 30 000 bytes, a missing `build-sha` stamp, an absent required marker,
a present forbidden marker (tokens from the superseded 2026-08-19 design), or a shipped
JSON file that does not parse. Nothing is suppressed with `|| true`.

**Publish** — the composed tree is served at `thebonhomme.com/transit/` from the apex
Pages repository `LeBonhommePharma/lebonhommepharma.github.io`, whose
`publish-transit.yml` runs on cron `*/15 * * * *`. This repository's `GITHUB_TOKEN`
cannot write to the apex repository, so `deploy.yml` dispatches to it instead; if the
optional `APEX_DISPATCH_TOKEN` secret is unset the job warns and stays green, and the
apex cron picks the commit up on its next pass. Measured latency under load is 27–33
minutes, not 15. Full mechanism, rollback and verification procedure: [`DEPLOY.md`](DEPLOY.md).

## Known issues

**The GTFS refresh degrades per feed, and says so.** Between 2026-08-27 and 2026-09-13
RTL Longueuil answered 403 and one dead feed stopped every city from refreshing. Since
`596ab17` downloads retry with bounded backoff, a failed feed falls back to its last
good archive (`scripts/gtfs-refresh.mjs`), a city with no fallback keeps its previous
atlas, and the workflow commits the healthy cities before failing the job red so a
human looks. Exit codes: 0 all fresh, 3 degraded, 1 nothing written.

**`builtAt` under-reports freshness.** The "keep the index timestamp stable" step in
`update-gtfs.yml` compares only index-level metadata, excluding `builtAt`. Commit
`647da8c` changed `montreal/atlas.json` and `montreal/timetable.json` but left the index
metadata identical, so `builtAt` was pinned back and still reads
`2026-08-26T20:01:54.571Z` for data committed on 2026-08-27.

**No user-visible data age.** `builtAt` is not rendered anywhere in `public/Transit/`.

## Contributing

Run `npm test` before opening a pull request. The suite is 268 tests,
imports the shipped static modules directly, and needs no network — it ran in about
10 seconds locally.

`deploy.yml` triggers only on `public/Transit/**`, `public/data/**`, `public/l10n/**`,
`public/favicon.svg`, `scripts/publish-transit.mjs` and `.github/workflows/deploy.yml`.
**A commit touching only `src/`, tests, `ios/` or `native/` starts no workflow.** CI
staying quiet on your pull request is the path filter, not a failure. Use
`workflow_dispatch` if you need the gate to run anyway.

Treat the ingest and the test suite as load-bearing. Do not weaken the gate to get a
build out; `DEPLOY.md` documents the rollback path instead.

Test fixtures should derive their service day from the calendar rather than the feed's
declared first day — see `d3fab05`, which fixed a two-day red build caused by exactly
that.

## Licence

Apache License 2.0. Full text in [`LICENSE`](LICENSE); attribution and third-party
notices in [`NOTICE`](NOTICE).

The Apache licence covers this software only. Schedule and trajectory records come from
official GTFS publications and are **not** licensed under Apache 2.0 — the RTC, STM,
STLévis, STL, RTL, STS and STTR retain their rights in those records. This application
integrates the public information of the Réseau de transport de la Capitale. No agency
endorses this project.
