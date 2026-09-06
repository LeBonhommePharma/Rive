import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as geo from "./geo";
import * as location from "./location";
import * as legs from "./map-legs";

type VNode = { type: unknown; props: Record<string, unknown> };
type Props = Record<string, unknown>;
type Effect = () => void | (() => void);
const FIX = { lon: -73.58, lat: 45.49, accuracy: 35, timestamp: 1_788_660_000_000 };
const ATLAS = { meta: { center: [-71.2, 46.8], zoom: 12 }, routes: [], stops: [] };
const code = ts.transpileModule(readFileSync(new URL("../components/map-view.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText;

/** Run the real component's effects; only browser/rendering boundaries are doubled. */
function harness(initialWidth = 1200) {
  let cursor = 0, dirty = false;
  const slots = new Map<number, unknown>();
  const dependencies = new Map<number, unknown[]>();
  const cleanups = new Map<number, (() => void) | void>();
  let pending: (() => void)[] = [];
  const markers: { coords: number[]; element: ElementStub; removed: boolean }[] = [];
  type ElementStub = { className: string; title: string; attributes: Record<string, string>; setAttribute: (k: string, v: string) => void };
  const react = {
    useState<T>(initial: T) {
      const index = cursor++;
      if (!slots.has(index)) slots.set(index, initial);
      return [slots.get(index) as T, (value: T | ((previous: T) => T)) => {
        const next = typeof value === "function" ? (value as (previous: T) => T)(slots.get(index) as T) : value;
        if (!Object.is(slots.get(index), next)) { slots.set(index, next); dirty = true; }
      }];
    },
    useRef<T>(initial: T) { const index = cursor++; if (!slots.has(index)) slots.set(index, { current: initial }); return slots.get(index); },
    useEffect(effect: Effect, deps: unknown[]) {
      const index = cursor++, old = dependencies.get(index);
      if (old && old.length === deps.length && deps.every((value, i) => Object.is(value, old[i]))) return;
      dependencies.set(index, deps);
      pending.push(() => { cleanups.get(index)?.(); cleanups.set(index, effect()); });
    },
  };
  class FakeMap {
    options: Props;
    sources = new Map<string, { data: unknown; setData: (data: unknown) => void }>();
    events = new Map<string, (() => void)[]>();
    layers = new Set<string>();
    cameras: { kind: string; value: unknown; options?: Props; projectionWidth: number }[] = [];
    projectionWidth = initialWidth;
    center = { lng: -71.2082, lat: 46.8131 };
    reticle = { lng: -73.62, lat: 45.52 };
    constructor(options: Props) { this.options = options; }
    on(event: string, handlerOrLayer: (() => void) | string, handler?: () => void) {
      const callback = typeof handlerOrLayer === "function" ? handlerOrLayer : handler!;
      this.events.set(event, [...(this.events.get(event) ?? []), callback]);
    }
    emit(event: string) {
      // MapLibre emits resize after updating its canvas/projection, not with the media query.
      if (event === "resize") this.projectionWidth = browserWindow.innerWidth;
      this.events.get(event)?.forEach((callback) => callback());
    }
    addSource(id: string, options: { data: unknown }) { const source = { data: options.data, setData(data: unknown) { this.data = data; } }; this.sources.set(id, source); }
    getSource(id: string) { return this.sources.get(id); }
    addLayer(layer: { id: string }) { this.layers.add(layer.id); }
    getLayer(id: string) { return this.layers.has(id); }
    easeTo(options: Props) { this.cameras.push({ kind: "ease", value: options, projectionWidth: this.projectionWidth }); }
    fitBounds(value: unknown, options: Props) { this.cameras.push({ kind: "fit", value, options, projectionWidth: this.projectionWidth }); }
    getCenter() { return { ...this.center, wrap: () => ({ ...this.center }) }; }
    unproject(point: number[]) { assert.deepEqual([...point], [500, 400]); return { wrap: () => ({ ...this.reticle }) }; }
    getZoom() { return 12; }
    getCanvas() { return { style: {}, clientWidth: 1000, clientHeight: 800, focus() {} }; }
    loaded() { return true; }
    queryRenderedFeatures() { return []; }
    addControl() {} setFilter() {} stop() {} remove() { this.events.clear(); }
  }
  const maps: FakeMap[] = [];
  const maplibre = {
    Map: class extends FakeMap { constructor(options: Props) { super(options); maps.push(this); } },
    NavigationControl: class {}, AttributionControl: class {}, setWorkerUrl() {},
    LngLat: class { lng: number; lat: number; constructor(lng: number, lat: number) { this.lng = lng; this.lat = lat; } },
    LngLatBounds: class {
      points: number[][];
      constructor(first: number[], last: number[]) { this.points = [first, last]; }
      extend(point: number[]) { this.points.push(point); return this; }
      static fromLngLat(center: unknown, radius: number) { return { center, radius }; }
    },
    Marker: class {
      record: typeof markers[number];
      constructor({ element }: { element: ElementStub }) { this.record = { element, coords: [], removed: false }; }
      setLngLat(coords: number[]) { this.record.coords = coords; return this; }
      addTo() { markers.push(this.record); return this; }
      remove() { this.record.removed = true; }
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>): VNode => {
    if (props.ref) (props.ref as { current: unknown }).current = {};
    return { type, props };
  };
  const modules: Record<string, unknown> = { react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "maplibre-gl": maplibre, "maplibre-gl/package.json": { version: "test" },
    "@/lib/geo": geo, "@/lib/location": location, "@/lib/map-legs": legs };
  const exports: { MapView?: (props: Props) => VNode } = {};
  const mediaListeners = new Set<() => void>();
  const desktopMedia = {
    get matches() { return browserWindow.innerWidth >= 641; },
    addEventListener(event: string, callback: () => void) { assert.equal(event, "change"); mediaListeners.add(callback); },
    removeEventListener(event: string, callback: () => void) { assert.equal(event, "change"); mediaListeners.delete(callback); },
  };
  const browserWindow = {
    setTimeout: () => 1, clearTimeout() {}, innerWidth: initialWidth, innerHeight: 900,
    matchMedia(query: string) {
      if (query === "(min-width: 641px)") return desktopMedia;
      assert.equal(query, "(prefers-reduced-motion: reduce)"); return { matches: true };
    },
  };
  vm.runInNewContext(code, { exports, require: (id: string) => { assert.ok(id in modules, `Unexpected import: ${id}`); return modules[id]; },
    window: browserWindow,
    document: { createElement: () => ({ className: "", title: "", attributes: {}, setAttribute(this: ElementStub, key: string, value: string) { this.attributes[key] = value; } }) },
  });
  let props: Props = { city: "quebec", atlas: null, onStop() {}, onRoute() {}, onPickLocation() {}, onCancelPick() {} };
  let tree: VNode;
  function render(next: Props = {}) {
    props = { ...props, ...next };
    let renders = 0;
    do {
      assert.ok(++renders < 10, "Component entered an update loop");
      cursor = 0; dirty = false; pending = [];
      tree = exports.MapView!(props);
      pending.forEach((effect) => effect());
    } while (dirty);
    return tree;
  }
  function button(label: string, node: unknown = tree): VNode | undefined {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const child of node) { const found = button(label, child); if (found) return found; } return; }
    const element = node as VNode;
    if (element.type === "button" && element.props.children === label) return element;
    if (element.props?.children !== undefined) return button(label, element.props.children);
  }
  return { render, button, markers, get map() { return maps[0]; }, ready() { maps[0].emit("style.load"); render(); },
    get mediaListenerCount() { return mediaListeners.size; },
    resize(width: number, completeMapResize = true) {
      const wasDesktop = desktopMedia.matches; browserWindow.innerWidth = width;
      if (desktopMedia.matches !== wasDesktop) mediaListeners.forEach((listener) => listener());
      if (completeMapResize) maps[0].emit("resize");
      render();
    },
    finishResize() { maps[0].emit("resize"); render(); },
    dispose() { cleanups.forEach((cleanup) => cleanup?.()); cleanups.clear(); },
  };
}

describe("MapView location effects", () => {
  it("reveals only the selected route and preserves manual map selection", (t) => {
    const app = harness(390); t.after(() => app.dispose());
    const selected = { id: "route-1", type: 3, shortName: "1", dirs: [{ id: 0, line: "??_ibE_ibE" }] };
    const other = { ...selected, id: "route-2", dirs: [{ id: 0, line: "_seK_seK_ibE_ibE" }] };
    app.render({ atlas: { ...ATLAS, routes: [selected, other] } }); app.ready();
    app.render({ selectedRouteId: selected.id });
    const fit = app.map.cameras.at(-1)!;
    assert.equal(fit.kind, "fit");
    const points = (fit.value as { points: number[][] }).points;
    assert.deepEqual(points.map((point) => [...point]), [[0, 0], [0, 0], [0, 0], [1, 1]]);
    assert.equal((fit.options?.padding as { bottom: number }).bottom, 110);
    assert.equal(fit.options?.duration, 0, "Route framing honors reduced motion");
    const count = app.map.cameras.length;
    app.render({ onRoute() {} });
    assert.equal(app.map.cameras.length, count, "An unrelated rerender must not reset the user's map view");
    app.resize(1200);
    assert.equal((app.map.cameras.at(-1)?.options?.padding as { left: number }).left, 440);
    const resizedCount = app.map.cameras.length;
    app.render({ pickingLocation: true, selectedRouteId: other.id });
    assert.equal(app.map.cameras.length, resizedCount, "Manual selection keeps control of the reticle");
  });

  it("waits for MapLibre's completed resize before reframing a confirmed departure at the breakpoint", (t) => {
    const app = harness(390); t.after(() => app.dispose());
    const focus = { lon: -73.62, lat: 45.52, zoom: 15 };
    app.render({ focus, manualDeparture: focus }); app.ready();
    assert.equal(app.mediaListenerCount, 0);
    assert.equal(app.map.events.get("resize")?.length, 1);
    assert.equal(app.map.cameras.length, 1);
    assert.deepEqual([...(app.map.cameras[0].value as { offset: number[] }).offset], [0, 0]);
    app.resize(640); assert.equal(app.map.cameras.length, 1);
    app.resize(641, false);
    assert.equal(app.map.cameras.length, 1, "The media query fires before MapLibre has updated its projection");
    assert.equal(app.map.projectionWidth, 640);
    app.finishResize(); assert.equal(app.map.cameras.length, 2);
    const desktop = app.map.cameras[1].value as { center: number[]; offset: number[] };
    assert.deepEqual([...desktop.center], [focus.lon, focus.lat]);
    assert.deepEqual([...desktop.offset], [190, 0]);
    assert.equal(app.map.cameras[1].projectionWidth, 641, "Reframing must use the resized projection");
    app.resize(1024); assert.equal(app.map.cameras.length, 2, "Resizing within one breakpoint must not steal camera control");
    app.resize(390); assert.equal(app.map.cameras.length, 3);
    assert.deepEqual([...(app.map.cameras[2].value as { offset: number[] }).offset], [0, 0]);
    assert.equal(app.markers.length, 1, "Responsive camera changes must retain the selected departure marker");
    app.dispose(); assert.equal(app.map.events.size, 0); assert.equal(app.markers[0].removed, true);
  });

  it("never presents the map's default centre as a detected user location", () => {
    const app = harness(); app.render({ atlas: ATLAS }); app.ready();
    assert.equal(app.markers.length, 0);
    assert.deepEqual(app.map.getSource("rive-accuracy")?.data, location.accuracyCollection(null));
  });

  it("marks the measured coordinates, feeds the accuracy polygon, and preserves focus when routes load late", () => {
    const app = harness(); app.render({ position: FIX, focus: FIX }); app.ready();
    assert.equal(app.markers.length, 1);
    assert.deepEqual([...app.markers[0].coords], [FIX.lon, FIX.lat]);
    assert.match(app.markers[0].element.attributes["aria-label"], /35 m/);
    assert.deepEqual(app.map.getSource("rive-accuracy")?.data, location.accuracyCollection(FIX));
    assert.equal(app.map.cameras.length, 1);
    assert.equal(app.map.cameras[0].kind, "fit");
    const bounds = app.map.cameras[0].value as { center: { lng: number; lat: number }; radius: number };
    assert.deepEqual([bounds.center.lng, bounds.center.lat], [FIX.lon, FIX.lat]);
    assert.ok(bounds.radius >= FIX.accuracy);
    app.render({ atlas: ATLAS, city: "montreal" });
    assert.equal(app.map.cameras.length, 1, "Late atlas must not move the camera back to its centre");
    app.render({ position: null });
    assert.equal(app.markers[0].removed, true);
    assert.deepEqual(app.map.getSource("rive-accuracy")?.data, location.accuracyCollection(null));
  });

  it("confirms the reticle's geographic point independently of GPS and a padded map centre", () => {
    let picked: unknown;
    const app = harness();
    app.render({ position: FIX, focus: FIX, pickingLocation: true, onPickLocation: (point: unknown) => { picked = point; } });
    app.ready(); app.map.center = { lng: -73.7, lat: 45.6 };
    const confirm = app.button("Confirmer ce départ");
    assert.ok(confirm); assert.equal(confirm.props.disabled, false);
    (confirm.props.onClick as () => void)();
    assert.deepEqual(JSON.parse(JSON.stringify(picked)), { lon: -73.62, lat: 45.52 });
    assert.equal(app.map.cameras.length, 0, "GPS must not pull the map away during manual picking");
  });
});
