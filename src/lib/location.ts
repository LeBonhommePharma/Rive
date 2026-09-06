export type LocationFix = {
  lon: number;
  lat: number;
  accuracy: number;
  timestamp: number;
};

export type LocationFailure = "denied" | "unavailable" | "timeout" | "unsupported" | "insecure";

const FAILURE_MESSAGES: Record<LocationFailure, string> = {
  denied: "L’accès à ta position est refusé.",
  unavailable: "Ta position est indisponible pour le moment.",
  timeout: "La recherche de ta position a pris trop de temps.",
  unsupported: "Ce navigateur ne permet pas de te localiser.",
  insecure: "La localisation nécessite une connexion sécurisée.",
};

export class LocationRequestError extends Error {
  readonly reason: LocationFailure;

  constructor(reason: LocationFailure, message = FAILURE_MESSAGES[reason]) {
    super(message);
    this.name = "LocationRequestError";
    this.reason = reason;
  }
}

function validFix(fix: LocationFix): boolean {
  return Number.isFinite(fix.lon) && Math.abs(fix.lon) <= 180
    && Number.isFinite(fix.lat) && Math.abs(fix.lat) <= 90
    && Number.isFinite(fix.accuracy) && fix.accuracy >= 0
    && Number.isFinite(fix.timestamp) && fix.timestamp >= 0;
}

/** One bounded coarse lookup, then one fresh high-accuracy retry if needed. */
export function requestLocation(
  geolocation: Pick<Geolocation, "getCurrentPosition">,
  options: { signal?: AbortSignal; onRetry?: () => void } = {},
): Promise<LocationFix> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let generation = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const clearWatchdog = () => {
      if (watchdog !== undefined) clearTimeout(watchdog);
      watchdog = undefined;
    };
    const finish = (result: LocationFix | Error) => {
      if (settled) return;
      settled = true;
      generation += 1;
      clearWatchdog();
      options.signal?.removeEventListener("abort", abort);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const abort = () => finish(new DOMException("Localisation annulée.", "AbortError"));

    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
      finish(new LocationRequestError("unsupported"));
      return;
    }

    const attempt = (retry: boolean) => {
      const current = ++generation;
      const active = () => !settled && current === generation;
      const fail = (reason: LocationFailure) => {
        if (!active()) return;
        generation += 1;
        clearWatchdog();
        if (!retry && (reason === "timeout" || reason === "unavailable")) {
          try {
            options.onRetry?.();
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          if (!settled) attempt(true);
        } else {
          finish(new LocationRequestError(reason));
        }
      };
      const timeout = retry ? 15_000 : 10_000;
      // A browser may never call either callback, even after its own timeout.
      watchdog = setTimeout(() => fail("timeout"), timeout + 1_000);
      try {
        geolocation.getCurrentPosition(
          (position) => {
            if (!active()) return;
            const fix: LocationFix = {
              lon: position?.coords?.longitude,
              lat: position?.coords?.latitude,
              accuracy: position?.coords?.accuracy,
              timestamp: position?.timestamp,
            };
            if (!validFix(fix)) fail("unavailable");
            else finish(fix);
          },
          (error) => fail(error?.code === 1 ? "denied" : error?.code === 3 ? "timeout" : "unavailable"),
          { enableHighAccuracy: retry, timeout, maximumAge: retry ? 0 : 60_000 },
        );
      } catch (error) {
        fail(error instanceof DOMException && error.name === "SecurityError" ? "insecure" : "unavailable");
      }
    };
    attempt(false);
  });
}

export function accuracyLabel(accuracy: number): string {
  if (!Number.isFinite(accuracy) || accuracy < 0) return "Précision indisponible";
  const value = accuracy >= 1_000
    ? `${(accuracy / 1_000).toLocaleString("fr-CA", { maximumFractionDigits: 1 })} km`
    : `${Math.round(accuracy).toLocaleString("fr-CA")} m`;
  return `Précision estimée : ${value}`;
}

