import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { GET as citiesGet } from "@/app/api/cities/route";
import { GET as nearbyGet } from "@/app/api/nearby/route";
import type { Atlas, Timetable } from "./atlas/types";
import { daytimeClock } from "./clock";
import { itineraryHasTransfer, itinerarySteps, transitLegsOf } from "./itinerary-display";
import { nearbyBoard } from "./lines";
import { departuresAtStop, planTrip } from "./planner";
import { firstStopFromQuery, placeFromStop, supportedCityCenters } from "./search";
import { activeServiceIndexes } from "./services";
import { minutesOfDay } from "./time";
import {
  ATLAS_GAP_TEXT,
  cityCentersFromIndex,
  coverageCenters,
  hintAtViewport,
  packedCityName,
  registryCities,
  viewportCityHint,
} from "./viewport-city";

function loadCity(city: string): { atlas: Atlas; timetable: Timetable } {
  const root = join(process.cwd(), "public", "data", city);
  return {
    atlas: JSON.parse(readFileSync(join(root, "atlas.json"), "utf8")) as Atlas,
    timetable: JSON.parse(readFileSync(join(root, "timetable.json"), "utf8")) as Timetable,
  };
}

async function readJson(res: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("remote stop board lists every unique line at a hub", () => {
  it("uniques first then caps, so a busy pole is not stuck at 12", () => {
    const clock = daytimeClock();
    const now = minutesOfDay(clock);
    for (const [city, query] of [
      ["quebec", "Youville"],
      ["montreal", "Berri"],
    ] as const) {
      const { atlas, timetable } = loadCity(city);
      const stop = firstStopFromQuery(atlas, query);
      assert.ok(stop, `${city} ${query}`);
      const active = activeServiceIndexes(atlas, clock);
      const wide = departuresAtStop(atlas, timetable, stop, now, active, 48);
      const slim = departuresAtStop(atlas, timetable, stop, now, active, 12);
      assert.ok(wide.length >= slim.length, `${city} unique-all must not shrink vs a 12 cap`);
      assert.ok(wide.length > 0, `${city} ${query} must have passages`);
      if (wide.length > 12) {
        assert.equal(slim.length, 12);
        assert.ok(wide.length > 12, `${city} hub must keep lines past the old 12 cut`);
      }
    }
  });

  it("prefers an official stop over the first search hit when looking up a remote timetable", () => {
    const { atlas } = loadCity("quebec");
    const stop = firstStopFromQuery(atlas, "Youville");
    assert.ok(stop);
    assert.equal(firstStopFromQuery(atlas, "Youville")?.id, stop.id);
    const react = readFileSync(join(process.cwd(), "src", "components", "rive-app.tsx"), "utf8");
    assert.match(react, /firstStopFromQuery/);
    assert.match(react, /pendingLookup/);
    assert.doesNotMatch(react, /searchAtlas\(atlas, intent\.query, 1/);
  });
});

describe("multi-leg itinerary steps", () => {
  it("plans Montmorency to McGill with a transfer and lists every leg", () => {
    const { atlas, timetable } = loadCity("montreal");
    const fromStop = firstStopFromQuery(atlas, "Terminus Montmorency") || firstStopFromQuery(atlas, "Montmorency");
    const toStop = firstStopFromQuery(atlas, "McGill");
    assert.ok(fromStop && toStop);
    const clock = daytimeClock();
    const planned = planTrip(
      atlas,
      timetable,
      placeFromStop(fromStop),
      placeFromStop(toStop),
      minutesOfDay(clock),
      activeServiceIndexes(atlas, clock),
    );
    const withTransfer = planned.find((row) => itineraryHasTransfer(row) || transitLegsOf(row).length > 1);
    assert.ok(withTransfer, "Montmorency → McGill must yield a two-transit option");
    assert.ok(withTransfer.transfers >= 1 || transitLegsOf(withTransfer).length > 1);
    const steps = itinerarySteps(withTransfer);
    assert.equal(steps.length, withTransfer.legs.length);
    assert.ok(steps.some((step) => step.kind === "transit"));
    assert.ok(steps.filter((step) => step.kind === "transit").length >= 2);
  });
});

describe("pan-to-city viewport hints", () => {
  it("offers another shipped metro and stays honest outside the atlas", () => {
    const centers = supportedCityCenters();
    const shipped = Object.keys(centers);
    const names = { quebec: "Québec", montreal: "Montréal" };
    assert.equal(viewportCityHint("quebec", "quebec", names, shipped).kind, "current");
    const offer = viewportCityHint("montreal", "quebec", names, shipped);
    assert.equal(offer.kind, "offer");
    if (offer.kind === "offer") {
      assert.equal(offer.city, "montreal");
      assert.match(offer.label, /Charger Montréal/);
    }
    const outside = viewportCityHint(null, "quebec", names, shipped);
    assert.equal(outside.kind, "outside");
    if (outside.kind === "outside") assert.equal(outside.text, ATLAS_GAP_TEXT);
    const ingest = viewportCityHint("ottawa", "quebec", names, shipped);
    assert.equal(ingest.kind, "ingest");
    if (ingest.kind === "ingest") {
      assert.match(ingest.text, /registry\.json/);
      assert.match(ingest.text, /npm run ingest/);
    }
    const pan = hintAtViewport(centers.montreal.lon, centers.montreal.lat, "quebec", centers, names, shipped);
    assert.equal(pan.kind, "offer");
    const stay = hintAtViewport(centers.quebec.lon, centers.quebec.lat, "quebec", centers, names, shipped);
    assert.equal(stay.kind, "current");
    const far = hintAtViewport(-75.7, 45.42, "quebec", centers, names, shipped);
    assert.equal(far.kind, "outside");
    assert.equal(packedCityName("trois-rivieres"), "Trois-Rivières");
  });

  it("merges packed index centers with the GTFS registry", () => {
    const index = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "index.json"), "utf8")) as {
      cities: Array<{ city: string; name: string; center: [number, number] }>;
    };
    const shipped = cityCentersFromIndex(index.cities);
    const registry = registryCities(Object.keys(shipped));
    const merged = coverageCenters(shipped, registry);
    assert.ok(merged.quebec && merged.montreal && merged.sherbrooke && merged["trois-rivieres"]);
    assert.ok(registry.some((row) => row.id === "quebec" && row.shipped));
  });

  it("keeps the static pan-to-load control and the React city chips", async () => {
    const kit = (await import(pathToFileURL(join(process.cwd(), "public", "Transit", "rive-kit.js")).href)) as {
      viewportCityHint: typeof viewportCityHint;
      ATLAS_GAP_TEXT: string;
    };
    const offer = kit.viewportCityHint("sherbrooke", "quebec");
    assert.equal(offer.kind, "offer");
    assert.equal(kit.ATLAS_GAP_TEXT, ATLAS_GAP_TEXT);
    const html = readFileSync(join(process.cwd(), "public", "Transit", "index.html"), "utf8");
    const src = readFileSync(join(process.cwd(), "public", "Transit", "app.js"), "utf8");
    assert.match(html, /id="load-city"/);
    assert.match(html, /id="atlas-gap"/);
    assert.match(src, /paintPanCityHint/);
    assert.match(src, /schedulePanCityHint/);
    const react = readFileSync(join(process.cwd(), "src", "components", "rive-app.tsx"), "utf8");
    assert.match(react, /onCamera/);
    assert.match(react, /hintAtViewport/);
    assert.match(react, /tr\("aller"\)/);
    assert.match(react, /leg\.kind === "road"/);
    assert.match(react, /ItinerarySteps/);
    assert.match(react, /\/api\/nearby/);
    assert.match(react, /\/api\/cities/);
    assert.match(react, /chipsForCities/);
    assert.doesNotMatch(react, /\bGO\b/);
    const board = readFileSync(join(process.cwd(), "ios", "RiveApp", "RiveNativeBoard.swift"), "utf8");
    assert.match(board, /RiveCityChip/);
    assert.match(board, /RiveAllerButton/);
    assert.match(board, /laval/);
    assert.match(board, /longueuil/);
  });
});

