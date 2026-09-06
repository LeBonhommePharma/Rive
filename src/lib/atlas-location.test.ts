import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { applyPitch, invertPitch } from "../../public/Transit/buildings.js";
import { acceptRiderFix, emptyRiderStore, forgetInAppLocationGrant, cityAfterHereSample, escapeHtml } from "../../public/Transit/rive-kit.js";

type Fix = { coords: { longitude: number; latitude: number; accuracy: number }; timestamp: number };
type Failure = { code: number };
type Here = { lon: number; lat: number; source: string; at: number; accuracy?: number };
type Request = { success: (fix: Fix) => void; error: (error: Failure) => void; options: PositionOptions };
const source = readFileSync(new URL("../../public/Transit/app.js", import.meta.url), "utf8");
const uiHelpers = source.slice(source.indexOf("function atlasText("), source.indexOf("async function readJsonResponseLimited("));
const localeCatalog = JSON.parse(readFileSync(new URL("../../public/l10n/rive.json", import.meta.url), "utf8")) as Record<string, Record<string, string>>;
const locationCode = source.slice(source.indexOf("const LOCATION_COPY"), source.indexOf("function safeColor("));
const projectionCode = source.slice(source.indexOf("function project("), source.indexOf("function horizonY("));
const unprojectionCode = source.slice(source.indexOf("function screenToWorld("), source.indexOf("function zoomAt("));
const applyHereCode = source.slice(source.indexOf("function applyHere("), source.indexOf("let toolStatusTimer"));
const distanceCode = source.slice(source.indexOf("function haversineMeters("), source.indexOf("function stopHasService("));
const citySwitchCode = source.slice(source.indexOf("function switchCity("), source.indexOf("let resizeTick"));
const loadCityCode = source.slice(source.indexOf("let cityLoadRequest"), source.indexOf("function showLoadError("))
  .replaceAll("import.meta.url", '"https://rive.test/Transit/app.js"');

