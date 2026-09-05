"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Bus,
  Crosshair,
  MapPin,
  PersonSimpleWalk,
  Subway,
  X,
} from "@phosphor-icons/react";
const MapView = dynamic(
  () => import("@/components/map-view").then((mod) => mod.MapView),
  { ssr: false },
);
import { ItinerarySteps } from "@/components/itinerary-steps";
import { LineChip } from "@/components/line-chip";
import type { MapCamera } from "@/components/map-view";
import type {
  Atlas,
  AtlasRoute,
  AtlasStop,
  CityId,
  Itinerary,
  Place,
} from "@/lib/atlas/types";
import type { Poi } from "@/lib/poi";
import { understandQuery, type CityHint } from "@/lib/assist";
import { fetchJson, readJsonResponse } from "@/lib/client-http";
import { t, type MessageId } from "@/lib/i18n";
import { itineraryHasTransfer } from "@/lib/itinerary-display";
import { linesAtStop, type LineDue, type NearbyLine } from "@/lib/lines";
import {
  chipsForCities,
  firstStopFromQuery,
  placeFromStop,
  searchAtlas,
  supportedCityCenters,
  type CityVisit,
} from "@/lib/search";
import { resolveSearchAction } from "@/lib/search-submit";
import { formatClock, formatRelative } from "@/lib/time";
import {
  hintAtViewport,
  packedCityName,
  type CityCenterTable,
  type ViewportCityHint,
} from "@/lib/viewport-city";

type Field = "from" | "to";
type Departure = {
  routeId: string;
  shortName: string;
  color: string;
  textColor: string;
  headsign: string;
  type: number;
  agencyId?: string;
  depart: number;
  wait: number;
  times?: number[];
};

type NearbyPayload = {
  city: CityId;
  stop: (AtlasStop & { meters: number }) | null;
  lines: NearbyLine[];
  due: LineDue[];
};

type CitiesPayload = {
  shipped: string[];
  registry: Array<{ id: string; name: string }>;
  visits: CityVisit[];
  centers: CityCenterTable;
  atlasGap: string;
};

const FALLBACK_CITIES: Array<{ id: CityId; label: string; hints: [string, string] }> = [
  { id: "quebec", label: "Québec", hints: ["Place D'Youville", "Terminus de la Traverse"] },
  { id: "montreal", label: "Montréal", hints: ["Berri-UQAM", "Terminus Montmorency"] },
  { id: "sherbrooke", label: "Sherbrooke", hints: ["Université de Sherbrooke", "Station du Cégep"] },
  { id: "trois-rivieres", label: "Trois-Rivières", hints: ["Terminus Centre-ville", "Terminus UQTR"] },
];

function modeIcon(type: number, className: string) {
  if (type === 1) return <Subway className={className} weight="regular" />;
  return <Bus className={className} weight="regular" />;
}

function cityNamesFrom(cities: Array<{ id: string; label: string }>, registry: Array<{ id: string; name: string }>) {
  const names: Record<string, string> = {};
  for (const item of cities) names[item.id] = item.label;
  for (const item of registry) names[item.id] = item.name;
  return names;
}

function ViewportHintCard({ hint, onLoad }: { hint: ViewportCityHint; onLoad: () => void }) {
  switch (hint.kind) {
    case "current":
      return null;
    case "offer":
      return (
        <div className="glass rive-city-hint rounded-[12px] p-4" role="status">
          <p className="text-sm text-ink">
            {packedCityName(hint.city)} est dans l&apos;atlas. Gratuit, sans abonnement.
          </p>
          <button type="button" className="rive-load-city" onClick={onLoad}>
            {hint.label}
          </button>
        </div>
      );
    case "ingest":
    case "outside":
      return (
        <div className="glass rive-city-hint rounded-[12px] p-4" role="status">
          <p className="text-sm text-ink">{hint.text}</p>
        </div>
      );
    default: {
      const _never: never = hint;
      return _never;
    }
  }
}

