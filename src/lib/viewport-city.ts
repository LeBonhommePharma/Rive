import registry from "./registry.json" with { type: "json" };
import { CITY_MEMBERSHIP_M, CITY_VISITS, cityForPoint } from "./search";

/** Pan-to-city copy.
 *  Automatic: a packed city already in public/data (and listed in index.json) can be
 *  switched to from chips or by panning the map onto its service area.
 *  Not automatic: a new GTFS city still needs a registry.json entry plus `npm run ingest`.
 */
export const ATLAS_GAP_TEXT =
  "Cet endroit n'est pas dans l'atlas. Pour l'ajouter, inscris-le dans registry.json puis lance npm run ingest.";

const PACKED_CITY_NAMES: Record<string, string> = {
  quebec: "Québec",
  montreal: "Montréal",
  sherbrooke: "Sherbrooke",
  "trois-rivieres": "Trois-Rivières",
};

export type CityCenterTable = Record<string, { lon: number; lat: number; name?: string; zoom?: number }>;

export type ViewportCityHint =
  | { kind: "current"; city: string }
  | { kind: "offer"; city: string; name: string; label: string; shipped: true }
  | { kind: "ingest"; city: string; name: string; label: string; shipped: false; text: string }
  | { kind: "outside"; text: string };

export type RegistryCity = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  zoom: number;
  shipped: boolean;
};

type RegistryFile = {
  cities?: Array<{
    id?: unknown;
    name?: unknown;
    center?: unknown;
    zoom?: unknown;
  }>;
};

export function packedCityName(id: string, names?: Record<string, string> | null): string {
  if (names && typeof names[id] === "string" && names[id]) return names[id];
  if (typeof PACKED_CITY_NAMES[id] === "string") return PACKED_CITY_NAMES[id];
  return id || "";
}

export function cityCentersFromIndex(
  cities: Array<{ city?: unknown; center?: unknown; name?: unknown; zoom?: unknown }>,
): CityCenterTable {
  const out: CityCenterTable = {};
  for (const item of cities) {
    if (typeof item.city !== "string" || !item.city) continue;
    if (!Array.isArray(item.center) || item.center.length < 2) continue;
    const lon = Number(item.center[0]);
    const lat = Number(item.center[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const name = typeof item.name === "string" && item.name ? item.name : item.city;
    const zoom = Number(item.zoom);
    out[item.city] = {
      lon,
      lat,
      name,
      zoom: Number.isFinite(zoom) ? zoom : undefined,
    };
  }
  return out;
}

export function registryCities(shippedIds?: Iterable<string> | null): RegistryCity[] {
  const shipped = new Set(shippedIds ? [...shippedIds] : []);
  const file = registry as RegistryFile;
  const out: RegistryCity[] = [];
  for (const item of file.cities || []) {
    if (typeof item.id !== "string" || !item.id) continue;
    if (!Array.isArray(item.center) || item.center.length < 2) continue;
    const lon = Number(item.center[0]);
    const lat = Number(item.center[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const zoom = Number(item.zoom);
    out.push({
      id: item.id,
      name: typeof item.name === "string" && item.name ? item.name : item.id,
      lon,
      lat,
      zoom: Number.isFinite(zoom) ? zoom : 12.4,
      shipped: shipped.size === 0 ? true : shipped.has(item.id),
    });
  }
  return out;
}

export function coverageCenters(
  shipped: CityCenterTable,
  registryList: RegistryCity[] = registryCities(Object.keys(shipped)),
): CityCenterTable {
  const out: CityCenterTable = {};
  for (const row of registryList) {
    out[row.id] = { lon: row.lon, lat: row.lat, name: row.name, zoom: row.zoom };
  }
  for (const [id, center] of Object.entries(shipped)) {
    out[id] = { ...center, name: center.name || packedCityName(id) };
  }
  return out;
}

export function viewportCityHint(
  detected: string | null | undefined,
  currentCity: string,
  names?: Record<string, string> | null,
  shippedIds?: Iterable<string> | null,
): ViewportCityHint {
  if (!detected) return { kind: "outside", text: ATLAS_GAP_TEXT };
  if (detected === currentCity) return { kind: "current", city: detected };
  const name = packedCityName(detected, names);
  const shipped = shippedIds ? new Set([...shippedIds]) : null;
  if (shipped && !shipped.has(detected)) {
    return {
      kind: "ingest",
      city: detected,
      name,
      label: `Ajouter ${name}`,
      shipped: false,
      text: ATLAS_GAP_TEXT,
    };
  }
  return { kind: "offer", city: detected, name, label: `Charger ${name}`, shipped: true };
}

export function cityAtViewport(
  lon: number,
  lat: number,
  centers: CityCenterTable,
  radiusM = CITY_MEMBERSHIP_M,
): string | null {
  return cityForPoint(lon, lat, centers, radiusM);
}

export function hintAtViewport(
  lon: number,
  lat: number,
  currentCity: string,
  centers: CityCenterTable,
  names?: Record<string, string> | null,
  shippedIds?: Iterable<string> | null,
  radiusM = CITY_MEMBERSHIP_M,
): ViewportCityHint {
  return viewportCityHint(cityAtViewport(lon, lat, centers, radiusM), currentCity, names, shippedIds);
}

export { CITY_VISITS, CITY_MEMBERSHIP_M };