function setup() {
  const state = {
    here: null as Here | null,
    rider: { here: null as Here | null },
    watchId: null as number | null,
    geoStatus: "idle",
    geoError: null as Failure | null,
    selectingOrigin: false,
    camera: { lon: -73.5673, lat: 45.5017, zoom: 14, pitch: 0 },
    cityLocked: true,
    visitId: "quebec",
    userMoved: true,
    locale: "fr",
    sheetOpen: true,
    city: "montreal",
    atlas: { meta: { center: [-73.5673, 45.5017], zoom: 14 }, stops: [] },
  };
  const elements = new Map<string, { textContent: string; title: string; hidden: boolean; disabled: boolean; value: string; innerHTML: string; dataset: Record<string, string>; focus: () => void; setAttribute: (name: string, value: string) => void }>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { textContent: "", title: "", hidden: false, disabled: false, value: "", innerHTML: "", dataset: {}, focus() {}, setAttribute() {} });
    return elements.get(id)!;
  };
  const requests: Request[] = [];
  const watches: Request[] = [];
  const cleared: number[] = [];
  const timers = new Map<number, () => void>();
  const events = new Map<string, () => void>();
  const flights: Array<{ lon: number; lat: number }> = [];
  let timerId = 0;
  const noop = () => {};
  const context = vm.createContext({
    state, Date, applyPitch, invertPitch, innerWidth: 1024, innerHeight: 768,
    acceptRiderFix, emptyRiderStore, forgetInAppLocationGrant, cityAfterHereSample,
    window: { isSecureContext: true, addEventListener: (name: string, callback: () => void) => events.set(name, callback) },
    navigator: { geolocation: {
      getCurrentPosition: (success: Request["success"], error: Request["error"], options: PositionOptions) => requests.push({ success, error, options }),
      watchPosition: (success: Request["success"], error: Request["error"], options: PositionOptions) => { watches.push({ success, error, options }); return 42; },
      clearWatch: (id: number) => cleared.push(id),
    } },
    document: { getElementById: element },
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    formatMeters: (meters: number) => `${Math.round(meters)} m`,
    paintHereButton: noop, requestDraw: noop, toolStatus: noop, applyHeading: noop,
    cancelFlight: noop, minimizeSheet: noop, bumpSheet: noop,
    renderNearby: noop, renderLines: noop, renderBikes: noop, paintHeading: noop,
    paintMapHud: noop, scheduleBuildings: noop, scheduleWeather: noop, paintCityButtons: noop,
    broadcastPulse: noop, livePulseEnd: noop, paintNav: noop, applyVisit: noop,
    flyTo: (point: { lon: number; lat: number }) => flights.push(point),
    detectCity: (lon: number) => lon < -72 ? "montreal" : "quebec",
    loadCity: async (city: string) => { state.city = city; return true; },
    showLoadError: noop,
  });
  vm.runInContext(`let locationRequest = 0, locationDeadline = 0, userAskedLocation = false, locationHelpWasShown = false;\n${uiHelpers}\n${projectionCode}\n${unprojectionCode}\n${distanceCode}\n${applyHereCode}\n${citySwitchCode}\n${locationCode}`, context);
  return { state, element, requests, watches, cleared, timers, events, flights, context, run: (code: string) => vm.runInContext(code, context) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

function withCityLoader(app: ReturnType<typeof setup>, holdQuebecAuxiliary = false) {
  const documents = new Map<string, ReturnType<typeof deferred<unknown>>>();
  const auxiliary = deferred<void>();
  const auxiliaryStarted = deferred<void>();
  Object.assign(app.context, {
    URL, lineCache: new Map(), prepareAtlas: () => {}, hideLoadError: () => {},
    fetchJsonLimited: (url: URL) => {
      const result = deferred<unknown>();
      documents.set(url.pathname, result);
      return result.promise;
    },
    loadPois: () => {
      if (holdQuebecAuxiliary && app.state.city === "quebec") {
        auxiliaryStarted.resolve();
        return auxiliary.promise;
      }
      return Promise.resolve();
    },
    loadRealtime: () => Promise.resolve(), loadBikes: () => Promise.resolve(),
  });
  app.run(`let buildingKey = '';\n${loadCityCode}`);
  const complete = (city: string) => {
    const center = city === "quebec" ? [-71.2082, 46.8131] : [-73.5673, 45.5017];
    documents.get(`/Transit/data/${city}/atlas.json`)!.resolve({ meta: { center, city, zoom: 14, attribution: "fixture" }, stops: [] });
    documents.get(`/Transit/data/${city}/timetable.json`)!.resolve({});
  };
  return { complete, auxiliary, auxiliaryStarted };
}

const fix = (at = Date.now()): Fix => ({ coords: { longitude: -73.5673, latitude: 45.5017, accuracy: 36 }, timestamp: at });

test("atlas waits for a deliberate location action, gets a coarse fix before starting its watch", () => {
  const app = setup();
  app.run("paintGeoAsk()");
  assert.equal(app.requests.length, 0);
  assert.equal(app.element("geo-ask").textContent, "Me localiser");
  app.run("locate(); locate()");
  assert.equal(app.requests.length, 1, "repeat clicks do not create parallel requests");
  assert.equal(app.requests[0].options.enableHighAccuracy, false);
  assert.equal(app.watches.length, 0);
  app.requests[0].success(fix());
  assert.equal(app.state.here?.source, "gps");
  assert.equal(app.state.here?.accuracy, 36);
  assert.equal(app.state.cityLocked, false, "explicit localization can follow the real city");
  assert.equal(app.watches.length, 1);
  assert.equal(app.timers.size, 0);
  assert.match(app.element("geo-message").textContent, /36 m/);
  const boot = source.slice(source.indexOf("const boot = new URLSearchParams"));
  assert.doesNotMatch(boot, /\blocate\(/, "boot must not request permission by itself");
});

test("atlas does not retry a denial and explains site and host application permissions", () => {
  const app = setup();
  app.run("locate()");
  app.requests[0].error({ code: 1 });
  assert.equal(app.requests.length, 1);
  assert.equal(app.watches.length, 0);
  assert.equal(app.state.geoStatus, "error");
  assert.equal(app.state.here, null, "a denied location must never create a city-centre fix");
  assert.match(app.element("geo-title").textContent, /bloquée/);
  assert.match(app.element("geo-message").textContent, /application/);
  assert.equal(app.element("geo-help").hidden, false);
});

test("atlas distinguishes unavailable from timeout and performs only one precise retry", () => {
  for (const code of [2, 3]) {
    const app = setup();
    app.run("locate()");
    app.requests[0].error({ code });
    assert.equal(app.requests.length, 2);
    assert.equal(app.requests[1].options.enableHighAccuracy, true);
    app.requests[1].error({ code });
    assert.equal(app.requests.length, 2);
    assert.equal(app.state.geoStatus, "error");
    assert.match(app.element("geo-title").textContent, code === 2 ? /ne transmet pas/ : /trop de temps/);
    assert.doesNotMatch(app.element("geo-title").textContent, /refusée|bloquée/);
  }
});

test("atlas watchdog finishes even if the browser ignores both native timeout callbacks", () => {
  const app = setup();
  app.run("locate()");
  [...app.timers.values()][0]();
  assert.equal(app.requests.length, 2);
  [...app.timers.values()][0]();
  assert.equal(app.state.geoStatus, "error");
  assert.equal(app.timers.size, 0);
  app.requests[0].success(fix());
  app.requests[1].success(fix());
  assert.equal(app.state.here, null, "late fixes after expiry must not recenter the map");
});

test("atlas preserves a valid fix on watch failure and rejects queued watch callbacks", () => {
  const app = setup();
  app.run("locate()");
  app.requests[0].success(fix());
  const accepted = app.state.here;
  app.watches[0].error({ code: 2 });
  assert.equal(app.state.here, accepted);
  assert.deepEqual(app.cleared, [42]);
  assert.equal(app.state.watchId, null);
  assert.match(app.element("geo-message").textContent, /dernière position reçue reste affichée/);
  app.watches[0].success({ coords: { longitude: 0, latitude: 0, accuracy: 1 }, timestamp: Date.now() });
  assert.equal(app.state.here, accepted);
});

test("atlas cancellation ignores pending fixes and page departure clears a running watch", () => {
  const app = setup();
  app.run("locate(); cancelLocation()");
  app.requests[0].success(fix());
  assert.equal(app.state.here, null);
  assert.equal(app.watches.length, 0);
  assert.equal(app.timers.size, 0);
  app.run("locate()");
  app.requests[1].success(fix());
  app.events.get("pagehide")!();
  assert.deepEqual(app.cleared, [42]);
  assert.equal(app.state.watchId, null);
});

test("atlas manual departure is chosen explicitly and cannot be replaced by a late GPS response", () => {
  const app = setup();
  app.run("locate(); chooseMapOrigin()");
  assert.equal(app.state.selectingOrigin, true);
  assert.equal(app.state.here, null, "entering map selection does not confirm a departure");
  app.run("confirmMapOrigin()");
  const chosen = app.state.here as Here | null;
  assert.equal(chosen?.source, "manual");
  assert.ok(Math.abs(chosen!.lon - app.state.camera.lon) < 1e-10);
  assert.ok(Math.abs(chosen!.lat - app.state.camera.lat) < 1e-10);
  app.requests[0].success(fix());
  assert.equal(app.state.here, chosen);
  assert.equal(app.watches.length, 0);
  assert.match(app.element("geo-title").textContent, /Départ choisi/);
});

test("atlas confirms the visual reticle in pitched 3D instead of the displaced camera centre", () => {
  const app = setup();
  app.state.camera.pitch = 0.72;
  app.run("chooseMapOrigin(); confirmMapOrigin()");
  const chosen = app.state.here!;
  assert.ok(Math.abs(chosen.lat - app.state.camera.lat) > 0.001);
  const [x, y] = app.run("worldToScreen(state.here.lon, state.here.lat, state.camera, innerWidth, innerHeight)") as [number, number];
  assert.ok(Math.abs(x - 512) < 1e-6);
  assert.ok(Math.abs(y - 384) < 1e-6);
});

test("atlas rejects malformed and stale coordinates instead of reporting a fake success", () => {
  for (const bad of [
    { ...fix(), coords: { longitude: 190, latitude: 45, accuracy: 1 } },
    { ...fix(), coords: { longitude: Number.NaN, latitude: 45, accuracy: 1 } },
    fix(Date.now() - 180000),
  ]) {
    const app = setup();
    app.run("locate()");
    app.requests[0].success(bad);
    assert.equal(app.requests.length, 2);
    assert.equal(app.state.here, null);
    assert.equal(app.watches.length, 0);
  }
});

test("atlas city choice cancels a pending position request before it can unlock the chosen city", () => {
  const app = setup();
  app.run("locate(); switchCity('quebec')");
  app.requests[0].success(fix());
  assert.equal(app.state.city, "quebec");
  assert.equal(app.state.cityLocked, true);
  assert.equal(app.state.here, null);
  assert.equal(app.watches.length, 0);
});

test("atlas explicit localization can replace a manual departure with a valid cached GPS fix", () => {
  const app = setup();
  app.run("chooseMapOrigin(); confirmMapOrigin(); locate()");
  app.requests[0].success(fix(Date.now() - 30000));
  assert.equal(app.state.geoStatus, "ready");
  assert.equal(app.state.here?.source, "gps");
  assert.equal(app.state.rider.here?.source, "gps");
});

test("atlas denied request can be deliberately retried without accepting the old callback", () => {
  const app = setup();
  app.run("locate()");
  app.requests[0].error({ code: 1 });
  app.run("locate()");
  app.requests[0].success(fix());
  assert.equal(app.state.here, null);
  app.requests[1].success(fix());
  assert.equal(app.state.geoStatus, "ready");
  assert.equal(app.state.geoError, null);
  assert.equal(app.watches.length, 1);
});

test("atlas stops a live watch when choosing a city, and queued updates cannot replace its departure", () => {
  const app = setup();
  app.run("locate()");
  app.requests[0].success(fix());
  const accepted = app.state.here;
  app.run("switchCity('quebec')");
  assert.deepEqual(app.cleared, [42]);
  app.watches[0].success({ ...fix(), coords: { longitude: -73.6, latitude: 45.55, accuracy: 20 } });
  assert.equal(app.state.city, "quebec");
  assert.equal(app.state.here, accepted);
});

test("atlas passive GPS updates retain a user-panned camera and ignore older samples", () => {
  const app = setup();
  app.run("locate()");
  app.requests[0].success(fix(Date.now() - 1000));
  app.state.userMoved = true;
  const flights = app.flights.length;
  const current = { ...fix(), coords: { longitude: -73.6, latitude: 45.55, accuracy: 20 } };
  app.watches[0].success(current);
  assert.equal(app.state.here?.lon, -73.6);
  assert.equal(app.flights.length, flights);
  app.watches[0].success(fix(Date.now() - 2000));
  assert.equal(app.state.here?.lon, -73.6);
});

test("atlas cancelling map selection keeps the previous GPS departure and never restarts its watch", () => {
  const app = setup();
  app.run("locate()");
  app.requests[0].success(fix());
  const accepted = app.state.here;
  app.run("chooseMapOrigin()");
  const binding = source.slice(source.indexOf('document.getElementById("geo-map-cancel").onclick'), source.indexOf('const perms = document.getElementById("perms")'));
  app.run(binding + '\ndocument.getElementById("geo-map-cancel").onclick()');
  assert.equal(app.state.here, accepted);
  assert.equal(app.state.selectingOrigin, false);
  assert.deepEqual(app.cleared, [42]);
  assert.equal(app.watches.length, 1);
  assert.equal(app.state.watchId, null);
});

test("atlas ignores a previous city's JSON response after a newer city has loaded", async () => {
  const app = setup();
  const loader = withCityLoader(app);
  const older = app.run("loadCity('quebec')") as Promise<boolean>;
  const newer = app.run("loadCity('montreal')") as Promise<boolean>;
  loader.complete("montreal");
  assert.equal(await newer, true);
  loader.complete("quebec");
  assert.equal(await older, false);
  assert.equal(app.state.city, "montreal");
});

test("atlas does not run a previous city's completion action after its late auxiliary feeds finish", async () => {
  const app = setup();
  const loader = withCityLoader(app, true);
  const older = app.run("loadCity('quebec')") as Promise<boolean>;
  loader.complete("quebec");
  await loader.auxiliaryStarted.promise;
  const newer = app.run("loadCity('montreal')") as Promise<boolean>;
  loader.complete("montreal");
  await newer;
  loader.auxiliary.resolve();
  assert.equal(await older, false);
  assert.equal(app.state.city, "montreal");
});

test("atlas late city data cannot move the reticle during a manual departure choice", async () => {
  const app = setup();
  const loader = withCityLoader(app);
  const pending = app.run("loadCity('quebec')") as Promise<boolean>;
  app.run("chooseMapOrigin()");
  const camera = app.state.camera;
  loader.complete("quebec");
  await pending;
  assert.equal(app.state.camera, camera);
  assert.equal(app.state.selectingOrigin, true);
});

test("atlas location actions, errors and permission help follow the selected English or French locale", () => {
  const app = setup();
  app.state.locale = "en";
  app.run("paintGeoAsk()");
  assert.equal(app.element("geo-locate").textContent, "Locate me");
  assert.equal(app.element("geo-manual").textContent, "Choose on the map");
  app.run("locate()");
  app.requests[0].error({ code: 1 });
  assert.equal(app.element("geo-title").textContent, "Location access is blocked");
  assert.match(app.element("geo-help-content").innerHTML, /System Settings/);
  assert.doesNotMatch(app.element("geo-help-content").innerHTML, /Réglages/);
  app.state.locale = "fr";
  app.run("paintGeoAsk()");
  assert.equal(app.element("geo-title").textContent, "La localisation est bloquée");
  assert.equal(app.element("geo-locate").textContent, "Réessayer");
  assert.match(app.element("geo-help-content").innerHTML, /Réglages Système/);
});

test("atlas shows the floating location action only with the sheet folded and keeps cancellation reachable", () => {
  const app = setup();
  Object.assign(app.element("sheet"), { classList: { toggle() {} } });
  Object.assign(app.element("fold"), { querySelector() { return null; } });
  Object.assign(app.context, { setSheetTall() {} });
  const sheetCode = source.slice(source.indexOf("function setSheetOpen("), source.indexOf("function armSheetIdle("));
  app.run(`let sheetIdle = 0; ${sheetCode}\nsetSheetOpen(true)`);
  assert.equal(app.element("geo-ask").hidden, true);
  app.run("setSheetOpen(false)");
  assert.equal(app.element("geo-ask").hidden, false);
  app.run("locate()");
  assert.equal(app.element("geo-map-cancel").hidden, false);
  assert.equal(app.element("geo-map-cancel").textContent, "Annuler la recherche");
  app.run("setSheetOpen(true)");
  assert.equal(app.element("geo-ask").hidden, true);
  assert.equal(app.element("geo-map-cancel").hidden, true);
  assert.equal(app.element("geo-cancel").hidden, false);
});

test("atlas button pointerdown and focus do not expand the sheet before a click can complete", () => {
  const handlers = new Map<string, (event: { target: { matches: () => boolean } }) => void>();
  let expansions = 0;
  let idleRefreshes = 0;
  const context = vm.createContext({
    document: { getElementById: () => ({ addEventListener: (name: string, handler: (event: { target: { matches: () => boolean } }) => void) => handlers.set(name, handler) }) },
    bumpSheet: () => expansions++, armSheetIdle: () => idleRefreshes++,
  });
  const bindings = source.slice(source.indexOf('const sheetBody = document.getElementById("sheet-body")'), source.indexOf('document.getElementById("dest").addEventListener("focus"'));
  vm.runInContext(bindings, context);
  handlers.get("pointerdown")!({ target: { matches: () => false } });
  handlers.get("focusin")!({ target: { matches: () => false } });
  assert.equal(expansions, 0);
  assert.equal(idleRefreshes, 2);
  handlers.get("focusin")!({ target: { matches: () => true } });
  assert.equal(expansions, 1, "text input focus can still expand the sheet");
});

test("atlas auto-fold respects keyboard focus on any control, including buttons and permission help", () => {
  const active = { tagName: "BUTTON" };
  let inside = true;
  const context = vm.createContext({ document: { activeElement: active, getElementById: () => ({ contains: () => inside }) } });
  const focusCode = source.slice(source.indexOf("function sheetHasFocus("), source.indexOf("function setSheetTall("));
  vm.runInContext(focusCode, context);
  assert.equal(vm.runInContext("sheetHasFocus()", context), true);
  active.tagName = "SUMMARY";
  assert.equal(vm.runInContext("sheetHasFocus()", context), true);
  inside = false;
  assert.equal(vm.runInContext("sheetHasFocus()", context), false);
});

test("atlas background replanning preserves the camera and destination search while explicit planning still fits", () => {
  for (const haveTrip of [true, false]) {
    const app = setup();
    let fitted = 0;
    const itineraries = haveTrip ? [{ minutes: 4, gap: 0, mix: "walk", legs: [] }] : [];
    Object.assign(app.element("trips"), { querySelectorAll: () => [] });
    Object.assign(app.context, {
      riderPoint: () => app.state.camera, clockMinutes: () => 720, activeServiceIndexes: () => [],
      planFromHere: () => itineraries, fitTrip: () => fitted++, tripMix: () => "walk",
      originDescription: () => "départ choisi", escapeHtml: (value: string) => value, formatClock: () => "12:00",
    });
    const renderCode = source.slice(source.indexOf("function renderTrips("), source.indexOf("function currentTrip("));
    const planCode = source.slice(source.indexOf("function openPlan("), source.indexOf("function openStop("));
    app.run(renderCode + planCode);
    app.element("dest-hits").innerHTML = "new destination suggestions";
    app.run("state.tripIndex = 0; openPlan({ name: 'Target', lon: -73.5, lat: 45.5 }, true)");
    assert.equal(fitted, 0);
    assert.equal(app.flights.length, 0);
    assert.equal(app.element("dest-hits").innerHTML, "new destination suggestions");
    app.run("openPlan({ name: 'Target', lon: -73.5, lat: 45.5 }, false)");
    assert.equal(fitted + app.flights.length, 1);
    assert.equal(app.element("dest-hits").innerHTML, "");
  }
});

test("atlas search keyboard navigation reaches results and Escape dismisses without erasing the query", () => {
  type KeyEvent = { key: string; preventDefault: () => void };
  const inputHandlers = new Map<string, (event: KeyEvent) => void>();
  const resultHandlers = new Map<string, (event: KeyEvent) => void>();
  let active: unknown;
  const input = { value: "McGill", focus() { active = input; }, addEventListener: (name: string, handler: (event: KeyEvent) => void) => inputHandlers.set(name, handler) };
  const buttons = [0, 1, 2].map((index) => ({ focus() { active = buttons[index]; } }));
  const results = { innerHTML: "suggestions", querySelector: () => buttons[0], querySelectorAll: () => buttons, addEventListener: (name: string, handler: (event: KeyEvent) => void) => resultHandlers.set(name, handler) };
  const cancelled: number[] = [];
  let rendered = 0;
  const context = vm.createContext({
    document: { get activeElement() { return active; }, getElementById: (id: string) => id === "query" ? input : results },
    clearTimeout: (id: number) => cancelled.push(id), render: () => { rendered++; results.innerHTML = "suggestions"; },
  });
  const code = source.slice(source.indexOf("function bindSearchKeys("), source.indexOf('bindSearchKeys("q",'));
  vm.runInContext(`let searchTick = 42; ${code}\nbindSearchKeys('query', 'results', render)`, context);
  inputHandlers.get("keydown")!({ key: "ArrowDown", preventDefault() {} });
  assert.equal(active, buttons[0]);
  assert.equal(rendered, 1);
  resultHandlers.get("keydown")!({ key: "ArrowDown", preventDefault() {} });
  assert.equal(active, buttons[1]);
  resultHandlers.get("keydown")!({ key: "ArrowUp", preventDefault() {} });
  resultHandlers.get("keydown")!({ key: "ArrowUp", preventDefault() {} });
  assert.equal(active, input);
  resultHandlers.get("keydown")!({ key: "Escape", preventDefault() {} });
  assert.equal(results.innerHTML, "");
  assert.equal(input.value, "McGill");
  assert.equal(active, input);
  assert.deepEqual(cancelled, [42]);
  assert.equal(vm.runInContext("searchTick", context), 0);
  inputHandlers.get("keydown")!({ key: "ArrowUp", preventDefault() {} });
  assert.equal(active, buttons[2]);
  assert.equal(results.innerHTML, "suggestions");
  assert.equal(rendered, 2);
});

test("atlas empty destination and stop searches give localized feedback instead of a blank list", () => {
  const app = setup();
  Object.assign(app.element("hits"), { querySelectorAll: () => [] });
  Object.assign(app.element("dest-hits"), { querySelectorAll: () => [] });
  Object.assign(app.context, { searchPlaces: () => [] });
  const code = source.slice(source.indexOf("function renderHits("), source.indexOf("function searchHitHtml("));
  app.run(code + "state.query = 'zzzz'; state.destQuery = 'zzzz'; renderHits(); renderDestHits()");
  assert.match(app.element("hits").innerHTML, /Aucun résultat/);
  assert.match(app.element("dest-hits").innerHTML, /role="status"/);
  app.state.locale = "en";
  app.run("renderHits(); renderDestHits()");
  assert.match(app.element("hits").innerHTML, /No results/);
  app.run("state.query = ''; renderHits()");
  assert.equal(app.element("hits").innerHTML, "");
});

test("atlas regional locales inherit missing static labels from their base language", () => {
  const app = setup();
  Object.assign(app.context, { tables: localeCatalog });
  assert.equal(app.run("chooseAtlasLocale(['en_GB', 'fr-CA'], Object.keys(tables))"), "en-GB");
  assert.equal(app.run("chooseAtlasLocale(['fr-CA', 'en'], Object.keys(tables))"), "fr-CA");
  assert.equal(app.run("atlasLocaleTable(tables, 'en-GB').chooseLine"), "Choose a route");
  assert.equal(app.run("atlasLocaleTable(tables, 'fr-CA').chooseLine"), "Choisir une ligne");
  assert.equal(app.run("atlasLocaleTable(tables, 'fr-CA').dayShort"), "Jour");
  assert.equal(app.run("atlasLocaleTable(tables, 'en-GB').dayShort"), "Day");
});

test("atlas translates every declared static label, tooltip and accessible name from the locale table", () => {
  const html = readFileSync(new URL("../../public/Transit/index.html", import.meta.url), "utf8");
  const groups = new Map<string, Array<{ dataset: Record<string, string>; textContent: string; attributes: Record<string, string>; getAttribute: (name: string) => string; setAttribute: (name: string, value: string) => void }>>();
  for (const marker of ["data-i18n", "data-i18n-aria", "data-i18n-title"]) {
    const elements = [...html.matchAll(new RegExp(`${marker}="([^"]+)"`, "g"))].map((match) => {
      const attributes: Record<string, string> = { [marker]: match[1] };
      return { dataset: { i18n: match[1] }, textContent: "", attributes, getAttribute: (name: string) => attributes[name], setAttribute: (name: string, value: string) => { attributes[name] = value; } };
    });
    assert.ok(elements.length > 0);
    groups.set(`[${marker}]`, elements);
  }
  const context = vm.createContext({ state: { locale: "en" }, tables: localeCatalog, document: { querySelectorAll: (selector: string) => groups.get(selector) || [] } });
  vm.runInContext(uiHelpers + "paintAtlasLabels(atlasLocaleTable(tables, 'en-GB'))", context);
  for (const [selector, elements] of groups) {
    for (const element of elements) {
      const key = element.dataset.i18n;
      const attribute = selector === "[data-i18n]" ? "textContent" : selector === "[data-i18n-aria]" ? "aria-label" : "title";
      const translated = attribute === "textContent" ? element.textContent : element.attributes[attribute];
      assert.equal(translated, localeCatalog.en[key], `${key} must be translated`);
    }
  }
});

test("atlas generated stop, route-count and place metadata use English with an English UI", () => {
  const app = setup();
  app.state.locale = "en";
  Object.assign(app.context, { escapeHtml });
  const code = source.slice(source.indexOf("function searchHitHtml("), source.indexOf("function selectSearchHit("));
  app.run(code);
  const stop = app.run("searchHitHtml({kind: 'stop', stop: {id: 'fixture', name: 'Fixture stop', kind: 0, routes: ['a', 'b'], code: '123'}}, 0)") as string;
  assert.match(stop, /stop · 123 · 2 routes/);
  assert.doesNotMatch(stop, /arrêt|lignes/);
  const poi = app.run("searchHitHtml({kind: 'poi', poi: {name: 'Fixture place'}}, 0)") as string;
  assert.match(poi, />place</);
  assert.doesNotMatch(poi, />lieu</);
});

test("atlas rendered trip cards show the fastest option and the actual gap in the selected language", () => {
  const app = setup();
  Object.assign(app.element("trips"), { querySelectorAll: () => [] });
  Object.assign(app.context, { escapeHtml, originDescription: () => "origin", tripMix: () => "walk" });
  const renderer = source.slice(source.indexOf("function renderTrips("), source.indexOf("function currentTrip("));
  app.run(renderer + "state.trips = [{minutes: 5, gap: 0, legs: []}, {minutes: 8, gap: 3, legs: []}]; state.tripIndex = 0; renderTrips()");
  assert.match(app.element("trips").innerHTML, /<div class="gap">Le plus vite<\/div>/);
  assert.match(app.element("trips").innerHTML, /<div class="gap">\+3 min de plus<\/div>/);
  app.state.locale = "en";
  app.run("renderTrips()");
  assert.match(app.element("trips").innerHTML, /<div class="gap">Fastest<\/div>/);
  assert.match(app.element("trips").innerHTML, /<div class="gap">\+3 min longer<\/div>/);
  assert.doesNotMatch(app.element("trips").innerHTML, /Le plus vite|min de plus/);
});
