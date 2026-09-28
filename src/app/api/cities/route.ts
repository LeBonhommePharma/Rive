import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CITY_VISITS } from "@/lib/search";
import {
  ATLAS_GAP_TEXT,
  cityCentersFromIndex,
  coverageCenters,
  registryCities,
} from "@/lib/viewport-city";

export const runtime = "nodejs";

export async function GET(_request?: Request) {
  let shipped: Array<{ city?: unknown; name?: unknown; center?: unknown; zoom?: unknown }> = [];
  try {
    const index = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "index.json"), "utf8")) as {
      cities?: Array<{ city?: unknown; name?: unknown; center?: unknown; zoom?: unknown }>;
    };
    shipped = Array.isArray(index.cities) ? index.cities : [];
  } catch {
    shipped = [];
  }
  const shippedIds = shipped
    .map((row) => (typeof row.city === "string" ? row.city : ""))
    .filter(Boolean);
  const registry = registryCities(shippedIds);
  const centers = coverageCenters(cityCentersFromIndex(shipped), registry);
  return Response.json({
    shipped: shippedIds,
    registry,
    visits: CITY_VISITS,
    centers,
    atlasGap: ATLAS_GAP_TEXT,
  });
}
