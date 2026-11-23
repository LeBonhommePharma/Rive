import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { feedCoverageEnd } from "../../scripts/gtfs-coverage.mjs";
import { collapseLoneBusStations, isRoadRouteType } from "../../scripts/gtfs-stations.mjs";
import type { Atlas } from "./atlas/types";

const dataRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data");

const types = new Map<string, number>([
  ["13", 3],
  ["800", 3],
  ["metro-1", 1],
  ["train", 2],
]);

describe("collapseLoneBusStations", () => {
  it("folds a bus stop's own wrapper station into the stop (RTC 2026-11 shape)", () => {
    const { stops, collapsed } = collapseLoneBusStations(
      [
        { id: "0:1127", kind: 0, parent: "1:1127", routes: ["13"] },
        { id: "1:1127", kind: 1, routes: ["13"], children: ["0:1127"] },
      ],
      types,
    );
    assert.equal(collapsed, 1);
    assert.deepEqual(stops, [{ id: "0:1127", kind: 0, routes: ["13"] }]);
  });

  it("keeps a metro station even when it wraps a single platform", () => {
    const input = [
      { id: "43", kind: 0, parent: "STATION_M118", routes: ["metro-1"] },
      { id: "STATION_M118", kind: 1, routes: ["metro-1"], children: ["43"] },
    ];
    assert.deepEqual(collapseLoneBusStations(input, types), { stops: input, collapsed: 0 });
  });

  it("keeps a station that groups several bus stops, and one with any rail line", () => {
    const input = [
      { id: "a", kind: 0, parent: "terminus", routes: ["13"] },
      { id: "b", kind: 0, parent: "terminus", routes: ["800"] },
      { id: "terminus", kind: 1, routes: ["13", "800"], children: ["a", "b"] },
      { id: "c", kind: 0, parent: "gare", routes: ["13"] },
      { id: "gare", kind: 1, routes: ["13", "train"], children: ["c"] },
    ];
    assert.equal(collapseLoneBusStations(input, types).collapsed, 0);
  });

  it("classifies road route types, including the extended bus range", () => {
    for (const type of [3, 11, 200, 700, 715]) assert.ok(isRoadRouteType(type), String(type));
    for (const type of [0, 1, 2, 4, 100, 400, 900]) assert.ok(!isRoadRouteType(type), String(type));
  });
});

describe("feedCoverageEnd", () => {
  it("stops at the last scheduled day when the declared end outruns the calendar", () => {
    assert.equal(feedCoverageEnd("20270518", "20270319"), "20270319");
  });

  it("keeps a declared end that is earlier than the calendar", () => {
    assert.equal(feedCoverageEnd("20261220", "20270319"), "20261220");
  });

  it("falls back to whichever end exists", () => {
    assert.equal(feedCoverageEnd("", "20270319"), "20270319");
    assert.equal(feedCoverageEnd("20270319", undefined), "20270319");
    assert.equal(feedCoverageEnd(undefined, ""), "");
  });
});

describe("shipped atlases follow both rules", () => {
  const cities = (
    JSON.parse(readFileSync(join(dataRoot, "index.json"), "utf8")) as { cities: Array<{ city: string }> }
  ).cities.map((row) => row.city);

  for (const city of cities) {
    it(`${city}: no single-stop bus stations and no end past its own schedule`, () => {
      const atlas = JSON.parse(readFileSync(join(dataRoot, city, "atlas.json"), "utf8")) as Atlas;
      const routeTypes = new Map(atlas.routes.map((route) => [route.id, route.type]));
      assert.equal(collapseLoneBusStations(atlas.stops, routeTypes).collapsed, 0);

      const scheduled = [
        ...(atlas.calendar || []).map((row) => row.end),
        ...(atlas.exceptions || []).map((row) => row.date),
      ]
        .filter(Boolean)
        .sort()
        .at(-1);
      if (scheduled) assert.ok(atlas.meta.end <= scheduled, `${city} meta.end ${atlas.meta.end} > ${scheduled}`);
    });
  }
});
