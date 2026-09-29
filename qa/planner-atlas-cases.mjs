#!/usr/bin/env node
// Read-only capability audit, using synthetic schedules and the actual standalone
// planner functions. Run: node --no-warnings qa/planner-atlas-cases.mjs
// Exit 1 means a requested capability failed; this is not a live-data validation.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as kit from "../public/Transit/rive-kit.js";

const appUrl = new URL("../public/Transit/app.js", import.meta.url);
const kitUrl = new URL("../public/Transit/rive-kit.js", import.meta.url);
const source = readFileSync(appUrl, "utf8");
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}\n", start);
  if (start < 0 || end < start) throw new Error(`Missing source function: ${name}`);
  return source.slice(start, end + 3);
}
const state = { atlas: null, timetable: {}, detours: [], bikes: [], locale: "en" };
const context = vm.createContext({ ...kit, state, Date, Set, Map });
vm.runInContext([
  "atlasText", "haversineMeters", "stopHasService", "nearbyStops",
  "mergeStopsWithDetours", "detourIsActive", "liveDetours", "liveStops",
  "hopSum", "indexOnDir", "lookupIds", "nextDeparture", "planFromHere",
  "formatMeters", "decodePolyline", "applyDetour",
].map(extract).join("\n"), context);

function encode(points) {
  let encoded = "", lat = 0, lon = 0;
  for (const point of points) {
    for (const [value, previous] of [[Math.round(point[1] * 1e5), lat], [Math.round(point[0] * 1e5), lon]]) {
      let delta = value - previous;
      delta = delta < 0 ? ~(delta << 1) : delta << 1;
      while (delta >= 32) {
        encoded += String.fromCharCode((32 | (delta & 31)) + 63);
        delta >>= 5;
      }
      encoded += String.fromCharCode(delta + 63);
    }
    lat = Math.round(point[1] * 1e5);
    lon = Math.round(point[0] * 1e5);
  }
  return encoded;
}
const stop = (id, lon, routes) => ({ id, name: id, lon, lat: 45, routes, kind: 0 });
const route = (id, type, stops, hops) => ({
  id, shortName: id, type, color: "#000000", textColor: "#ffffff",
  dirs: [{ id: 0, headsign: id, stops: stops.map((s) => s.id), hops, line: encode(stops.map((s) => [s.lon, s.lat])) }],
});
const schedule = (r, t) => ({ r, d: 0, s: [0], t, h: r });
function load(stops, routes, timetable) {
  state.atlas = { stops, routes };
  state.timetable = timetable;
  state.detours = [];
  state.bikes = [];
}
const plan = (from, to) => context.planFromHere(from, to, 600, new Set([0]));
const transitLegs = (trip) => trip.legs.filter((leg) => leg.kind === "transit");
const describe = (trips) => trips.map((trip) => ({
  minutes: trip.minutes,
  legs: trip.legs.map((leg) => ({ kind: leg.kind, route: leg.routeId, minutes: leg.minutes, depart: leg.depart, arrive: leg.arrive })),
}));
const cases = [];
const check = (id, expected, actual, passed) => cases.push({ id, passed: Boolean(passed), expected, actual });

const A = stop("A", 0, ["R1"]);
const X = stop("X", 0.05, ["R1", "R2"]);
const B = stop("B", 0.1, ["R2"]);
for (const [id, types] of [["bus_to_bus", [3, 3]], ["metro_to_metro", [1, 1]], ["metro_to_bus", [1, 3]]]) {
  load([A, X, B], [route("R1", types[0], [A, X], [10]), route("R2", types[1], [X, B], [10])], {
    A: [schedule("R1", [600])], X: [schedule("R1", [610]), schedule("R2", [612])], B: [schedule("R2", [622])],
  });
  const trips = plan({ ...A, stopId: "A" }, B);
  check(id, "R1 at 10:00, R2 at 10:12, arrive 10:22; two transit legs", describe(trips), trips.some((trip) => transitLegs(trip).length === 2));
}

const Y = stop("Y", 0.1, ["R2", "R3"]);
const C = stop("C", 0.15, ["R3"]);
load([A, X, Y, C], [route("R1", 3, [A, X], [10]), route("R2", 3, [X, Y], [10]), route("R3", 3, [Y, C], [10])], {
  A: [schedule("R1", [600])], X: [schedule("R1", [610]), schedule("R2", [612])],
  Y: [schedule("R2", [622]), schedule("R3", [624])], C: [schedule("R3", [634])],
});
let trips = plan(A, C);
check("two_transfers", "Three transit legs, arrive 10:34", describe(trips), trips.some((trip) => transitLegs(trip).length === 3));