type Point = [number, number];
const EARTH_RADIUS_M = 6_371_000;
const CIRCLE_SEGMENTS = 64;

/** Clip an unwrapped ring into a longitude band, keeping map fills local. */
function clipLongitude(points: Point[], edge: number, keepAbove: boolean): Point[] {
  const result: Point[] = [];
  const inside = (point: Point) => keepAbove ? point[0] >= edge : point[0] <= edge;
  for (let i = 0; i < points.length; i += 1) {
    const from = points[(i + points.length - 1) % points.length];
    const to = points[i];
    if (inside(from) !== inside(to)) {
      const fraction = (edge - from[0]) / (to[0] - from[0]);
      result.push([edge, from[1] + fraction * (to[1] - from[1])]);
    }
    if (inside(to)) result.push(to);
  }
  return result;
}

/** Metre-based spherical accuracy footprint; no zoom-dependent pixel radius. */
export function accuracyCollection(fix: LocationFix | null): GeoJSON.FeatureCollection {
  if (!fix || !validFix(fix) || fix.accuracy === 0) return { type: "FeatureCollection", features: [] };
  const angularRadius = Math.min(Math.PI, fix.accuracy / EARTH_RADIUS_M);
  if (angularRadius === Math.PI) {
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature", properties: { accuracy: fix.accuracy },
        geometry: { type: "Polygon", coordinates: [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]] },
      }],
    };
  }
  const lat = fix.lat * Math.PI / 180;
  const lon = fix.lon * Math.PI / 180;
  const sinRadius = Math.sin(angularRadius);
  const cosRadius = Math.cos(angularRadius);
  const ring: Point[] = [];
  let previousLon = fix.lon;
  for (let i = 0; i <= CIRCLE_SEGMENTS; i += 1) {
    const bearing = -i * 2 * Math.PI / CIRCLE_SEGMENTS;
    // Local north/east tangent basis is well-defined even at the poles.
    const radial = cosRadius * Math.cos(lat) - sinRadius * Math.cos(bearing) * Math.sin(lat);
    const east = sinRadius * Math.sin(bearing);
    const x = radial * Math.cos(lon) - east * Math.sin(lon);
    const y = radial * Math.sin(lon) + east * Math.cos(lon);
    const z = cosRadius * Math.sin(lat) + sinRadius * Math.cos(bearing) * Math.cos(lat);
    let pointLon = Math.atan2(y, x) * 180 / Math.PI;
    while (pointLon - previousLon > 180) pointLon -= 360;
    while (pointLon - previousLon < -180) pointLon += 360;
    ring.push([pointLon, Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI]);
    previousLon = pointLon;
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.abs(last[0] - first[0]) > 180) {
    // A polar disc closes along the pole, rather than across the map.
    const pole = fix.lat >= 0 ? 90 : -90;
    ring.push([last[0], pole], [first[0], pole]);
  } else {
    ring.pop();
  }
  const minBand = Math.floor((Math.min(...ring.map((point) => point[0])) + 180) / 360);
  const maxBand = Math.floor((Math.max(...ring.map((point) => point[0])) + 180) / 360);
  const polygons: Point[][][] = [];
  for (let band = minBand; band <= maxBand; band += 1) {
    const clipped = clipLongitude(clipLongitude(ring, -180 + band * 360, true), 180 + band * 360, false);
    if (clipped.length < 3) continue;
    const normalized: Point[] = clipped.map(([x, y]) => [Math.max(-180, Math.min(180, x - band * 360)), y]);
    normalized.push([...normalized[0]]);
    polygons.push([normalized]);
  }
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { accuracy: fix.accuracy },
      geometry: polygons.length === 1
        ? { type: "Polygon", coordinates: polygons[0] }
        : { type: "MultiPolygon", coordinates: polygons },
    }],
  };
}
