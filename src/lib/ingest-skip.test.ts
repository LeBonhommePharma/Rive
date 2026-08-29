import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildIndexPayload,
  describeRefreshFailure,
  refreshFailureMessage,
} from "../../scripts/gtfs-skip.mjs";
import { regionsFromCatalog } from "../../scripts/gtfs-catalog.mjs";
import { coverageEndYyyymmdd } from "../../scripts/gtfs-coverage.mjs";
import type { Atlas, AtlasStop, Timetable } from "./atlas/types";
import { departuresAtStop } from "./planner";
import { firstStopFromQuery } from "./search";
import { activeServiceIndexes } from "./services";
import { minutesOfDay } from "./time";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ingestPath = join(root, "scripts", "ingest-gtfs.mjs");
const registryPath = join(root, "src", "lib", "registry.json");
const dataRoot = join(root, "public", "data");

type Feed = { slug: string; url: string; agencyHint: string };
type Region = { city: string; feeds: Feed[] };
type RefreshFailure = { city: string; feed?: string; agency?: string; url?: string; message: string };
type IndexPayload = { builtAt: string; refreshFailures?: RefreshFailure[]; cities: Array<{ city: string }> };

// The scripts/ modules are plain .mjs with no declarations; name their shapes
// once here instead of letting `any` leak through every assertion.
const regionsOf = regionsFromCatalog as (registry: unknown) => Region[];
const describeFailure = describeRefreshFailure as (
  city: string,
  feed: unknown,
  error: unknown,
  root?: string,
) => RefreshFailure;
const failureMessage = refreshFailureMessage as (error: unknown, root?: string) => string;
const buildPayload = buildIndexPayload as (
  builtAt: string,
  cities: Array<{ city: string }>,
  failures?: RefreshFailure[],
) => IndexPayload;
const coverageEnd = coverageEndYyyymmdd as (pack: unknown) => string;

/** The real shape of the failure that froze every city on 2026-08-27. */
const RTL_403 = new Error(
  `Command failed: curl -L --fail --retry 3 --max-filesize 134217728 --proto =https --proto-redir =https -o ${root}/.cache/gtfs/rtl.zip https://www.rtl-longueuil.qc.ca/transit/latestfeed/RTL.zip`,
);

function rtlFeed(): Feed {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const montreal = regionsOf(registry).find((region) => region.city === "montreal");
  assert.ok(montreal, "registry must still ship montreal");
  const feed = montreal.feeds.find((row) => row.slug === "rtl");
  assert.ok(feed, "montreal must still list the rtl feed");
  return feed;
}

