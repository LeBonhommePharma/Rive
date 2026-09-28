import { isCityId, loadAtlas, loadTimetable } from "@/lib/atlas/store";
import { allowRateLimit, isFiniteCoordinate, parseClock, requestRateLimitKey } from "@/lib/http";
import { nearbyBoard } from "@/lib/lines";
import { activeServiceIndexes } from "@/lib/services";
import { minutesOfDay, montrealNow } from "@/lib/time";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!allowRateLimit(requestRateLimitKey(request, "nearby"), 180, 60_000)) {
    return Response.json({ error: "Trop de requêtes." }, { status: 429 });
  }
  const url = new URL(request.url);
  const city = url.searchParams.get("city") || "";
  const hasLon = url.searchParams.has("lon");
  const hasLat = url.searchParams.has("lat");
  const lon = Number(url.searchParams.get("lon"));
  const lat = Number(url.searchParams.get("lat"));
  const destLon = url.searchParams.has("destLon") ? Number(url.searchParams.get("destLon")) : null;
  const destLat = url.searchParams.has("destLat") ? Number(url.searchParams.get("destLat")) : null;
  const atParam = url.searchParams.get("at");
  if (
    !isCityId(city) ||
    !hasLon ||
    !hasLat ||
    !isFiniteCoordinate(lon, -180, 180) ||
    !isFiniteCoordinate(lat, -90, 90)
  ) {
    return Response.json({ error: "Ville ou coordonnées invalides." }, { status: 400 });
  }
  const dest =
    destLon != null && destLat != null && isFiniteCoordinate(destLon, -180, 180) && isFiniteCoordinate(destLat, -90, 90)
      ? { lon: destLon, lat: destLat }
      : null;
  const at = atParam ? parseClock(atParam) : montrealNow();
  if (!at) {
    return Response.json({ error: "Horloge invalide." }, { status: 400 });
  }
  const [atlas, timetable] = await Promise.all([loadAtlas(city), loadTimetable(city)]);
  const now = minutesOfDay(at);
  const board = nearbyBoard(atlas, timetable, { lon, lat }, now, activeServiceIndexes(atlas, at), dest);
  return Response.json({
    city,
    at: at.toISOString(),
    now,
    here: { lon, lat },
    stop: board.stop,
    lines: board.lines,
    due: board.due,
  });
}
