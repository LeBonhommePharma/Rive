import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { haversineMeters } from "./geo";
import { accuracyCollection, accuracyLabel, LocationRequestError, requestLocation } from "./location";
import type { LocationFix } from "./location";

const FIX: LocationFix = { lon: -73.58, lat: 45.49, accuracy: 35, timestamp: 1_788_660_000_000 };

function position(fix: LocationFix = FIX): GeolocationPosition {
  return {
    timestamp: fix.timestamp,
    coords: {
      longitude: fix.lon, latitude: fix.lat, accuracy: fix.accuracy,
      altitude: null, altitudeAccuracy: null, heading: null, speed: null,
    },
  } as GeolocationPosition;
}

function failure(code: number): GeolocationPositionError {
  return { code, message: "browser error", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
}

function provider() {
  const calls: { success: PositionCallback; error?: PositionErrorCallback | null; options?: PositionOptions }[] = [];
  const geolocation: Pick<Geolocation, "getCurrentPosition"> = {
    getCurrentPosition(success, error, options) { calls.push({ success, error, options }); },
  };
  return { geolocation, calls };
}

describe("bounded browser location", () => {
  it("accepts a coarse fix, preserving measured accuracy and timestamp", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { geolocation, calls } = provider();
    const pending = requestLocation(geolocation);
    assert.deepEqual(calls[0].options, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
    calls[0].success(position());
    assert.deepEqual(await pending, FIX);
    t.mock.timers.runAll();
    assert.equal(calls.length, 1);
  });

  it("never retries permission denial", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { geolocation, calls } = provider();
    let retries = 0;
    const pending = assert.rejects(requestLocation(geolocation, { onRetry: () => { retries += 1; } }),
      (error: unknown) => error instanceof LocationRequestError && error.reason === "denied");
    calls[0].error?.(failure(1));
    await pending;
    t.mock.timers.runAll();
    assert.equal(calls.length, 1);
    assert.equal(retries, 0);
  });

  for (const code of [2, 3]) {
    it(`retries browser error ${code} exactly once with a fresh high-accuracy request`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const { geolocation, calls } = provider();
      let retries = 0;
      const pending = requestLocation(geolocation, { onRetry: () => { retries += 1; } });
      calls[0].error?.(failure(code));
      assert.equal(calls.length, 2);
      assert.equal(retries, 1);
      assert.deepEqual(calls[1].options, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
      calls[1].success(position());
      assert.deepEqual(await pending, FIX);
      t.mock.timers.runAll();
      assert.equal(calls.length, 2);
    });
  }

  it("rejects the second failure without starting a third request", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { geolocation, calls } = provider();
    const pending = assert.rejects(requestLocation(geolocation),
      (error: unknown) => error instanceof LocationRequestError && error.reason === "unavailable");
    calls[0].error?.(failure(3));
    calls[1].error?.(failure(2));
    await pending;
    t.mock.timers.runAll();
    assert.equal(calls.length, 2);
  });

  it("bounds a browser that never invokes either callback to 27 seconds", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { geolocation, calls } = provider();
    let retries = 0;
    const pending = assert.rejects(requestLocation(geolocation, { onRetry: () => { retries += 1; } }),
      (error: unknown) => error instanceof LocationRequestError && error.reason === "timeout");
    t.mock.timers.tick(10_999);
    assert.equal(calls.length, 1);
    t.mock.timers.tick(1);
    assert.equal(calls.length, 2);
    assert.equal(retries, 1);
    t.mock.timers.tick(15_999);
    t.mock.timers.tick(1);
    await pending;
    t.mock.timers.runAll();
    assert.equal(calls.length, 2);
  });

  it("ignores late callbacks from a timed-out first attempt", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { geolocation, calls } = provider();
    const pending = requestLocation(geolocation);
    t.mock.timers.tick(11_000);
    calls[0].success(position({ ...FIX, lon: 1 }));
    calls[0].error?.(failure(1));
    calls[1].success(position());
    calls[1].error?.(failure(3));
    assert.deepEqual(await pending, FIX);
    t.mock.timers.runAll();
    assert.equal(calls.length, 2);
  });

  it("aborts a pending retry, removes watchdogs, and ignores late success", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { geolocation, calls } = provider();
    const controller = new AbortController();
    const pending = assert.rejects(requestLocation(geolocation, { signal: controller.signal }), { name: "AbortError" });
    calls[0].error?.(failure(2));
    controller.abort();
    await pending;
    calls[1].success(position());
    calls[0].success(position());
    t.mock.timers.runAll();
    assert.equal(calls.length, 2);
  });

  it("does not ask the browser when already cancelled", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { geolocation, calls } = provider();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(requestLocation(geolocation, { signal: controller.signal }), { name: "AbortError" });
    t.mock.timers.runAll();
    assert.equal(calls.length, 0);
  });

  it("does not start a retry if the retry notification cancels the request", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { geolocation, calls } = provider();
    const controller = new AbortController();
    const pending = assert.rejects(requestLocation(geolocation, {
      signal: controller.signal, onRetry: () => controller.abort(),
    }), { name: "AbortError" });
    calls[0].error?.(failure(2));
    await pending;
    t.mock.timers.runAll();
    assert.equal(calls.length, 1);
  });

  for (const patch of [
    { lon: Number.NaN }, { lon: 181 }, { lat: -91 }, { lat: Infinity },
    { accuracy: -1 }, { accuracy: Infinity }, { accuracy: Number.NaN }, { timestamp: Number.NaN },
  ]) {
    it(`rejects malformed fix ${Object.keys(patch)[0]}=${Object.values(patch)[0]}`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const { geolocation, calls } = provider();
      const pending = assert.rejects(requestLocation(geolocation),
        (error: unknown) => error instanceof LocationRequestError && error.reason === "unavailable");
      calls[0].success(position({ ...FIX, ...patch }));
      assert.equal(calls.length, 2);
      calls[1].success(position({ ...FIX, ...patch }));
      await pending;
    });
  }

  it("handles synchronous security failures without retrying", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let calls = 0;
    await assert.rejects(requestLocation({ getCurrentPosition() {
      calls += 1;
      throw new DOMException("blocked", "SecurityError");
    } }), (error: unknown) => error instanceof LocationRequestError && error.reason === "insecure");
    t.mock.timers.runAll();
    assert.equal(calls, 1);
  });

  it("reports missing runtime browser support", async () => {
    await assert.rejects(requestLocation({} as Geolocation),
      (error: unknown) => error instanceof LocationRequestError && error.reason === "unsupported");
  });
});