export function RiveApp() {
  const reduce = useReducedMotion();
  const [locale] = useState("fr");
  const [cities, setCities] = useState(FALLBACK_CITIES);
  const [city, setCity] = useState<CityId>("quebec");
  const [visit, setVisit] = useState<CityVisit | null>(null);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [pois, setPois] = useState<Poi[]>([]);
  const [loadError, setLoadError] = useState("");
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [activeField, setActiveField] = useState<Field>("to");
  const [itineraries, setItineraries] = useState<Itinerary[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState("");
  const [selectedStop, setSelectedStop] = useState<AtlasStop | null>(null);
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [departuresBusy, setDeparturesBusy] = useState(false);
  const [nearby, setNearby] = useState<NearbyPayload | null>(null);
  const [viewportHint, setViewportHint] = useState<ViewportCityHint | null>(null);
  const [gpuLabel] = useState(() =>
    typeof navigator !== "undefined" && "gpu" in navigator ? "WebGPU prêt" : "WebGL",
  );
  const departuresRun = useRef<AbortController | null>(null);
  const planRun = useRef(0);
  const cityLocked = useRef(false);
  const pendingLookup = useRef<string | null>(null);
  const cameraTimer = useRef(0);
  const cityRef = useRef(city);
  const coverageRef = useRef<CitiesPayload | null>(null);
  cityRef.current = city;

  const tr = (id: MessageId) => t(id, locale);
  const chips = useMemo(
    () => chipsForCities(cities.map((item) => ({ city: item.id, name: item.label }))),
    [cities],
  );

  useEffect(() => {
    fetchJson<{ cities?: Array<{ city?: unknown; name?: unknown }> }>("/data/index.json", 2 * 1024 * 1024)
      .then((data: { cities?: Array<{ city?: unknown; name?: unknown }> } | null) => {
        const loaded = (data?.cities || [])
          .filter(
            (item): item is { city: string; name: string } =>
              typeof item.city === "string" &&
              item.city.length <= 64 &&
              /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.city) &&
              typeof item.name === "string",
          )
          .map((item) => ({
            id: item.city,
            label: item.name,
            hints: [item.name, "Arrêts près d'ici"] as [string, string],
          }));
        if (loaded.length) setCities(loaded);
      })
      .catch(() => {});
    fetchJson<CitiesPayload>("/api/cities")
      .then((data) => {
        coverageRef.current = data;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city) || city.length > 64) throw new Error("Ville invalide.");
      const data = await fetchJson<Atlas>(`/data/${encodeURIComponent(city)}/atlas.json`);
      let places: Poi[] = [];
      for (const path of [`/data/${encodeURIComponent(city)}/pois.json`, "/data/pois.json"]) {
        let parsed: { places?: Poi[] };
        try {
          parsed = await fetchJson<{ places?: Poi[] }>(path, 2 * 1024 * 1024);
        } catch {
          continue;
        }
        places = (parsed.places || []).filter((place) => !place.city || place.city === city);
        break;
      }
      if (alive) {
        setAtlas(data);
        setPois(places);
        setLoadError("");
      }
    }
    load().catch((err: Error) => {
      if (alive) setLoadError(err.message);
    });
    return () => {
      alive = false;
    };
  }, [city]);

  const typed = activeField === "from" ? fromQuery : toQuery;
  const deferredQuery = useDeferredValue(typed);
  const hits = useMemo(() => {
    if (!atlas) return [];
    return searchAtlas(atlas, deferredQuery, 7, undefined, { pois });
  }, [atlas, deferredQuery, pois]);

  const selectedRoute = useMemo(
    () => atlas?.routes.find((r) => r.id === selectedRouteId) ?? null,
    [atlas, selectedRouteId],
  );
  const activeItinerary = useMemo(
    () => itineraries.find((item) => item.id === chosen) ?? itineraries[0] ?? null,
    [itineraries, chosen],
  );
  const stopLines = useMemo(
    () => (atlas && selectedStop ? linesAtStop(atlas, selectedStop) : []),
    [atlas, selectedStop],
  );

  function resetBoard() {
    setItineraries([]);
    setChosen(null);
    setSelectedStop(null);
    setSelectedRouteId(null);
    setFrom(null);
    setTo(null);
    setFromQuery("");
    setToQuery("");
    setDepartures([]);
    setPlanError("");
    setNearby(null);
    setViewportHint(null);
  }

  function pickCity(next: CityId, nextVisit: CityVisit | null) {
    cityLocked.current = true;
    setCity(next);
    setVisit(nextVisit);
    setAtlas(null);
    setLoadError("");
    resetBoard();
  }

  function pickStopAs(field: Field, stop: AtlasStop) {
    const place: Place = {
      label: stop.name,
      lon: stop.lon,
      lat: stop.lat,
      stopId: stop.id,
    };
    if (field === "from") {
      setFrom(place);
      setFromQuery(stop.name);
    } else {
      setTo(place);
      setToQuery(stop.name);
    }
  }

  async function openStop(stop: AtlasStop) {
    setSelectedStop(stop);
    setSelectedRouteId(null);
    pickStopAs(activeField, stop);
    departuresRun.current?.abort();
    const run = new AbortController();
    departuresRun.current = run;
    setDepartures([]);
    setDeparturesBusy(true);
    try {
      const res = await fetch(
        `/api/departures?city=${encodeURIComponent(city)}&stop=${encodeURIComponent(stop.id)}`,
        { signal: run.signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await readJsonResponse<{ departures: Departure[] }>(res, 512 * 1024);
      if (departuresRun.current !== run) return;
      setDepartures(data.departures);
    } catch {
      if (departuresRun.current === run) setDepartures([]);
    } finally {
      if (departuresRun.current === run) setDeparturesBusy(false);
    }
  }

  function pickPoiAs(field: Field, poi: Poi) {
    const place: Place = { label: poi.name, lon: poi.lon, lat: poi.lat };
    if (field === "from") {
      setFrom(place);
      setFromQuery(poi.name);
    } else {
      setTo(place);
      setToQuery(poi.name);
    }
    const nextFrom = field === "from" ? place : from;
    const nextTo = field === "to" ? place : to;
    if (nextFrom && nextTo) void plan(nextFrom, nextTo);
  }

  async function plan(nextFrom = from, nextTo = to) {
    if (!nextFrom || !nextTo) return;
    const run = ++planRun.current;
    setPlanning(true);
    setPlanError("");
    setSelectedStop(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city, from: nextFrom, to: nextTo }),
      });
      const data = await readJsonResponse<{ itineraries?: Itinerary[]; error?: string }>(res, 4 * 1024 * 1024);
      if (planRun.current !== run) return;
      if (!res.ok) throw new Error(data.error || "Planification impossible.");
      const list = data.itineraries ?? [];
      setItineraries(list);
      setChosen(list[0]?.id ?? null);
      if (list.length === 0) {
        setPlanError("Aucun trajet trouvé sur les horaires du jour.");
      }
    } catch (err) {
      if (planRun.current !== run) return;
      setPlanError(err instanceof Error ? err.message : "Planification impossible.");
    } finally {
      if (planRun.current === run) setPlanning(false);
    }
  }

  function lookupRemoteStop(query: string, pack: Atlas) {
    const stop = firstStopFromQuery(pack, query);
    if (stop) {
      void openStop(stop);
      return;
    }
    const hit = searchAtlas(pack, query, 1, undefined, { pois })[0];
    if (hit?.kind === "stop") void openStop(hit.stop);
    else if (hit?.kind === "poi") pickPoiAs(activeField, hit.poi);
    else if (hit?.kind === "route") setSelectedRouteId(hit.route.id);
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    const raw = (toQuery || fromQuery).trim();
    const action = resolveSearchAction({ from, to, query: raw });
    if (action === "plan" && from && to) {
      void plan();
      return;
    }
    if (action === "schedule" && raw) {
      const intent = await understandQuery(raw, cities as CityHint[]);
      if (intent.city && intent.city !== city) {
        pendingLookup.current = intent.query;
        pickCity(intent.city, null);
        return;
      }
      if (atlas) lookupRemoteStop(intent.query, atlas);
    }
  }

  const loadNearbyAt = useCallback(async (lon: number, lat: number, destPoint: Place | null, packCity: CityId) => {
    try {
      const destQs =
        destPoint != null ? `&destLon=${destPoint.lon}&destLat=${destPoint.lat}` : "";
      const data = await fetchJson<NearbyPayload>(
        `/api/nearby?city=${encodeURIComponent(packCity)}&lon=${lon}&lat=${lat}${destQs}`,
      );
      setNearby(data);
    } catch {
      setNearby(null);
    }
  }, []);

  useEffect(() => {
    if (!atlas) return;
    let alive = true;
    const pending = pendingLookup.current;
    if (pending) {
      pendingLookup.current = null;
      lookupRemoteStop(pending, atlas);
      return () => {
        alive = false;
      };
    }
    const fallback = visit
      ? { lon: visit.lon, lat: visit.lat }
      : { lon: atlas.meta.center[0], lat: atlas.meta.center[1] };
    if (!navigator.geolocation) {
      void loadNearbyAt(fallback.lon, fallback.lat, to, city);
      return () => {
        alive = false;
      };
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!alive) return;
        const lon = pos.coords.longitude;
        const lat = pos.coords.latitude;
        const pack = coverageRef.current;
        const centers = pack?.centers ?? supportedCityCenters();
        const shipped = pack?.shipped ?? Object.keys(centers);
        const detected = hintAtViewport(
          lon,
          lat,
          cityRef.current,
          centers,
          cityNamesFrom(cities, pack?.registry ?? []),
          shipped,
        );
        if (
          !cityLocked.current &&
          detected.kind === "offer" &&
          detected.city &&
          shipped.includes(detected.city)
        ) {
          pickCity(detected.city, null);
          return;
        }
        const place: Place = { label: tr("myPosition"), lon, lat };
        setFrom(place);
        setFromQuery(tr("myPosition"));
        void loadNearbyAt(lon, lat, to, city);
      },
      () => {
        if (!alive) return;
        void loadNearbyAt(fallback.lon, fallback.lat, to, city);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
    return () => {
      alive = false;
    };
    // Nearby + cross-city lookup run once per atlas pack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas, city, loadNearbyAt]);

  function locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const place: Place = {
        label: tr("myPosition"),
        lon: pos.coords.longitude,
        lat: pos.coords.latitude,
      };
      setFrom(place);
      setFromQuery(tr("myPosition"));
      setActiveField("to");
      void loadNearbyAt(place.lon, place.lat, to, city);
    });
  }

  async function applyHint(name: string, field: Field) {
    if (!atlas) return;
    const hit = searchAtlas(atlas, name, 1)[0];
    if (hit?.kind === "stop") {
      pickStopAs(field, hit.stop);
      if (field === "from" && to) {
        void plan(
          {
            label: hit.stop.name,
            lon: hit.stop.lon,
            lat: hit.stop.lat,
            stopId: hit.stop.id,
          },
          to,
        );
      }
      if (field === "to" && from) {
        void plan(from, {
          label: hit.stop.name,
          lon: hit.stop.lon,
          lat: hit.stop.lat,
          stopId: hit.stop.id,
        });
      }
    } else if (field === "from") setFromQuery(name);
    else setToQuery(name);
  }

  function onCamera(cam: MapCamera) {
    if (!cam.user) return;
    window.clearTimeout(cameraTimer.current);
    cameraTimer.current = window.setTimeout(() => {
      const pack = coverageRef.current;
      if (!pack) return;
      const hint = hintAtViewport(
        cam.lon,
        cam.lat,
        cityRef.current,
        pack.centers,
        cityNamesFrom(cities, pack.registry),
        pack.shipped,
      );
      setViewportHint(hint.kind === "current" ? null : hint);
    }, 280);
  }

  function loadOfferedCity() {
    if (viewportHint?.kind !== "offer" || !viewportHint.city) return;
    pickCity(viewportHint.city, null);
  }

  const showTrip = planning || itineraries.length > 0 || Boolean(planError);
  const showNearby = !selectedStop && !showTrip && !selectedRoute && nearby && nearby.city === city;
  const nearbyHere = nearby && nearby.city === city ? nearby : null;

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-paper text-ink">
      <MapView
        city={city}
        atlas={atlas}
        focus={visit}
        selectedStop={selectedStop}
        selectedRouteId={selectedRouteId}
        itinerary={activeItinerary}
        onStop={(stop) => void openStop(stop)}
        onRoute={(id) => {
          setSelectedRouteId(id);
          setSelectedStop(null);
        }}
        onCamera={onCamera}
      />

      <div className="pointer-events-none absolute inset-0 z-[2]">
        <div className="pointer-events-auto absolute left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.65rem,env(safe-area-inset-top))]">
          <div className="glass flex max-w-full flex-wrap justify-start overflow-x-auto rounded-[12px] p-1" role="tablist" aria-label="Villes">
            {chips.map((item) => {
              const on = item.kind === "visit" ? visit?.id === item.id : item.city === city && !visit;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => pickCity(item.city, item.visit || null)}
                  className={`shrink-0 cursor-pointer rounded-[10px] px-3 py-2 text-[13px] font-semibold tracking-tight min-h-11 transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sodium ${
                    on
                      ? "bg-sodium text-[#f0fdfa]"
                      : "text-muted hover:bg-black/5 hover:text-ink"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pointer-events-auto absolute bottom-4 left-4 right-4 md:right-auto md:w-[min(100%-2rem,400px)]">
          {viewportHint ? <ViewportHintCard hint={viewportHint} onLoad={loadOfferedCity} /> : null}

          <AnimatePresence mode="wait">
            {selectedStop ? (
              <motion.section
                key={`stop-${selectedStop.id}`}
                initial={reduce ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: 16 }}
                transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
                className="glass rive-sheet mb-3 rounded-[12px] p-5"
              >
                <div className="rive-grab" />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-medium tracking-tight">{selectedStop.name}</h2>
                    <p className="mt-1 text-sm text-muted">{tr("remoteHint")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedStop(null)}
                    className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-well text-ink/70 transition-colors hover:bg-well-hi hover:text-ink"
                    aria-label={tr("close")}
                  >
                    <X size={14} />
                  </button>
                </div>
                {stopLines.length > 0 ? (
                  <div className="rive-chip-row">
                    {stopLines.map((line) => (
                      <LineChip
                        key={line.routeId}
                        shortName={line.shortName}
                        color={line.color}
                        textColor={line.textColor}
                        onClick={() => {
                          setSelectedRouteId(line.routeId);
                          setSelectedStop(null);
                        }}
                      />
                    ))}
                  </div>
                ) : null}
                <ul className="mt-4 space-y-3">
                  {departuresBusy && <li className="text-sm text-muted">Lecture des horaires…</li>}
                  {!departuresBusy && departures.length === 0 && (
                    <li className="text-sm text-muted">{tr("noPassages")}</li>
                  )}
                  {departures.map((row) => (
                    <li key={`${row.routeId}-${row.headsign}`} className="flex items-center gap-3">
                      <LineChip shortName={row.shortName} color={row.color} textColor={row.textColor} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{row.headsign}</p>
                        <p className="font-mono text-[11px] text-ink/45">
                          {(row.times && row.times.length > 0 ? row.times : [row.depart])
                            .slice(0, 5)
                            .map((t) => formatClock(t))
                            .join("  ")}
                          {row.agencyId ? `  ${row.agencyId}` : ""}
                        </p>
                      </div>
                      <span className="font-medium" style={{ color: row.color }}>
                        {row.wait > 90 ? formatClock(row.depart) : formatRelative(row.wait)}
                      </span>
                    </li>
                  ))}
                </ul>
              </motion.section>
            ) : showTrip ? (
              <motion.section
                key="trip"
                initial={reduce ? false : { opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: 18 }}
                transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
                className="glass rive-sheet mb-3 rounded-[12px] p-5"
              >
                <div className="rive-grab" />
                {planning && <p className="text-sm text-muted">Lecture des horaires…</p>}
                {planError && <p className="text-sm text-ink">{planError}</p>}
                {itineraries.map((item) => {
                  const on = item.id === (chosen ?? itineraries[0]?.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setChosen(item.id)}
                      className={`mb-3 w-full rounded-[10px] p-4 text-left transition-colors last:mb-0 ${
                        on ? "bg-well ring-1 ring-sodium/40" : "bg-transparent hover:bg-well"
                      }`}
                    >
                      <div className="flex items-end justify-between">
                        <p className="text-3xl font-medium tracking-tight">{item.minutes} min</p>
                        <p className="text-xs text-ink/55">
                          {item.transfers === 0 || !itineraryHasTransfer(item)
                            ? tr("direct")
                            : `${item.transfers} ${tr("transfer")}`}
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                        {item.legs.map((leg, i) =>
                          leg.kind === "walk" ? (
                            <span key={i} className="inline-flex items-center gap-1 text-ink/75">
                              <PersonSimpleWalk size={14} />
                              {leg.minutes} min
                            </span>
                          ) : leg.kind === "bike" ? (
                            <span key={i} className="inline-flex items-center gap-1 text-ink/75">
                              {leg.system === "avelo" ? "àVélo" : "BIXI"} {leg.minutes} min
                            </span>
                          ) : leg.kind === "road" ? (
                            <span key={i} className="inline-flex items-center gap-1 text-ink/75">
                              Auto {leg.minutes} min
                            </span>
                          ) : (
                            <span key={i} className="inline-flex items-center gap-2">
                              {i > 0 && <ArrowRight size={12} className="text-ink/45" />}
                              <LineChip shortName={leg.shortName} color={leg.color} textColor={leg.textColor} />
                              <span className="text-ink/75">
                                {leg.headsign}
                                {leg.agencyId ? ` · ${leg.agencyId}` : ""}
                              </span>
                            </span>
                          ),
                        )}
                      </div>
                    </button>
                  );
                })}
                {activeItinerary ? <ItinerarySteps itinerary={activeItinerary} /> : null}
              </motion.section>
            ) : selectedRoute ? (
              <motion.section
                key={`route-${selectedRoute.id}`}
                initial={reduce ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: 16 }}
                className="glass mb-3 rounded-[12px] p-5"
              >
                <div className="flex items-center gap-3">
                  <RouteBadge route={selectedRoute} />
                  <div>
                    <h2 className="text-lg font-medium">{selectedRoute.shortName}</h2>
                    <p className="text-sm text-muted">{selectedRoute.longName}</p>
                  </div>
                </div>
              </motion.section>
            ) : showNearby && nearbyHere ? (
              <motion.section
                key="nearby"
                initial={reduce ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: 16 }}
                className="glass rive-sheet mb-3 rounded-[12px] p-5"
              >
                <div className="rive-grab" />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-medium tracking-tight">{tr("nearbyNow")}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {nearbyHere.stop?.name || cities.find((item) => item.id === city)?.label || city}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={locate}
                    className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-well text-ink/70 transition-colors hover:bg-well-hi hover:text-ink"
                    aria-label={tr("myPosition")}
                  >
                    <Crosshair size={16} />
                  </button>
                </div>
                {nearbyHere.lines.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">{tr("noNearby")}</p>
                ) : (
                  <div className="rive-chip-row">
                    {nearbyHere.lines.map((line) => (
                      <LineChip
                        key={line.routeId}
                        shortName={line.shortName}
                        color={line.color}
                        textColor={line.textColor}
                        onClick={() => setSelectedRouteId(line.routeId)}
                      />
                    ))}
                  </div>
                )}
                <ul className="mt-4 space-y-3">
                  {nearbyHere.due.slice(0, 8).map((row) => (
                    <li key={`${row.routeId}-${row.headsign}-${row.stopId}`} className="flex items-center gap-3">
                      <LineChip shortName={row.shortName} color={row.color} textColor={row.textColor} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{row.headsign}</p>
                        <p className="font-mono text-[11px] text-ink/45">
                          {row.clocks.slice(0, 4).join("  ")}
                          {row.stopName ? `  ${row.stopName}` : ""}
                        </p>
                      </div>
                      <span className="font-medium" style={{ color: row.color }}>
                        {row.wait > 90 ? formatClock(row.depart) : formatRelative(row.wait)}
                      </span>
                    </li>
                  ))}
                </ul>
              </motion.section>
            ) : null}
          </AnimatePresence>

          <form onSubmit={onSearch} className="glass rounded-[12px] p-4">
            <div className="flex items-center justify-between px-1 pb-2">
              <p className="text-[15px] font-medium tracking-tight">{tr("whereTo")}</p>
              <button
                type="button"
                onClick={locate}
                className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-well text-ink/70 transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-well-hi hover:text-ink"
                aria-label={tr("myPosition")}
              >
                <Crosshair size={16} />
              </button>
            </div>
            <label className="mb-2 flex items-center gap-2 rounded-[10px] border border-hairline bg-well px-3 py-2.5 transition-colors focus-within:border-sodium">
              <PersonSimpleWalk size={16} className="text-sodium/80" />
              <span className="sr-only">{tr("from")}</span>
              <input
                value={fromQuery}
                onChange={(e) => {
                  setFromQuery(e.target.value);
                  setFrom(null);
                  setActiveField("from");
                }}
                onFocus={() => setActiveField("from")}
                placeholder={tr("from")}
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink/45"
              />
            </label>
            <label className="mb-3 flex items-center gap-2 rounded-[10px] border border-hairline bg-well px-3 py-2.5 transition-colors focus-within:border-sodium">
              <MapPin size={16} className="text-sodium" />
              <span className="sr-only">{tr("to")}</span>
              <input
                value={toQuery}
                onChange={(e) => {
                  setToQuery(e.target.value);
                  setTo(null);
                  setActiveField("to");
                }}
                onFocus={() => setActiveField("to")}
                placeholder={tr("whereTo")}
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink/45"
              />
            </label>
            <button type="submit" className="rive-aller">
              {tr("aller")} <ArrowRight size={18} />
            </button>

            {hits.length > 0 && (
              <ul className="mt-2 divide-y divide-hairline">
                {hits.map((hit) =>
                  hit.kind === "stop" ? (
                    <li key={`s-${hit.stop.id}`}>
                      <button
                        type="button"
                        onClick={() => {
                          const place = placeFromStop(hit.stop);
                          pickStopAs(activeField, hit.stop);
                          const nextFrom = activeField === "from" ? place : from;
                          const nextTo = activeField === "to" ? place : to;
                          if (nextFrom && nextTo) void plan(nextFrom, nextTo);
                          else void openStop(hit.stop);
                        }}
                        className="flex w-full items-center gap-3 px-2 py-2.5 text-left"
                      >
                        <MapPin size={16} className="text-ink/50" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{hit.stop.name}</span>
                          {hit.stop.agencyId && (
                            <span className="block text-[11px] text-ink/45">{hit.stop.agencyId}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ) : hit.kind === "poi" ? (
                    <li key={`p-${hit.poi.id}`}>
                      <button
                        type="button"
                        onClick={() => pickPoiAs(activeField, hit.poi)}
                        className="flex w-full items-center gap-3 px-2 py-2.5 text-left"
                      >
                        <MapPin size={16} className="text-[#d97706]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{hit.poi.name}</span>
                          <span className="block text-[11px] text-ink/45">
                            {hit.poi.category || "Point important"} · popularité {Math.round(hit.poi.popularity)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ) : (
                    <li key={`r-${hit.route.id}`}>
                      <button
                        type="button"
                        onClick={() => setSelectedRouteId(hit.route.id)}
                        className="flex w-full items-center gap-3 px-2 py-2.5 text-left"
                      >
                        <RouteBadge route={hit.route} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink/80">
                            {hit.route.longName || hit.route.shortName}
                          </span>
                          {hit.route.agencyId && (
                            <span className="block text-[11px] text-ink/45">{hit.route.agencyId}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ),
                )}
              </ul>
            )}

            {!fromQuery && !toQuery && (
              <div className="mt-3 flex flex-wrap gap-2 px-1">
                {(cities.find((item) => item.id === city)?.hints || ["Ici", "Arrêts près d'ici"]).map((hint, index) => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => void applyHint(hint, index === 0 ? "from" : "to")}
                    className="min-h-9 rounded-full bg-well px-3 py-1 text-xs text-ink/75 transition-colors hover:bg-well-hi hover:text-ink"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            )}
          </form>
        </div>

        <div className="pointer-events-none absolute bottom-4 right-4 hidden items-end gap-3 text-[10px] text-ink/50 md:flex">
          <span className="rounded-full bg-well px-2 py-1 text-ink/70">{gpuLabel}</span>
          {atlas && (
            <p className="max-w-xs text-right leading-relaxed">
              {atlas.meta.attribution} Mise à jour {atlas.meta.start}.
            </p>
          )}
        </div>
      </div>

      {!atlas && !loadError && (
        <div className="absolute inset-0 z-[3] flex items-center justify-center bg-paper">
          <p className="text-sm text-muted">{tr("loading")}</p>
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 z-[3] flex items-center justify-center bg-paper p-6 text-center">
          <p className="max-w-sm text-sm text-ink">{loadError}</p>
        </div>
      )}
    </div>
  );
}

function RouteBadge({ route }: { route: AtlasRoute }) {
  return (
    <span
      className="inline-flex min-w-12 items-center justify-center gap-1 rounded-full px-2 py-1 text-xs font-semibold"
      style={{ background: route.color, color: route.textColor }}
    >
      {modeIcon(route.type, "h-3 w-3")}
      {route.shortName}
    </span>
  );
}
