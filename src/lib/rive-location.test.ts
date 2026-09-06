import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { describe, it } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as assist from "./assist";
import * as i18n from "./i18n";
import * as search from "./search";
import * as searchSubmit from "./search-submit";
import * as time from "./time";
import * as location from "./location";
import { readJsonResponse } from "./client-http";
import type { AtlasRoute, AtlasStop } from "./atlas/types";

type Props = Record<string, unknown>;
type VNode = { type: unknown; props: Props };
type Effect = () => void | (() => void);
type DomElement = { node: VNode; focus: () => void; blur: () => void; querySelectorAll: (selector: string) => DomElement[] };
const FIX = { lon: -73.58, lat: 45.49, accuracy: 35, timestamp: 1_788_660_000_000 };
const DESTINATION = { id: "test-destination", name: "Destination test", lon: -73.55, lat: 45.51, popularity: 50, aliases: ["commun"] };
const ALTERNATIVE = { ...DESTINATION, id: "test-alternative", name: "Parc témoin" };
const LOCAL_ROUTE: AtlasRoute = { id: "local-test", shortName: "24", longName: "Ligne locale témoin", type: 3, color: "#123456", textColor: "#ffffff", agencyId: "test", agencyName: "Test", dirs: [] };
const STOP: AtlasStop = { id: "stop-test", name: "Arrêt témoin", lon: -73.56, lat: 45.5, kind: 0, wheel: 0, routes: [LOCAL_ROUTE.id] };
const STALE_TRIP = { id: "stale-trip", minutes: 99, transfers: 0, legs: [] };
const code = ts.transpileModule(readFileSync(new URL("../components/rive-app.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const copy = (value: unknown) => JSON.parse(JSON.stringify(value));
function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" ? text((node as VNode).props?.children) : "";
}

/** Real app handlers/helpers, with deterministic rendering and network boundaries. */
function harness(initialWidth = 1200, routes: AtlasRoute[] = [], stops: AtlasStop[] = []) {
  let cursor = 0, dirty = false;
  let deferredQuery: string | null = null;
  const slots = new Map<number, unknown>(), dependencies = new Map<number, unknown[]>();
  const cleanups = new Map<number, void | (() => void)>();
  let effects: (() => void)[] = [];
  const calls: { success: PositionCallback; error?: PositionErrorCallback | null }[] = [];
  const signals: AbortSignal[] = [];
  const plans: { payload: Props; resolve: (response: Response) => void }[] = [];
  const departures: { signal?: AbortSignal | null; resolve: (response: Response) => void }[] = [];
  const domCache = new Map<string, DomElement>();
  const domRefs = new Set<{ current: unknown }>();
  const animationFrames: (() => void)[] = [];
  const browserDocument: { activeElement: DomElement | null } = { activeElement: null };
  const geolocation = { getCurrentPosition(success: PositionCallback, error?: PositionErrorCallback | null) { calls.push({ success, error }); } };
  const mediaListeners = new Set<() => void>();
  const desktopMedia = {
    get matches() { return browserWindow.innerWidth >= 641; },
    addEventListener(event: string, callback: () => void) { assert.equal(event, "change"); mediaListeners.add(callback); },
    removeEventListener(event: string, callback: () => void) { assert.equal(event, "change"); mediaListeners.delete(callback); },
  };
  const browserWindow = { innerWidth: initialWidth, isSecureContext: true,
    matchMedia(query: string) { assert.equal(query, "(min-width: 641px)"); return desktopMedia; },
  };
  const react = {
    useState<T>(initial: T) {
      const index = cursor++;
      if (!slots.has(index)) slots.set(index, initial);
      return [slots.get(index), (value: T) => { if (!Object.is(slots.get(index), value)) { slots.set(index, value); dirty = true; } }];
    },
    useRef<T>(initial: T) { const index = cursor++; if (!slots.has(index)) slots.set(index, { current: initial }); return slots.get(index); },
    useEffect(effect: Effect, deps: unknown[]) {
      const index = cursor++, old = dependencies.get(index);
      if (old && old.length === deps.length && deps.every((value, i) => Object.is(value, old[i]))) return;
      dependencies.set(index, deps);
      effects.push(() => { cleanups.get(index)?.(); cleanups.set(index, effect()); });
    },
    useMemo<T>(factory: () => T, deps: unknown[]) {
      const index = cursor++, old = dependencies.get(index);
      if (!old || old.length !== deps.length || !deps.every((value, i) => Object.is(value, old[i]))) {
        slots.set(index, factory()); dependencies.set(index, deps);
      }
      return slots.get(index);
    },
    useDeferredValue<T>(value: T) { return deferredQuery ?? value; },
  };
  function dom(node: VNode): DomElement {
    const key = `${String(node.type)}:${node.props.id ?? node.props["aria-label"] ?? node.props["aria-controls"] ?? text(node)}`;
    let element = domCache.get(key);
    if (!element) {
      element = { node, focus() {
        if (browserDocument.activeElement === element) return;
        browserDocument.activeElement = element!;
        (element!.node.props.onFocus as (() => void) | undefined)?.();
      }, blur() { if (browserDocument.activeElement === element) browserDocument.activeElement = null; },
      querySelectorAll(selector: string) { assert.equal(selector, "button"); return nodes(element!.node).filter((entry) => entry.type === "button").map(dom); } };
      domCache.set(key, element);
    }
    element.node = node;
    return element;
  }
  const jsx = (type: unknown, props: Props): VNode => {
    const node = { type, props };
    if (props.ref) { const ref = props.ref as { current: unknown }; ref.current = dom(node); domRefs.add(ref); }
    return node;
  };
  const fetchJson = async (url: string) => {
    if (url === "/data/index.json") return { cities: [] };
    if (url.endsWith("pois.json")) return { places: [DESTINATION, ALTERNATIVE] };
    const city = url.split("/")[2];
    return { meta: { city, center: [-71.2, 46.8], zoom: 12 }, routes, stops };
  };
  const modules: Record<string, unknown> = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" }, "next/dynamic": () => "MapView",
    "motion/react": { AnimatePresence: "animate-presence", motion: { section: "section" }, useReducedMotion: () => true },
    "@phosphor-icons/react": Object.fromEntries("ArrowRight ArrowsDownUp CaretDown MapTrifold Clock Bus Crosshair MagnifyingGlass MapPin PersonSimpleWalk Subway X".split(" ").map((name) => [name, `icon-${name}`])),
    "@/lib/assist": assist, "@/lib/i18n": i18n, "@/lib/search": search,
    "@/lib/search-submit": searchSubmit, "@/lib/time": time, "@/lib/client-http": { fetchJson, readJsonResponse },
    "@/lib/location": { ...location, requestLocation(provider: Geolocation, options: { signal: AbortSignal; onRetry: () => void }) {
      signals.push(options.signal); return location.requestLocation(provider, options);
    } },
  };
  const exports: { RiveApp?: () => VNode } = {};
  vm.runInNewContext(code, { exports, Error, DOMException, AbortController,
    require: (id: string) => { assert.ok(id in modules, `Unexpected import: ${id}`); return modules[id]; },
    navigator: { geolocation }, window: browserWindow,
    document: browserDocument, requestAnimationFrame: (callback: () => void) => animationFrames.push(callback),
    fetch: (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/departures?")) return new Promise<Response>((resolve) => departures.push({ signal: init?.signal, resolve }));
      assert.equal(url, "/api/plan", "Unexpected network endpoint");
      return new Promise<Response>((resolve) => plans.push({ payload: JSON.parse(String(init?.body)), resolve }));
    },
  });
  let tree: VNode;
  function render() {
    let renders = 0;
    do {
      assert.ok(++renders < 10, "Component entered an update loop");
      cursor = 0; dirty = false; effects = [];
      domRefs.forEach((ref) => { ref.current = null; }); domRefs.clear();
      tree = exports.RiveApp!();
      const mounted = nodes(tree);
      mounted.filter((node) => node.type === "button" || node.type === "input").forEach(dom);
      if (browserDocument.activeElement && !mounted.includes(browserDocument.activeElement.node)) browserDocument.activeElement = null;
      effects.forEach((effect) => effect());
      animationFrames.splice(0).forEach((callback) => callback());
    } while (dirty);
  }
  function nodes(node: unknown): VNode[] {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== "object" || !("props" in node)) return [];
    const element = node as VNode;
    return [element, ...nodes(element.props.children)];
  }
  function find(predicate: (node: VNode) => boolean) { const node = nodes(tree).find(predicate); assert.ok(node, "Rendered control not found"); return node; }
  async function settle() { for (let turn = 0; turn < 4; turn += 1) { await setImmediate(); render(); } }
  async function act(action: () => void) { action(); render(); await settle(); }
  function button(label: string) { return find((node) => node.type === "button" && (text(node) === label || node.props["aria-label"] === label)); }
  function input(placeholder: string) { return find((node) => node.type === "input" && node.props.placeholder === placeholder); }
  async function click(label: string) {
    const node = button(label); assert.ok(!node.props.disabled, `${label} must be enabled`);
    await act(() => (node.props.onClick as () => void)());
  }
  async function skipToSearch() {
    let prevented = false;
    await act(() => (find((node) => node.type === "a" && node.props.className === "skip-link").props.onClick as (event: unknown) => void)({ preventDefault() { prevented = true; } }));
    return prevented;
  }
  async function type(placeholder: string, value: string) { await act(() => {
    const field = input(placeholder); dom(field).focus();
    (field.props.onChange as (event: unknown) => void)({ target: { value } });
  }); }
  async function key(target: "results" | "from" | "to", pressed: string) {
    const node = target === "results" ? find((node) => node.type === "ul" && node.props["aria-label"] === "Résultats de recherche")
      : input(target === "from" ? "Point de départ" : "Destination, arrêt ou ligne");
    await act(() => {
      const event = { key: pressed, currentTarget: dom(node), preventDefault() {} };
      (node.props.onKeyDown as ((event: unknown) => void) | undefined)?.(event);
      if (pressed === "Escape") (find((node) => node.type === "form").props.onKeyDown as (event: unknown) => void)(event);
    });
  }
  function succeed(index = calls.length - 1) {
    calls[index].success({ timestamp: FIX.timestamp, coords: { longitude: FIX.lon, latitude: FIX.lat, accuracy: FIX.accuracy } } as GeolocationPosition);
  }
  function fail(code: number, index = calls.length - 1) { calls[index].error?.({ code, message: "test browser failure" } as GeolocationPositionError); }
  render();
  return { calls, signals, plans, departures, settle, act, click, skipToSearch, type, key, succeed, fail, input,
    get map() { return find((node) => node.type === "MapView").props; }, get content() { return text(tree); },
    get results() { return nodes(tree).filter((node) => node.type === "ul" && node.props["aria-label"] === "Résultats de recherche").map(text); },
    get resultNames() { return nodes(tree).filter((node) => node.type === "ul" && node.props["aria-label"] === "Résultats de recherche").flatMap((list) => nodes(list).filter((node) => node.type === "button").map(text)); },
    get focused() { const node = browserDocument.activeElement?.node; return node ? node.props.id ?? text(node) : null; },
    get labels() { return nodes(tree).filter((node) => node.type === "label").map((node) => ({ for: node.props.htmlFor, text: text(node), buttons: nodes(node).filter((node) => node.type === "button").length })); },
    get panelHidden() { return find((node) => node.props.id === "journey-content").props.hidden; },
    get panelExpanded() { return find((node) => node.props["aria-controls"] === "journey-content").props["aria-expanded"]; },
    get mediaListenerCount() { return mediaListeners.size; },
    resize(width: number) {
      const wasDesktop = desktopMedia.matches; browserWindow.innerWidth = width;
      if (desktopMedia.matches !== wasDesktop) mediaListeners.forEach((listener) => listener());
      render();
    },
    defer(value: string | null) { deferredQuery = value; render(); },
    dispose() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

describe("RiveApp location interactions", () => {
  it("retains keyboard focus after collapsing to a mobile route map and makes the skip link reopen the destination", async (t) => {
    const app = harness(390, [LOCAL_ROUTE]); t.after(() => app.dispose()); await app.settle();
    await app.click(LOCAL_ROUTE.longName);
    assert.equal(app.panelHidden, true);
    assert.equal(app.focused, `Ligne ${LOCAL_ROUTE.shortName} · Voir les détails`);
    assert.equal(await app.skipToSearch(), true, "The skip link must expand the panel before focusing its target");
    assert.equal(app.panelHidden, false); assert.equal(app.focused, "journey-destination");
  });

  it("keeps persistent input labels separate from clear buttons and returns focus to the cleared field", async (t) => {
    const app = harness(); t.after(() => app.dispose()); await app.settle();
    assert.deepEqual(app.labels, [
      { for: "journey-origin", text: "Départ", buttons: 0 },
      { for: "journey-destination", text: "Destination", buttons: 0 },
    ]);
    await app.type("Point de départ", "Mon départ"); await app.type("Destination, arrêt ou ligne", DESTINATION.name);
    await app.click("Effacer le départ");
    assert.equal(app.input("Point de départ").props.value, "");
    assert.equal(app.input("Destination, arrêt ou ligne").props.value, DESTINATION.name);
    assert.equal(app.focused, "journey-origin");
    await app.click("Effacer la destination");
    assert.equal(app.input("Destination, arrêt ou ligne").props.value, "");
    assert.equal(app.focused, "journey-destination"); assert.deepEqual(app.results, []);
  });

  it("navigates results with arrows, Home/End and Escape, including reopening a dismissed list", async (t) => {
    const app = harness(); t.after(() => app.dispose()); await app.settle();
    await app.type("Destination, arrêt ou ligne", "commun");
    const [first, last] = app.resultNames;
    assert.equal(app.resultNames.length, 2);
    await app.key("to", "ArrowDown"); assert.equal(app.focused, first);
    await app.key("results", "ArrowDown"); assert.equal(app.focused, last);
    await app.key("results", "Home"); assert.equal(app.focused, first);
    await app.key("results", "End"); assert.equal(app.focused, last);
    await app.key("results", "ArrowUp"); assert.equal(app.focused, first);
    await app.key("results", "ArrowUp"); assert.equal(app.focused, "journey-destination");
    await app.key("to", "ArrowUp"); assert.equal(app.focused, last);
    await app.key("results", "Escape");
    assert.equal(app.focused, "journey-destination"); assert.deepEqual(app.results, []);
    await app.key("to", "ArrowDown"); assert.equal(app.focused, first); assert.equal(app.resultNames.length, 2);
    await app.key("results", "Escape"); await app.key("to", "ArrowUp"); assert.equal(app.focused, last);
    await app.type("Point de départ", "commun"); await app.key("from", "ArrowDown"); await app.key("results", "Escape");
    assert.equal(app.focused, "journey-origin"); assert.deepEqual(app.results, []);
  });

  for (const selection of ["stop", "route"] as const) {
    for (const phase of ["pending", "displayed"] as const) {
      it(`opening a ${selection} discards the ${phase} trip instead of preserving or resurrecting its map overlay`, async (t) => {
        const app = harness(1200, [LOCAL_ROUTE]); t.after(() => app.dispose()); await app.settle();
        await app.click("Me localiser"); await app.act(() => app.succeed());
        await app.type("Destination, arrêt ou ligne", DESTINATION.name); await app.click(`${DESTINATION.name}Lieu`);
        assert.equal(app.plans.length, 1);
        const completePlan = () => app.plans[0].resolve(new Response(JSON.stringify({ itineraries: [STALE_TRIP] })));
        if (phase === "displayed") { completePlan(); await app.settle(); assert.equal((app.map.itinerary as Props).id, STALE_TRIP.id); }
        await app.act(() => {
          if (selection === "stop") (app.map.onStop as (stop: AtlasStop) => void)(STOP);
          else (app.map.onRoute as (id: string) => void)(LOCAL_ROUTE.id);
        });
        if (phase === "pending") { completePlan(); await app.settle(); }
        assert.equal(app.map.itinerary, null); assert.doesNotMatch(app.content, /99 min/);
        if (selection === "stop") assert.equal((app.map.selectedStop as Props).id, STOP.id);
        else { assert.equal(app.map.selectedRouteId, LOCAL_ROUTE.id); assert.equal(app.map.selectedStop, null); }
      });
    }
  }

  it("offers ordinary routes when no metro/800-series exists and opens their map view on phones", async (t) => {
    const app = harness(390, [LOCAL_ROUTE]); t.after(() => app.dispose()); await app.settle();
    await app.click(LOCAL_ROUTE.longName);
    assert.equal(app.map.selectedRouteId, LOCAL_ROUTE.id); assert.equal(app.panelHidden, true);
    await app.click(`Ligne ${LOCAL_ROUTE.shortName} · Voir les détails`);
    assert.equal(app.panelHidden, false);
  });

  it("distinguishes identically named stops by public code without exposing internal identifiers", async (t) => {
    const stops = [
      { ...STOP, id: "internal-test-a", name: "D’Youville", agencyId: "RTC", code: "1111" },
      { ...STOP, id: "internal-test-b", name: "D’Youville", agencyId: "RTC", code: "2222" },
    ];
    const app = harness(1200, [LOCAL_ROUTE], stops); t.after(() => app.dispose()); await app.settle();
    await app.type("Destination, arrêt ou ligne", "Youville");
    assert.equal(app.resultNames.length, 2); assert.equal(new Set(app.resultNames).size, 2);
    assert.ok(app.resultNames.some((name) => name.includes("RTC · Arrêt 1111")));
    assert.ok(app.resultNames.some((name) => name.includes("RTC · Arrêt 2222")));
    assert.doesNotMatch(app.content, /internal-test-[ab]/);
    await app.click("D’YouvilleRTC · Arrêt 2222");
    assert.equal((app.map.selectedStop as Props).code, "2222");
    assert.match(app.content, /RTC · Arrêt 2222/);
  });

  it("reopens a collapsed phone sheet on the desktop breakpoint and removes its listener on unmount", async (t) => {
    const app = harness(390); t.after(() => app.dispose()); await app.settle();
    assert.equal(app.mediaListenerCount, 1);
    await app.click("Voir la carte");
    assert.equal(app.panelHidden, true); assert.equal(app.panelExpanded, false);
    app.resize(640);
    assert.equal(app.panelHidden, true, "The phone sheet must stay collapsed below the breakpoint");
    app.resize(641);
    assert.equal(app.panelHidden, false, "The desktop panel must clear the HTML hidden attribute");
    assert.equal(app.panelExpanded, true);
    app.resize(390); await app.click("Voir la carte"); app.resize(1024);
    assert.equal(app.panelHidden, false, "Repeated responsive transitions must keep working");
    app.dispose(); assert.equal(app.mediaListenerCount, 0);
  });

  it("hides selectable stale results while deferred search catches up to a new query or field", async (t) => {
    const app = harness(); t.after(() => app.dispose()); await app.settle();
    await app.type("Destination, arrêt ou ligne", DESTINATION.name);
    assert.deepEqual(app.results, [`${DESTINATION.name}Lieu`]);
    app.defer(DESTINATION.name);
    await app.type("Destination, arrêt ou ligne", ALTERNATIVE.name);
    assert.deepEqual(app.results, [], "Old destination results must not remain selectable under the new query");
    app.defer(null);
    assert.deepEqual(app.results, [`${ALTERNATIVE.name}Lieu`]);
    app.defer(ALTERNATIVE.name);
    await app.type("Point de départ", DESTINATION.name);
    assert.deepEqual(app.results, [], "Old destination results must not become departure choices while the field changes");
    app.defer(null);
    assert.deepEqual(app.results, [`${DESTINATION.name}Lieu`]);
  });

  for (const reason of ["denied", "unavailable"] as const) {
    it(`offers actionable recovery after ${reason}`, async (t) => {
      const app = harness(); t.after(() => app.dispose()); await app.settle();
      await app.click("Me localiser");
      await app.act(() => app.fail(reason === "denied" ? 1 : 2));
      if (reason === "unavailable") {
        assert.equal(app.calls.length, 2); assert.match(app.content, /essaie une dernière fois/);
        await app.act(() => app.fail(2));
      } else assert.equal(app.calls.length, 1);
      assert.match(app.content, reason === "denied" ? /position est bloqué/ : /ne reçoit aucune position/);
      assert.match(app.content, /réessayer.*Me localiser.*choisir ton départ sur la carte/);
      assert.match(app.content, /J’ai déjà autorisé/);
      assert.equal(app.input("Point de départ").props.value, ""); assert.equal(app.map.position, null);
      await app.click("Choisir sur la carte"); assert.equal(app.map.pickingLocation, true);
    });
  }

  it("uses the actual fix as departure, selects its city, and passes measured map props", async (t) => {
    const app = harness(); t.after(() => app.dispose()); await app.settle();
    await app.click("Me localiser"); await app.act(() => app.succeed());
    assert.equal(app.map.city, "montreal"); assert.deepEqual(copy(app.map.position), FIX); assert.deepEqual(copy(app.map.focus), FIX);
    assert.equal(app.input("Point de départ").props.value, i18n.t("myPosition", "fr"));
    assert.match(app.content, /35 m.*Réseau de Montréal sélectionné/);
    await app.type("Destination, arrêt ou ligne", DESTINATION.name); await app.click(`${DESTINATION.name}Lieu`);
    assert.equal(app.plans.length, 1);
    assert.deepEqual(app.plans[0].payload.from, { label: i18n.t("myPosition", "fr"), lon: FIX.lon, lat: FIX.lat });
    assert.equal(app.plans[0].payload.city, "montreal");
  });

  it("a city switch aborts an in-flight fix and cannot be overwritten by its late callback", async (t) => {
    const app = harness(); t.after(() => app.dispose()); await app.settle();
    await app.click("Me localiser"); await app.click("Sherbrooke");
    assert.equal(app.signals[0].aborted, true);
    await app.act(() => app.succeed(0));
    assert.equal(app.map.city, "sherbrooke"); assert.equal(app.map.position, null); assert.equal(app.map.focus, null);
    assert.equal(app.input("Point de départ").props.value, ""); assert.doesNotMatch(app.content, /Position reçue/);
  });

  for (const action of ["cancel", "type departure"] as const) {
    it(`${action} prevents a late location callback from replacing the departure`, async (t) => {
      const app = harness(); t.after(() => app.dispose()); await app.settle();
      await app.click("Me localiser");
      if (action === "cancel") await app.click("Annuler"); else await app.type("Point de départ", "Mon choix");
      assert.equal(app.signals[0].aborted, true);
      await app.act(() => app.succeed(0));
      assert.equal(app.map.position, null);
      assert.equal(app.input("Point de départ").props.value, action === "cancel" ? "" : "Mon choix");
      assert.doesNotMatch(app.content, /Position reçue/);
    });
  }

  it("entering manual mode invalidates a late trip, then commits only the chosen map point", async (t) => {
    const app = harness(); t.after(() => app.dispose()); await app.settle();
    await app.click("Me localiser"); await app.act(() => app.succeed());
    await app.type("Destination, arrêt ou ligne", DESTINATION.name); await app.click(`${DESTINATION.name}Lieu`);
    assert.equal(app.plans.length, 1);
    await app.click("Choisir sur la carte"); assert.equal(app.map.pickingLocation, true);
    app.plans[0].resolve(new Response(JSON.stringify({ itineraries: [{ id: "stale-trip", minutes: 99, transfers: 0, legs: [] }] })));
    await app.settle(); assert.equal(app.map.itinerary, null); assert.doesNotMatch(app.content, /99 min/);
    const manual = { lon: -73.62, lat: 45.52 };
    await app.act(() => (app.map.onPickLocation as (point: typeof manual) => void)(manual));
    assert.equal(app.map.pickingLocation, false);
    assert.deepEqual(copy(app.map.manualDeparture), { ...manual, label: "Départ choisi sur la carte" });
    assert.deepEqual(copy(app.map.position), FIX, "Manual departure must not masquerade as a GPS fix");
    assert.equal(app.input("Point de départ").props.value, "Départ choisi sur la carte");
  });
});
