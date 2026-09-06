import { NextResponse } from "next/server";
import { isCityId } from "@/lib/atlas/store";
import { allowRateLimit, isFiniteCoordinate, requestRateLimitKey } from "@/lib/http";
import { BIKE_FEEDS, mergeStations, nearbyStations } from "@/lib/bikeshare";
import { stationsFor } from "@/lib/bike-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!allowRateLimit(requestRateLimitKey(request, "bikes"), 120, 60_000)) {
    return NextResponse.json({ error: "Trop de requêtes." }, { status: 429 });
  }
  const url = new URL(request.url);
  const city = url.searchParams.get("city") || "";
  if (!isCityId(city)) {
    return NextResponse.json({ error: "Ville inconnue." }, { status: 400 });
  }
  let stations: ReturnType<typeof mergeStations>;
  try {
    stations = await stationsFor(city);
  } catch {
    return NextResponse.json({ error: "Données vélo indisponibles.", stations: [] }, { status: 502 });
  }
  const lon = Number(url.searchParams.get("lon"));
  const lat = Number(url.searchParams.get("lat"));
  const hasLon = url.searchParams.has("lon");
  const hasLat = url.searchParams.has("lat");
  if (hasLon !== hasLat || (hasLon && (!isFiniteCoordinate(lon, -180, 180) || !isFiniteCoordinate(lat, -90, 90)))) {
    return NextResponse.json({ error: "Coordonnées invalides.", stations: [] }, { status: 400 });
  }
  const near =
    hasLon && hasLat
      ? nearbyStations(stations, { lon, lat })
      : stations.slice(0, 40);
  return NextResponse.json({
    system: BIKE_FEEDS[city]?.label || "",
    stations: near,
  });
}
