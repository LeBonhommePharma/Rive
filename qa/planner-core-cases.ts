/**
 * Independently solved counterexamples for the actual scheduled planner.
 * Run: node --experimental-strip-types --import ./scripts/node-ts-hooks.mjs qa/planner-core-cases.ts
 * Synthetic coordinates isolate access/transfer stops; no live service or clock is used.
 * A failing case is a witnessed limitation, not an expected-to-pass regression test.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Atlas, AtlasRoute, AtlasStop, Itinerary, Place, Timetable, TripLeg } from "../src/lib/atlas/types";
import { planTrip } from "../src/lib/planner";
import { itineraryCollection } from "../src/lib/map-legs";

const NOW = 8 * 60;
const ACTIVE = new Set([0]);
const DEG_PER_METER = 180 / (Math.PI * 6_371_000);
const point = (meters: number, north = 0) => ({ lon: meters * DEG_PER_METER, lat: north * DEG_PER_METER });
type Ride = Extract<TripLeg, { kind: "transit" }>;
type CaseResult = { id: string; statement: string; expected: unknown; actual: unknown; pass: boolean; source: string[] };

function stop(id: string, meters: number, north = 0): AtlasStop {
  return { id, name: id, ...point(meters, north), routes: [], kind: 0, wheel: 0 };
}

function route(id: string, stops: string[], hops: number[], agencyId = "agency", line = ""): AtlasRoute {
  return {
    id, shortName: id, longName: id, agencyId, agencyName: agencyId, type: 3,
    color: "#000000", textColor: "#FFFFFF",
    dirs: [{ id: 0, headsign: stops.at(-1)!, line, stops, hops }],
  };
}

function atlas(stops: AtlasStop[], routes: AtlasRoute[], transfers: Atlas["transfers"] = []): Atlas {
  return {
    meta: {
      city: "diagnostic", name: "Synthetic diagnostic", agencyId: "agency", agencyName: "agency",
      agencyUrl: "", timezone: "UTC", lang: "en", phone: "", updated: "2026-09-06",
      start: "20260906", end: "20260906", version: "fixture-1", attribution: "Synthetic",
      licenseUrl: "", sourceUrl: "", center: [0, 0], zoom: 12,
      counts: { routes: routes.length, stops: stops.length, trips: 0, services: 1, timetableStops: stops.length },
    },
    stops: stops.map((s) => ({ ...s, routes: routes.filter((r) => r.dirs.some((d) => d.stops.includes(s.id))).map((r) => r.id) })),
    routes, transfers, calendar: [], exceptions: [], services: ["synthetic-service"],
  };
}

function rows(...entries: Array<[string, string, number[]]>): Timetable {
  const result: Timetable = {};
  for (const [stopId, routeId, departures] of entries) {
    (result[stopId] ??= []).push({ r: routeId, d: 0, h: routeId, s: [0], t: departures });
  }
  return result;
}

function place(a: Atlas, id: string): Place {
  const s = a.stops.find((s) => s.id === id)!;
  return { label: s.name, stopId: s.id, lon: s.lon, lat: s.lat };
}

function rides(itinerary?: Itinerary): Ride[] {
  return itinerary?.legs.filter((leg): leg is Ride => leg.kind === "transit") ?? [];
}

function transitOptions(a: Atlas, table: Timetable, from = place(a, "O"), to = place(a, "D")): Itinerary[] {
  return planTrip(a, table, from, to, NOW, ACTIVE).filter((item) => rides(item).length > 0);
}

function summary(item?: Itinerary) {
  return item ? {
    arrive: item.arrive, minutes: item.minutes, transfers: item.transfers,
    sumLegMinutes: item.legs.reduce((sum, leg) => sum + leg.minutes, 0),
    legs: item.legs.map((leg) => leg.kind === "transit"
      ? { kind: leg.kind, route: leg.routeId, from: leg.from.stopId, to: leg.to.stopId, depart: leg.depart, arrive: leg.arrive, minutes: leg.minutes }
      : { kind: leg.kind, from: leg.from.stopId ?? leg.from.label, to: leg.to.stopId ?? leg.to.label, minutes: leg.minutes, meters: leg.meters }),
  } : null;
}

const cases: CaseResult[] = [];

{
  const a = atlas([stop("O", 0), stop("D", 10_000)], [route("A", ["O", "D"], [10])]);
  const item = transitOptions(a, rows(["O", "A", [480]]))[0];
  cases.push({
    id: "control-direct-ride",
    statement: "Positive control: a bus at the exact origin departs 08:00 and arrives after one 10-minute hop.",
    expected: { board: 480, arrive: 490, transfers: 0 }, actual: summary(item),
    pass: rides(item)[0]?.depart === 480 && item?.arrive === 490 && item.transfers === 0,
    source: ["src/lib/planner.ts:232-313"],
  });
}

{
  const a = atlas([stop("O", 0), stop("X", 5000), stop("D", 10_000)], [
    route("A", ["O", "X"], [10]), route("B", ["X", "D"], [10]),
  ]);
  const item = transitOptions(a, rows(["O", "A", [480]], ["X", "B", [492]]))[0];
  cases.push({
    id: "control-one-transfer",
    statement: "Positive control: two 10-minute rides with a reachable 2-minute same-stop connection arrive 08:22.",
    expected: { board: [480, 492], arrive: 502, transfers: 1 }, actual: summary(item),
    pass: rides(item).map((leg) => leg.depart).join(",") === "480,492" && item?.arrive === 502 && item.transfers === 1,
    source: ["src/lib/planner.ts:354-519"],
  });
}

{
  const a = atlas([stop("O", 0), stop("D", 10_000)], [route("A", ["O", "D"], [10])]);
  const from = { label: "375 m before origin", ...point(-375) };
  const item = transitOptions(a, rows(["O", "A", [482, 500]]), from)[0];
  cases.push({
    id: "access-walk-misses-departure",
    statement: "A five-minute access walk misses 08:02; the next actual bus is 08:20 and arrives 08:30.",
    expected: { accessMinutes: 5, board: 500, arrive: 510 }, actual: summary(item),
    pass: rides(item)[0]?.depart === 500 && item?.arrive === 510,
    source: ["src/lib/planner.ts:254-260", "src/lib/planner.ts:408-420"],
  });
}

{
  const a = atlas([stop("O", 0), stop("X", 5000), stop("Y", 5900), stop("D", 10_000)], [
    route("A", ["O", "X"], [10], "agency-a"), route("B", ["Y", "D"], [10], "agency-b"),
  ]);
  const item = transitOptions(a, rows(["O", "A", [480]], ["Y", "B", [492, 520]]))[0];
  const first = rides(item)[0];
  const second = rides(item)[1];
  const gap = item?.legs.find((leg) => leg.kind === "walk");
  cases.push({
    id: "transfer-walk-misses-departure",
    statement: "Alighting 08:10 then walking 900 m takes 12 minutes; 08:12 is unreachable, so board 08:40 and arrive 08:50.",
    expected: { alight: 490, transferMinutes: 12, earliestBoardingTime: 502, board: 520, arrive: 530 },
    actual: { itinerary: summary(item), chronological: Boolean(first && second && gap && first.arrive + gap.minutes <= second.depart) },
    pass: second?.depart === 520 && item?.arrive === 530,
    source: ["src/lib/planner.ts:422-441", "src/lib/planner.ts:72-80"],
  });
}

{
  const a = atlas([stop("O", 0), stop("X", 4000), stop("U", 5000), stop("Y", 6000), stop("D", 10_000)], [
    route("A", ["O", "X", "U", "Y"], [5, 3, 2]), route("B", ["X", "Y", "D"], [10, 10]),
  ]);
  const item = transitOptions(a, rows(["O", "A", [480]], ["X", "B", [486, 520]], ["Y", "B", [496, 530]]))[0];
  cases.push({
    id: "more-stops-earlier-arrival",
    statement: "Transfer at X traverses 3 hops but misses 08:06 under the planner's own 2-minute minimum. Staying on A to Y traverses 4 hops, catches the same B at 08:16, and arrives 08:26 instead of 09:00.",
    expected: { transferStop: "Y", firstAlight: 490, secondBoard: 496, arrive: 506 }, actual: summary(item),
    pass: rides(item)[0]?.to.stopId === "Y" && item?.arrive === 506,
    source: ["src/lib/planner.ts:374-383"],
  });
}

{
  const a = atlas([stop("O", 0), stop("X", 4000), stop("Y", 8000), stop("D", 12_000)], [
    route("A", ["O", "X"], [10]), route("B", ["X", "Y"], [10]), route("C", ["Y", "D"], [10]),
  ]);
  const options = transitOptions(a, rows(["O", "A", [480]], ["X", "B", [492]], ["Y", "C", [504]]));
  cases.push({
    id: "two-transfer-chain",
    statement: "The only public-transit path is A 08:00–08:10, B 08:12–08:22, C 08:24–08:34; each interchange is at the same stop.",
    expected: { transitRoutes: ["A", "B", "C"], transfers: 2, arrive: 514 }, actual: options.map(summary),
    pass: options.some((item) => item.transfers === 2 && item.arrive === 514),
    source: ["src/lib/planner.ts:354-519"],
  });
}

for (const transfer of [{ type: 3, sec: 0 }, { type: 2, sec: 600 }]) {
  const a = atlas([stop("O", 0), stop("X", 5000), stop("D", 10_000)], [
    route("A", ["O", "X"], [10]), route("B", ["X", "D"], [10]),
  ], [{ from: "X", to: "X", ...transfer }]);
  const options = transitOptions(a, rows(["O", "A", [480]], ["X", "B", [492, 510]]));
  const forbidden = transfer.type === 3;
  cases.push({
    id: forbidden ? "gtfs-forbidden-transfer" : "gtfs-minimum-transfer-time",
    statement: forbidden
      ? "An explicit GTFS type-3 transfer prohibits the only A-to-B interchange."
      : "An explicit GTFS type-2 minimum of 600 seconds makes 08:12 unreachable after alighting 08:10; board 08:30 and arrive 08:40.",
    expected: forbidden ? { transitItineraries: 0 } : { minimumTransferMinutes: 10, board: 510, arrive: 520 },
    actual: options.map(summary),
    pass: forbidden ? options.length === 0 : rides(options[0])[1]?.depart === 510 && options[0]?.arrive === 520,
    source: ["src/lib/atlas/types.ts:65-70", "src/lib/planner.ts:374-441"],
  });
}

{
  const a = atlas([stop("O", 4000), stop("U", 8000), stop("D", 0)], [route("L", ["D", "O", "U", "D"], [5, 5, 5])]);
  const options = transitOptions(a, rows(["O", "L", [480]]));
  cases.push({
    id: "repeated-stop-on-loop",
    statement: "A loop D→O→U→D has an O 08:00→D 08:10 journey. Destination D's first occurrence precedes O, but its second occurrence is reachable.",
    expected: { stopIds: ["O", "U", "D"], arrive: 490 }, actual: options.map(summary),
    pass: options.some((item) => item.arrive === 490 && rides(item)[0]?.to.stopId === "D"),
    source: ["src/lib/planner.ts:33-39", "src/lib/planner.ts:250-252"],
  });
}

// Encode fixture geometry independently; production uses its own decoder and slicer.
function encodeLine(points: Array<{ lon: number; lat: number }>): string {
  let lat = 0, lon = 0, result = "";
  const encode = (delta: number) => {
    let n = delta < 0 ? ~(delta << 1) : delta << 1;
    let value = "";
    while (n >= 32) { value += String.fromCharCode((32 | (n & 31)) + 63); n >>>= 5; }
    return value + String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const nextLat = Math.round(p.lat * 1e5), nextLon = Math.round(p.lon * 1e5);
    result += encode(nextLat - lat) + encode(nextLon - lon);
    lat = nextLat; lon = nextLon;
  }
  return result;
}

{
  const stops = [stop("P", 0), stop("O", 4000), stop("U", 8000, 4000), stop("D", 0)];
  const a = atlas(stops, [route("L", ["P", "O", "U", "D"], [5, 5, 5], "agency", encodeLine(stops))]);
  const item = transitOptions(a, rows(["O", "L", [480]]))[0];
  const transitFeature = itineraryCollection(item ?? null).features.find((f) => f.properties?.kind === "transit");
  const actualCoordinates = transitFeature?.geometry.type === "LineString" ? transitFeature.geometry.coordinates : [];
  const expectedCoordinates = stops.slice(1).map((p) => [Math.round(p.lon * 1e5) / 1e5, Math.round(p.lat * 1e5) / 1e5]);
  cases.push({
    id: "loop-geometry-direction",
    statement: "P and D share coordinates on a loop. The actual O→U→D itinerary must keep U; nearest-coordinate slicing must not substitute the earlier O→P segment.",
    expected: { stopIds: ["O", "U", "D"], coordinates: expectedCoordinates },
    actual: { stopIds: rides(item)[0]?.stopIds ?? [], coordinates: actualCoordinates },
    pass: JSON.stringify(actualCoordinates) === JSON.stringify(expectedCoordinates),
    source: ["src/lib/map-legs.ts:40-43", "src/lib/geo.ts:134-151"],
  });
}

const sources = ["src/lib/planner.ts", "src/lib/geo.ts", "src/lib/map-legs.ts", "src/lib/atlas/types.ts"];
console.log(JSON.stringify({
  scope: "Synthetic capability and correctness diagnostics; transit options are assessed separately from road/walk alternatives.",
  clock: { minutesOfDay: NOW, activeServiceIndexes: [...ACTIVE], liveCalendarUsed: false },
  specification: { transfers: "https://gtfs.org/documentation/schedule/reference/#transferstxt", verified: "2026-09-06" },
  sources: Object.fromEntries(sources.map((path) => [path, createHash("sha256").update(readFileSync(new URL(`../${path}`, import.meta.url))).digest("hex")])),
  cases,
  summary: { cases: cases.length, passed: cases.filter((c) => c.pass).length, failed: cases.filter((c) => !c.pass).length },
}, null, 2));
if (cases.some((c) => !c.pass)) process.exitCode = 1;