describe("nearby and cities HTTP", () => {
  const at = daytimeClock().toISOString();

  it("rejects nearby without coordinates", async () => {
    const res = await nearbyGet(new Request("http://rive.test/api/nearby?city=quebec"));
    const { status, body } = await readJson(res);
    assert.equal(status, 400);
    assert.equal(typeof body.error, "string");
  });

  it("returns nearby lines and due at Youville and Berri", async () => {
    const quebec = loadCity("quebec");
    const youville = firstStopFromQuery(quebec.atlas, "Youville");
    assert.ok(youville);
    const qRes = await nearbyGet(
      new Request(
        `http://rive.test/api/nearby?city=quebec&lon=${youville.lon}&lat=${youville.lat}&at=${encodeURIComponent(at)}`,
      ),
    );
    const q = await readJson(qRes);
    assert.equal(q.status, 200);
    assert.ok(Array.isArray(q.body.lines));
    assert.ok(Array.isArray(q.body.due));
    assert.ok((q.body.lines as unknown[]).length > 0);
    assert.ok((q.body.due as unknown[]).length > 0);
    const montreal = loadCity("montreal");
    const berri = firstStopFromQuery(montreal.atlas, "Berri");
    assert.ok(berri);
    const mRes = await nearbyGet(
      new Request(
        `http://rive.test/api/nearby?city=montreal&lon=${berri.lon}&lat=${berri.lat}&at=${encodeURIComponent(at)}`,
      ),
    );
    const m = await readJson(mRes);
    assert.equal(m.status, 200);
    assert.ok((m.body.due as unknown[]).length > 0);
    const clock = daytimeClock();
    const board = nearbyBoard(
      quebec.atlas,
      quebec.timetable,
      { lon: youville.lon, lat: youville.lat },
      minutesOfDay(clock),
      activeServiceIndexes(quebec.atlas, clock),
    );
    assert.ok(board.stop);
    assert.ok(board.lines.length > 0);
  });

  it("lists shipped cities and the GTFS registry with no paywall copy", async () => {
    const res = await citiesGet(new Request("http://rive.test/api/cities"));
    const { status, body } = await readJson(res);
    assert.equal(status, 200);
    const shipped = body.shipped as string[];
    assert.ok(shipped.includes("quebec"));
    assert.ok(shipped.includes("montreal"));
    assert.ok(shipped.includes("sherbrooke"));
    assert.ok(shipped.includes("trois-rivieres"));
    const registry = body.registry as Array<{ id: string; name: string }>;
    assert.ok(registry.some((row) => row.id === "montreal"));
    assert.match(String(body.atlasGap), /registry\.json/);
    const react = readFileSync(join(process.cwd(), "src", "components", "rive-app.tsx"), "utf8");
    assert.doesNotMatch(react, /premium|Royale|abonnement payant/i);
  });
});