describe("city-scoped refresh skip", () => {
  it("names the city, the feed and the agency that broke", () => {
    const record = describeFailure("montreal", rtlFeed(), RTL_403, root);
    assert.equal(record.city, "montreal");
    assert.equal(record.feed, "rtl");
    assert.equal(record.agency, "RTL");
    assert.match(String(record.url), /rtl-longueuil\.qc\.ca/);
    assert.match(record.message, /curl/);
  });

  it("strips absolute paths so the record does not leak the build machine", () => {
    const record = describeFailure("montreal", rtlFeed(), RTL_403, root);
    assert.doesNotMatch(record.message, /\/home\/runner|\/Users\//);
    assert.ok(!record.message.includes(root), "repo root must not survive into the record");
    assert.match(record.message, /\.cache\/gtfs\/rtl\.zip/);
  });

  it("keeps one line and a bounded length out of a noisy stack", () => {
    const noisy = new Error(`boom ${"x".repeat(500)}\nsecond line\nthird line`);
    const message = failureMessage(noisy);
    assert.ok(message.length <= 200, `message was ${message.length} chars`);
    assert.doesNotMatch(message, /second line/);
    assert.match(message, /\.\.\.$/);
  });

  it("produces a byte-identical record for a repeated outage", () => {
    // A record carrying a timestamp would churn a commit every six hours and
    // defeat the refresh workflow's unchanged check.
    const first = describeFailure("montreal", rtlFeed(), RTL_403, root);
    const second = describeFailure("montreal", rtlFeed(), RTL_403, root);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it("survives a failure that carries no feed and no message", () => {
    const record = describeFailure("sherbrooke", undefined, undefined, root);
    assert.equal(record.city, "sherbrooke");
    assert.equal(record.feed, undefined);
    assert.equal(record.message, "unknown error");
  });

  it("omits refreshFailures entirely when every city refreshed", () => {
    const payload = buildPayload("2026-08-29T00:00:00.000Z", [{ city: "quebec" }]);
    assert.equal("refreshFailures" in payload, false);
    assert.deepEqual(Object.keys(payload), ["builtAt", "cities"]);
  });

  it("publishes the failure beside cities[], never inside it", () => {
    const payload = buildPayload(
      "2026-08-29T00:00:00.000Z",
      [{ city: "quebec" }, { city: "montreal" }],
      [describeFailure("montreal", rtlFeed(), RTL_403, root)],
    );
    // cities[] keeps its invariant: every entry has an atlas on disk, so no
    // consumer that iterates it can be handed a city it cannot load.
    assert.deepEqual(
      payload.cities.map((row) => row.city),
      ["quebec", "montreal"],
    );
    for (const row of payload.cities) {
      assert.equal("refreshFailures" in row, false);
      assert.equal("refreshFailed" in row, false);
    }
    const failures = payload.refreshFailures;
    assert.ok(failures, "refreshFailures must be published when a city was skipped");
    assert.equal(failures.length, 1);
    assert.equal(failures[0].city, "montreal");
    // The warning reads before the data it qualifies.
    assert.deepEqual(Object.keys(payload), ["builtAt", "refreshFailures", "cities"]);
  });

  it("still names a city that has never been built and so is absent from cities[]", () => {
    const payload = buildPayload(
      "2026-08-29T00:00:00.000Z",
      [{ city: "quebec" }],
      [describeFailure("montreal", rtlFeed(), RTL_403, root)],
    );
    assert.equal(
      payload.cities.some((row) => row.city === "montreal"),
      false,
    );
    const failures = payload.refreshFailures;
    assert.ok(failures);
    assert.equal(failures[0].city, "montreal");
  });

  it("isolates the failure to one city instead of aborting the whole ingest", () => {
    const source = readFileSync(ingestPath, "utf8");
    // The bug: one `await ingestFeed(...)` throwing out of the region loop
    // took Québec, Sherbrooke and Trois-Rivières down with Montréal.
    assert.match(source, /for \(const region of wanted\) \{\s*try \{/);
    assert.match(source, /await ingestRegion\(region, args\.force\)/);
    assert.match(source, /failures\.push\(describeRefreshFailure\(/);
  });

  it("keeps the coverage assert and writes nothing for a city that fails it", () => {
    const source = readFileSync(ingestPath, "utf8");
    const region = source.slice(source.indexOf("async function ingestRegion"));
    const body = region.slice(0, region.indexOf("\nasync function main"));
    const assertAt = body.indexOf("runCoverageAssert");
    const firstWrite = body.indexOf("writeJson(");
    assert.ok(assertAt > 0, "ingestRegion must still run the coverage assert");
    assert.ok(firstWrite > assertAt, "no city bytes may be written before coverage passes");
  });

  it("fails the run when no city could be built at all", () => {
    const source = readFileSync(ingestPath, "utf8");
    assert.match(source, /if \(built === 0\)/);
    assert.match(source, /No city could be rebuilt/);
    // The index must not be rewritten on a total failure.
    assert.ok(
      source.indexOf("No city could be rebuilt") < source.indexOf("writeIndexFromDisk(OUT, regions, failures)"),
      "a run that built nothing must throw before touching index.json",
    );
  });
});

/**
 * Leaving a skipped city's last atlas in place is only safe because a GTFS
 * calendar expires itself. Past its coverage end the city serves nothing at
 * all rather than yesterday's timetable dressed up as today's. That is the
 * property the whole skip design leans on, so it is asserted here rather than
 * assumed — and derived from each feed's own calendar, never pinned to a date
 * the next refresh would move.
 */
describe("a city that stops refreshing goes blank, not wrong", () => {
  const shipped = (
    JSON.parse(readFileSync(join(dataRoot, "index.json"), "utf8")) as { cities?: Array<{ city?: unknown }> }
  ).cities;
  const cities = (shipped || [])
    .map((row) => row.city)
    .filter((city): city is string => typeof city === "string" && city.length > 0);

  const loadAtlas = (city: string) =>
    JSON.parse(readFileSync(join(dataRoot, city, "atlas.json"), "utf8")) as Atlas;
  const loadTimetable = (city: string) =>
    JSON.parse(readFileSync(join(dataRoot, city, "timetable.json"), "utf8")) as Timetable;

  const offsetFrom = (stamp: string, days: number) =>
    new Date(
      Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)) + days, 20, 0),
    );

  it("ships at least one city to check", () => {
    assert.ok(cities.length > 0, "public/data/index.json cities[] is empty");
  });

  for (const city of cities) {
    it(`runs no service past its own coverage end: ${city}`, () => {
      const atlas = loadAtlas(city);
      const end = coverageEnd(atlas);
      assert.match(end, /^\d{8}$/, `${city} declares no coverage end`);
      for (const days of [1, 7, 120]) {
        const active = activeServiceIndexes(atlas, offsetFrom(end, days));
        assert.equal(active.size, 0, `${city} still runs ${active.size} services ${days} day(s) past ${end}`);
      }
    });
  }

  it("returns no departures at a real stop once coverage has run out", () => {
    const city = cities[0];
    const atlas = loadAtlas(city);
    const timetable = loadTimetable(city);
    const stop = atlas.stops.find(
      (row: AtlasStop) => row.routes.length > 0 && (timetable[row.id]?.length ?? 0) > 0,
    );
    assert.ok(stop, `${city} has no stop with a timetable row`);
    const end = coverageEnd(atlas);

    // Sanity first: the same stop does serve departures inside the window, so
    // a zero below means expiry and not a stop that never had service.
    const insideClock = offsetFrom(end, -30);
    const inside = departuresAtStop(atlas, timetable, stop, 0, activeServiceIndexes(atlas, insideClock));
    assert.ok(inside.length > 0, `${city} ${stop.id} has no departures even inside its window`);

    const after = offsetFrom(end, 1);
    assert.deepEqual(
      departuresAtStop(atlas, timetable, stop, minutesOfDay(after), activeServiceIndexes(atlas, after)),
      [],
      `${city} still lists departures after ${end}`,
    );
  });

  it("keeps that guarantee reachable through the query path riders actually use", () => {
    const city = cities[0];
    const atlas = loadAtlas(city);
    const timetable = loadTimetable(city);
    const seed = atlas.stops.find((row: AtlasStop) => row.routes.length > 0);
    assert.ok(seed, `${city} ships no stop with routes`);
    const named = firstStopFromQuery(atlas, seed.name);
    assert.ok(named, `${city} cannot resolve one of its own stop names`);
    const after = offsetFrom(coverageEnd(atlas), 1);
    assert.deepEqual(
      departuresAtStop(atlas, timetable, named, minutesOfDay(after), activeServiceIndexes(atlas, after)),
      [],
    );
  });
});
