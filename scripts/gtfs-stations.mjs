/**
 * Parent-station cleanup for packed GTFS stops. Import-safe: no network, no writes.
 *
 * The atlas treats a `location_type=1` station as a hub: search ranks it like a
 * metro station and the map draws it as one. Some agencies instead wrap every
 * bus stop in its own station — RTC (Québec) does from the 2026-11-18 feed on,
 * stop 0:1127 under station 1:1127 — which doubles each stop in search and on
 * the map and hands every one of them the hub bonus. A station that wraps at
 * most one stop and is served only by buses is that duplicate; drop it and let
 * the stop stand alone. Rail and metro stations, and any station that groups
 * several stops, are kept.
 */

/** GTFS route_type values that are road vehicles: bus, trolleybus, coach and the extended bus range. */
export function isRoadRouteType(type) {
  const t = Number(type);
  return t === 3 || t === 11 || (t >= 200 && t < 300) || (t >= 700 && t < 800);
}

/**
 * @param {Array<{id: string, kind?: number, parent?: string, routes?: string[], children?: string[]}>} stops
 * @param {Map<string, number>} routeTypeById
 * @returns {{stops: typeof stops, collapsed: number}}
 */
export function collapseLoneBusStations(stops, routeTypeById) {
  const lone = new Set();
  for (const stop of stops) {
    if (stop.kind !== 1) continue;
    if ((stop.children || []).length > 1) continue;
    const routes = stop.routes || [];
    if (!routes.every((id) => isRoadRouteType(routeTypeById.get(id) ?? 3))) continue;
    lone.add(stop.id);
  }
  if (lone.size === 0) return { stops, collapsed: 0 };
  const kept = [];
  for (const stop of stops) {
    if (lone.has(stop.id)) continue;
    if (stop.parent && lone.has(stop.parent)) {
      const standalone = { ...stop };
      delete standalone.parent;
      kept.push(standalone);
    } else {
      kept.push(stop);
    }
  }
  return { stops: kept, collapsed: lone.size };
}
