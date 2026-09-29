/** Diagnostic evidence, not a passing regression suite. No production code is changed.
 * node --experimental-strip-types --import ./scripts/node-ts-hooks.mjs qa/planner-journey-matrix.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { Atlas, Itinerary, Place, Timetable } from "../src/lib/atlas/types";
import { searchAtlas, placeFromStop } from "../src/lib/search";
import { activeServiceIndexes } from "../src/lib/services";
import { minutesOfDay } from "../src/lib/time";
import { trajectoryChoices } from "../src/lib/trajectory";
import { transitMixName } from "../src/lib/mix-name";

const base = process.env.RIVE_AUDIT_URL || "http://127.0.0.1:3000";
const dates = ["2026-09-08T12:00:00-04:00", "2026-09-08T23:58:00-04:00"];
const pairs = [
  { city: "montreal", from: "Berri-UQAM", to: "Montmorency", description: "Orange metro line", metro: true },
  { city: "montreal", from: "Angrignon", to: "Honoré-Beaugrand", description: "Green metro line", metro: true },
  { city: "montreal", from: "Édouard-Montpetit", to: "Longueuil", description: "Blue-to-yellow corridor requiring multiple metro lines", metro: true },
  { city: "montreal", from: "Berri-UQAM", to: "Carrefour Laval", description: "Metro and Laval bus corridor" },
  { city: "quebec", from: "Youville", to: "Université Laval", description: "Québec urban bus corridor" },
  { city: "sherbrooke", from: "Université de Sherbrooke", to: "Station du Cégep", description: "Sherbrooke urban bus corridor" },
];

function consistency(item: Itinerary, now: number) {
  let cursor = now;
  const errors: string[] = [];
  for (const [index, leg] of item.legs.entries()) {
    if (leg.kind === "transit") {
      if (leg.depart < cursor) errors.push(`leg ${index}: boards at ${leg.depart}, reachable only at ${cursor}`);
      if (leg.arrive < leg.depart || leg.arrive - leg.depart !== leg.minutes) errors.push(`leg ${index}: inconsistent transit duration`);
      cursor = leg.arrive;
    } else cursor += leg.minutes;
  }
  if (item.arrive < cursor) errors.push(`reported arrival ${item.arrive} is before the final leg ends at ${cursor}`);
  if (item.minutes !== item.arrive - now) errors.push("total duration differs from arrival minus request time");
  return errors;
}

function describe(item: Itinerary, now: number, atlas: Atlas, timetable: Timetable, active: Set<number>) {
  const errors = consistency(item, now);
  const questionableDepartures: object[] = [];
  for (const leg of item.legs) {
    if (leg.kind !== "transit" || !leg.from.stopId) continue;
    const stop = atlas.stops.find(s => s.id === leg.from.stopId);
    const ids = [leg.from.stopId, ...(stop?.children || []), ...(stop?.parent ? [stop.parent] : [])];
    const times = ids.flatMap(id => timetable[id] || [])
      .filter(row => row.r === leg.routeId && row.s.some(service => active.has(service)) && (!row.h || row.h === leg.headsign))
      .flatMap(row => row.t);
    if (!times.includes(leg.depart)) questionableDepartures.push({ route: leg.shortName, stop: leg.from.label, depart: leg.depart,
      reason: leg.depart >= 1440 ? "next-service-day departure is not validated by today's calendar" : "boarding time absent from active timetable rows" });
  }
  return { id: item.id, minutes: item.minutes, transfers: item.transfers,
    modes: item.legs.map(leg => leg.kind === "transit" ? transitMixName(leg.type) : leg.kind),
    agencies: [...new Set(item.legs.filter(leg => leg.kind === "transit").map(leg => leg.agencyId))],
    errors, questionableDepartures };
}

const matrix: object[] = [];
for (const pair of pairs) {
  const atlas = JSON.parse(readFileSync(`public/data/${pair.city}/atlas.json`, "utf8")) as Atlas;
  const timetable = JSON.parse(readFileSync(`public/data/${pair.city}/timetable.json`, "utf8")) as Timetable;
  function place(query: string): Place {
    const hits = searchAtlas(atlas, query, 12).filter(hit => hit.kind === "stop").map(hit => hit.stop);
    const stop = (pair.metro ? hits.find(s => s.kind === 1 && s.agencyId === "STM") : undefined) || hits[0];
    if (!stop) throw new Error(`No matching stop for ${pair.city}: ${query}`);
    return placeFromStop(stop);
  }
  for (const at of dates) {
    const request = { city: pair.city, from: place(pair.from), to: place(pair.to), at };
    const response = await fetch(`${base}/api/plan`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(request), signal: AbortSignal.timeout(45000) });
    const data = await response.json() as { itineraries?: Itinerary[]; options?: { itinerary: Itinerary }[]; error?: string };
    const now = minutesOfDay(new Date(at)), active = activeServiceIndexes(atlas, new Date(at));
    const result = { description: pair.description, request, status: response.status,
      activeServices: active.size, error: data.error,
      itineraries: (data.itineraries || []).map(item => describe(item, now, atlas, timetable, active)),
      options: (data.options || []).map(row => describe(row.itinerary, now, atlas, timetable, active)),
      rawResponse: data };
    matrix.push(result);
    console.log(JSON.stringify({ description: pair.description, at, status: response.status,
      itineraryCount: result.itineraries.length,
      transitSequences: result.itineraries.filter(i => i.modes.some(m => m === "bus" || m === "métro")).map(i => i.modes.join("+")),
      temporalErrors: [...result.itineraries, ...result.options].filter(i => i.errors.length).length,
      questionableDepartures: result.itineraries.filter(i => i.questionableDepartures.length).length }));
  }
}

// Independent timing calculation: walk 08:00–08:10, train 08:20–08:30,
// walk 10 min. Faster access cannot move that fixed train's arrival earlier.
const A = { label: "A", lon: -73.6, lat: 45.5 }, B = { label: "B", lon: -73.59, lat: 45.5 };
const C = { label: "C", lon: -73.5, lat: 45.5 }, D = { label: "D", lon: -73.49, lat: 45.5 };
const fixture: Itinerary = { id: "fixed-train", minutes: 40, depart: 480, arrive: 520, walkMeters: 1500, transfers: 0, legs: [
  { kind: "walk", minutes: 10, meters: 750, from: A, to: B },
  { kind: "transit", type: 1, minutes: 10, from: B, to: C, depart: 500, arrive: 510, routeId: "metro", shortName: "M", color: "#000000", textColor: "#ffffff", headsign: "C", stopIds: ["B", "C"], line: "" },
  { kind: "walk", minutes: 10, meters: 750, from: C, to: D },
] };
const variants = trajectoryChoices([fixture]).map(row => ({ mix: row.mix, minutes: row.minutes,
  arrive: row.itinerary.arrive, errors: consistency(row.itinerary, 480), legs: row.itinerary.legs }));
const output = { testedAt: new Date().toISOString(), base, dates, notes: [
  "Public station coordinates, not the user's position. Dates are pinned inside shipped feed windows.",
  "Response/mode inventory is not proof of network optimality. Synthetic oracle cases are separate.",
  "Bike availability is queried live by the API even for a future at timestamp; no future availability is inferred.",
  "The API returns options but the main UI currently consumes only itineraries.",
], sources: Object.fromEntries(["src/lib/planner.ts", "src/lib/trajectory.ts", "src/app/api/plan/route.ts", "scripts/ingest-gtfs.mjs"]
  .map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])), matrix,
  accessModeFixture: { expected: "Access-mode changes must preserve the scheduled train arrival and must not create an arrival before final-leg completion.", variants } };
writeFileSync("qa/planner-journey-matrix.json", JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ fixture: "fixed train with access/egress variants", variants: variants.map(({ mix, arrive, errors }) => ({ mix, arrive, errors })) }));