describe("location accuracy presentation", () => {
  it("formats measured metres and kilometres in French", () => {
    assert.equal(accuracyLabel(35), "Précision estimée : 35 m");
    assert.equal(accuracyLabel(1_200), "Précision estimée : 1,2 km");
    assert.equal(accuracyLabel(0), "Précision estimée : 0 m");
    assert.equal(accuracyLabel(-1), "Précision indisponible");
    assert.equal(accuracyLabel(Infinity), "Précision indisponible");
  });

  it("returns no footprint for missing, invalid, or zero-area fixes", () => {
    for (const fix of [null, { ...FIX, lon: 181 }, { ...FIX, accuracy: -1 }, { ...FIX, accuracy: 0 }]) {
      assert.deepEqual(accuracyCollection(fix), { type: "FeatureCollection", features: [] });
    }
  });

  it("uses metre-based geodesic vertices at the equator, Montréal, and high latitudes", () => {
    for (const lat of [0, FIX.lat, 80]) {
      const fix = { ...FIX, lat, accuracy: 1_200 };
      const collection = accuracyCollection(fix);
      assert.equal(collection.features.length, 1);
      const geometry = collection.features[0].geometry;
      assert.equal(geometry.type, "Polygon");
      if (geometry.type !== "Polygon") throw new Error("Expected polygon");
      const ring = geometry.coordinates[0];
      assert.equal(ring.length, 65);
      assert.deepEqual(ring[0], ring[ring.length - 1]);
      for (const [lon, lat] of ring) {
        assert.ok(Math.abs(haversineMeters(fix, { lon, lat }) - fix.accuracy) < 0.001);
      }
      const signedArea = ring.slice(1).reduce((area, point, i) => area + ring[i][0] * point[1] - point[0] * ring[i][1], 0);
      assert.ok(signedArea > 0, "Exterior ring must be counterclockwise");
    }
  });

  it("splits dateline crossings while keeping every coordinate within geographic bounds", () => {
    const fix = { ...FIX, lon: 179.999, lat: 45, accuracy: 5_000 };
    const geometry = accuracyCollection(fix).features[0].geometry;
    assert.equal(geometry.type, "MultiPolygon");
    if (geometry.type !== "MultiPolygon") throw new Error("Expected dateline multipolygon");
    assert.equal(geometry.coordinates.length, 2);
    for (const [ring] of geometry.coordinates) {
      assert.deepEqual(ring[0], ring[ring.length - 1]);
      for (const [lon, lat] of ring) {
        assert.ok(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90);
        assert.ok(Math.abs(haversineMeters(fix, { lon, lat }) - fix.accuracy) < fix.accuracy * 0.003);
      }
      assert.ok(Math.max(...ring.map(([lon]) => lon)) - Math.min(...ring.map(([lon]) => lon)) < 1);
    }
  });

  it("keeps polar footprints finite and closes the cap at the pole", () => {
    for (const lat of [89.999, 90, -90]) {
      const geometry = accuracyCollection({ ...FIX, lat, accuracy: 5_000 }).features[0].geometry;
      const polygons = geometry.type === "Polygon" ? [geometry.coordinates]
        : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
      assert.ok(polygons.length > 0);
      assert.ok(polygons.some(([ring]) => ring.some(([, pointLat]) => pointLat === Math.sign(lat) * 90)));
      for (const [ring] of polygons) {
        assert.deepEqual(ring[0], ring[ring.length - 1]);
        for (const [lon, pointLat] of ring) {
          assert.ok(Number.isFinite(lon) && Math.abs(lon) <= 180);
          assert.ok(Number.isFinite(pointLat) && Math.abs(pointLat) <= 90);
        }
      }
    }
  });
});
