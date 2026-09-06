import { BIKE_FEEDS, feedUrl, mergeStations } from "./bikeshare";
import type { CityId } from "./atlas/types";

const cache = new Map<string, { at: number; stations: ReturnType<typeof mergeStations> }>();
const MAX_GBFS_BYTES = 4 * 1024 * 1024;

async function readJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`GBFS ${response.status}`);
  const advertised = response.headers.get("content-length");
  if (advertised && Number(advertised) > MAX_GBFS_BYTES) throw new Error("GBFS response too large");
  if (!response.body) throw new Error("GBFS response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_GBFS_BYTES) {
      await reader.cancel();
      throw new Error("GBFS response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function fetchJson(url: string): Promise<unknown> {
  return readJsonResponse(
    await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    }),
  );
}

export async function stationsFor(city: CityId) {
  const hit = cache.get(city);
  if (hit && Date.now() - hit.at < 45_000) return hit.stations;
  const spec = BIKE_FEEDS[city];
  if (!spec) return [];
  const discovery = await fetchJson(spec.gbfs);
  const origin = new URL(spec.gbfs).origin;
  const infoUrl = feedUrl(discovery, "station_information", origin);
  const statusUrl = feedUrl(discovery, "station_status", origin);
  if (!infoUrl || !statusUrl) return [];
  const [info, status] = await Promise.all([
    fetchJson(infoUrl),
    fetchJson(statusUrl),
  ]);
  const stations = mergeStations(info, status, spec.system);
  cache.set(city, { at: Date.now(), stations });
  return stations;
}