const board = stop("Board", 0.03, ["R"]);
const destination = stop("Destination", 0.1, ["R"]);
load([board, destination], [route("R", 3, [board, destination], [10])], {
  Board: [schedule("R", [615])], Destination: [schedule("R", [625])],
});
state.bikes = [
  { id: "pickup", name: "Pickup", lon: 0.001, lat: 45, bikes: 4, docks: 4, system: "fixture" },
  { id: "return", name: "Return", lon: 0.029, lat: 45, bikes: 4, docks: 4, system: "fixture" },
];
trips = plan({ lon: 0, lat: 45 }, destination);
check("walk_bike_transit", "Walk to pickup, bike to return, walk to R at 10:15, transit to destination", describe(trips),
  trips.some((trip) => trip.legs.some((leg) => leg.kind === "bike") && transitLegs(trip).length > 0));

const origin = stop("Origin", 0, ["R"]);
const end = stop("End", 0.06, ["R"]);
load([origin, end], [route("R", 3, [origin, end], [10])], {
  Origin: [schedule("R", [601, 630])], End: [schedule("R", [611, 640])],
});
trips = plan(origin, end);
check("direct_transit", "Board R at 10:01 and arrive 10:11", describe(trips),
  trips.some((trip) => transitLegs(trip).length === 1 && transitLegs(trip)[0].depart === 601 && trip.arrive === 611));
trips = plan({ lon: -0.008, lat: 45 }, end);
const timed = trips.filter((trip) => transitLegs(trip).length > 0);
check("access_walk_catches_real_departure", "8-minute access walk misses 10:01; board at 10:30 and arrive 10:40", describe(timed),
  timed.length > 0 && timed.every((trip) => transitLegs(trip)[0].depart === 630 && trip.arrive === 640));

const simple = [[-73.58, 45.50], [-73.57, 45.50], [-73.56, 45.50], [-73.55, 45.50]];
const simpleExpected = simple.slice(1, 3);
let actual = kit.lineSlice(simple, { lon: -73.57, lat: 45.50 }, { lon: -73.56, lat: 45.50 });
check("simple_ridden_segment", simpleExpected, actual, JSON.stringify(actual) === JSON.stringify(simpleExpected));
const loop = [[-73.57, 45.50], [-73.56, 45.50], [-73.56, 45.51], [-73.57, 45.50], [-73.57, 45.49]];
const loopExpected = loop.slice(3);
actual = kit.lineSlice(loop, { lon: -73.57, lat: 45.50 }, { lon: -73.57, lat: 45.49 });
check("loop_ridden_segment", "Ride starts at repeated point index 3; only final segment should be included", actual,
  JSON.stringify(actual) === JSON.stringify(loopExpected));

const detourLine = [[0, 45], [0.03, 45.02], [0.06, 45]];
state.detours = [{ routeId: "R", shape: encode(detourLine) }];
trips = plan(origin, end);
const tripShapes = trips.flatMap(transitLegs).map((leg) => leg.line);
check("active_detour_trip_geometry", detourLine, tripShapes,
  tripShapes.length > 0 && tripShapes.every((line) => JSON.stringify(line) === JSON.stringify(detourLine)));

const rankingInput = [{ minutes: 25, label: "first" }, { minutes: 10, label: "second" }, { minutes: 18, label: "third" }];
actual = kit.annotateTimeGaps(kit.rankByDoorToDoor(rankingInput));
check("ranking_of_generated_candidates", { minutes: [10, 18, 25], gaps: [0, 8, 15] }, actual,
  JSON.stringify(actual.map((item) => [item.minutes, item.gap])) === JSON.stringify([[10, 0], [18, 8], [25, 15]]));

state.detours = [];
state.bikes = [];
const nearby = { id: "Nearby", name: "Nearby", lon: 0.015, lat: 45, routes: [] };
const heuristicTrips = plan(origin, nearby);
const distanceMeters = context.haversineMeters(origin, nearby);
const observations = [{
  id: "bike_and_car_are_straight_line_estimates",
  stationCount: state.bikes.length,
  distanceMeters,
  actual: describe(heuristicTrips),
  bikeFormulaMinutes: kit.bikeMinutes(distanceMeters),
  roadFormulaMinutes: kit.roadMinutes(distanceMeters),
  interpretation: "A generic bike option appears with zero bike stations. This proves no bike-share availability validation; it does not prove that using a personal bike is impossible.",
}];
const passed = cases.filter((item) => item.passed).length;
console.log(JSON.stringify({
  scope: "Synthetic capability checks of actual standalone source; no browser, network, live service, or street-routing validation.",
  sourceSha256: Object.fromEntries([["public/Transit/app.js", appUrl], ["public/Transit/rive-kit.js", kitUrl]].map(([name, url]) => [name, createHash("sha256").update(readFileSync(url)).digest("hex")])),
  summary: { total: cases.length, passed, failed: cases.length - passed, observations: observations.length },
  cases,
  observations,
}, null, 2));
process.exitCode = passed === cases.length ? 0 : 1;
