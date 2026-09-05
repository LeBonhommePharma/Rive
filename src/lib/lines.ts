import type { Atlas, AtlasStop, Timetable } from "./atlas/types";
import { formatClock } from "./time";
import { departuresAtStop, lookupStopIds } from "./planner";
import { fold, isFinitePoint, nearbyStops } from "./search";
import { mergeStopsWithDetours, type Detour } from "./realtime";

export type NearbyLine = {
  routeId: string;
  shortName: string;
  color: string;
  textColor: string;
  longName: string;
  type: number;
  meters: number;
  stopId: string;
  towardDest: boolean;
};

export type LineDue = {
  routeId: string;
  shortName: string;
  color: string;
  textColor: string;
  stopId: string;
  stopName: string;
  meters: number;
  headsign: string;
  depart: number;
  wait: number;
  clocks: string[];
};

export function nearbyLines(
  atlas: Atlas,
  here: { lon: number; lat: number },
  dest?: { lon: number; lat: number } | null,
  radiusM = 1200,
  detours: Detour[] = [],
): NearbyLine[] {
  if (!isFinitePoint(here)) return [];
  const stops = (detours.length ? mergeStopsWithDetours(atlas.stops, detours) : atlas.stops) as typeof atlas.stops;
  const near = nearbyStops(stops, here, radiusM, 24);
  if (near.length === 0) return [];
  const destRouteIds = new Set<string>();
  if (dest && isFinitePoint(dest)) {
    for (const stop of nearbyStops(atlas.stops, dest, 900, 16)) {
      for (const id of stop.routes) destRouteIds.add(id);
    }
  }
  const routes = new Map(atlas.routes.map((route) => [route.id, route]));
  const best = new Map<string, NearbyLine>();
  for (const stop of near) {
    for (const routeId of stop.routes) {
      const route = routes.get(routeId);
      if (!route || !route.shortName) continue;
      const towardDest = destRouteIds.has(routeId);
      const prev = best.get(routeId);
      if (prev && prev.meters <= stop.meters) {
        if (towardDest && !prev.towardDest) prev.towardDest = true;
        continue;
      }
      best.set(routeId, {
        routeId: route.id,
        shortName: route.shortName,
        color: route.color,
        textColor: route.textColor,
        longName: route.longName,
        type: route.type,
        meters: stop.meters,
        stopId: stop.id,
        towardDest,
      });
    }
  }
  return [...best.values()].sort((a, b) => {
    const metroA = a.type === 1 ? 0 : 1;
    const metroB = b.type === 1 ? 0 : 1;
    if (metroA !== metroB) return metroA - metroB;
    if (a.towardDest !== b.towardDest) return a.towardDest ? -1 : 1;
    if (a.meters !== b.meters) return a.meters - b.meters;
    return a.shortName.localeCompare(b.shortName, "fr");
  });
}

export function nextDueOnLine(
  atlas: Atlas,
  timetable: Timetable,
  here: { lon: number; lat: number },
  routeId: string,
  now: number,
  active: Set<number>,
  limit = 12,
  detours: Detour[] = [],
): LineDue[] {
  if (!isFinitePoint(here) || !routeId) return [];
  const route = atlas.routes.find((item) => item.id === routeId);
  if (!route) return [];
  const stops = (detours.length ? mergeStopsWithDetours(atlas.stops, detours) : atlas.stops) as typeof atlas.stops;
  const near = nearbyStops(stops, here, 700, 16)
    .filter((stop) => stop.routes.includes(routeId))
    .sort((a, b) => {
      const ta = (a as { temporary?: boolean }).temporary ? 0 : 1;
      const tb = (b as { temporary?: boolean }).temporary ? 0 : 1;
      return ta - tb || a.meters - b.meters;
    });
  const rows: LineDue[] = [];
  for (const stop of near) {
    const pass = departuresAtStop(atlas, timetable, stop, now, active, 16).filter(
      (row) => row.routeId === routeId,
    );
    for (const row of pass) {
      rows.push({
        routeId: route.id,
        shortName: route.shortName,
        color: route.color,
        textColor: route.textColor,
        stopId: stop.id,
        stopName: stop.name,
        meters: stop.meters,
        headsign: row.headsign,
        depart: row.depart,
        wait: row.depart - now,
        clocks: row.times.map((t) => formatClock(t)),
      });
    }
  }
  return collapseDueByDirection(rows, limit);
}

/** One skittle per route + direction. Keep the closest pole, not the next two copies. */
export function collapseDueByDirection(rows: LineDue[], limit = 12): LineDue[] {
  const ranked = [...rows].sort((a, b) => a.meters - b.meters || a.depart - b.depart);
  const seen = new Set<string>();
  const unique: LineDue[] = [];
  for (const row of ranked) {
    const key = `${row.routeId}|${fold(row.headsign)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
    if (unique.length >= limit) break;
  }
  unique.sort((a, b) => a.depart - b.depart || a.meters - b.meters);
  return unique;
}

/** Every official line that serves this pole, including parent/child ids. */
export function linesAtStop(atlas: Atlas, stop: AtlasStop, timetable?: Timetable | null): NearbyLine[] {
  const routes = new Map(atlas.routes.map((route) => [route.id, route]));
  const ids = new Set(stop.routes);
  if (timetable) {
    for (const stopId of lookupStopIds(stop)) {
      for (const entry of timetable[stopId] || []) ids.add(entry.r);
    }
  }
  if (stop.children) {
    const byId = new Map(atlas.stops.map((item) => [item.id, item]));
    for (const childId of stop.children) {
      const child = byId.get(childId);
      if (child) for (const routeId of child.routes) ids.add(routeId);
    }
  }
  const out: NearbyLine[] = [];
  for (const routeId of ids) {
    const route = routes.get(routeId);
    if (!route || !route.shortName) continue;
    out.push({
      routeId: route.id,
      shortName: route.shortName,
      color: route.color,
      textColor: route.textColor,
      longName: route.longName,
      type: route.type,
      meters: 0,
      stopId: stop.id,
      towardDest: false,
    });
  }
  out.sort((a, b) => {
    const metroA = a.type === 1 ? 0 : 1;
    const metroB = b.type === 1 ? 0 : 1;
    if (metroA !== metroB) return metroA - metroB;
    return a.shortName.localeCompare(b.shortName, "fr");
  });
  return out;
}

export type NearbyBoard = {
  lines: NearbyLine[];
  due: LineDue[];
  stop: (AtlasStop & { meters: number }) | null;
};

/** Nearby chips plus next due per direction, from this point — not from GPS-elsewhere. */
export function nearbyBoard(
  atlas: Atlas,
  timetable: Timetable,
  here: { lon: number; lat: number },
  now: number,
  active: Set<number>,
  dest?: { lon: number; lat: number } | null,
  limit = 16,
): NearbyBoard {
  if (!isFinitePoint(here)) return { lines: [], due: [], stop: null };
  const lines = nearbyLines(atlas, here, dest);
  const near = nearbyStops(atlas.stops, here, 700, 16);
  const best = new Map<string, LineDue>();
  for (const stop of near) {
    const pass = departuresAtStop(atlas, timetable, stop, now, active, 32);
    for (const row of pass) {
      const key = `${row.routeId}|${fold(row.headsign)}`;
      const candidate: LineDue = {
        routeId: row.routeId,
        shortName: row.shortName,
        color: row.color,
        textColor: row.textColor,
        stopId: stop.id,
        stopName: stop.name,
        meters: stop.meters,
        headsign: row.headsign,
        depart: row.depart,
        wait: row.depart - now,
        clocks: row.times.map((t) => formatClock(t)),
      };
      const prev = best.get(key);
      if (
        !prev ||
        candidate.depart < prev.depart ||
        (candidate.depart === prev.depart && candidate.meters < prev.meters)
      ) {
        best.set(key, candidate);
      }
    }
  }
  const cap = Math.min(32, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 16)));
  const due = [...best.values()].sort((a, b) => a.depart - b.depart || a.meters - b.meters).slice(0, cap);
  return { lines, due, stop: near[0] ?? null };
}

export function lineByShortNameOrColor(
  lines: NearbyLine[],
  query: string,
): NearbyLine | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const hex = q.replace(/^#/, "");
  return (
    lines.find((line) => line.shortName.toLowerCase() === q) ||
    lines.find((line) => line.color.replace(/^#/, "").toLowerCase() === hex) ||
    null
  );
}
