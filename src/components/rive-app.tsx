"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowsDownUp,
  CaretDown,
  MapTrifold,
  Clock,
  Bus,
  Crosshair,
  MagnifyingGlass,
  MapPin,
  PersonSimpleWalk,
  Subway,
  X,
} from "@phosphor-icons/react";
const MapView = dynamic(
  () => import("@/components/map-view").then((mod) => mod.MapView),
  { ssr: false },
);
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
import { t, type MessageId } from "@/lib/i18n";
import { chipsForCities, cityForPoint, placeFromStop, searchAtlas, type CityVisit } from "@/lib/search";
import { resolveSearchAction } from "@/lib/search-submit";
import { formatClock, formatRelative } from "@/lib/time";
import { fetchJson, readJsonResponse } from "@/lib/client-http";
import { accuracyLabel, LocationRequestError, requestLocation, type LocationFailure, type LocationFix } from "@/lib/location";

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

const LOCATION_ERRORS: Record<LocationFailure, string> = {
  denied: "L’accès à ta position est bloqué dans le navigateur ou les réglages de l’appareil.",
  unavailable: "Le navigateur ne reçoit aucune position, même si tu as autorisé l’accès.",
  timeout: "Le navigateur n’a pas réussi à te localiser à temps.",
  unsupported: "Ce navigateur ne propose pas la localisation. Tu peux choisir ton départ sur la carte.",
  insecure: "La localisation nécessite une connexion sécurisée. Ouvre Rive en HTTPS ou choisis ton départ sur la carte.",
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

function stopDetail(stop: AtlasStop): string {
  return [stop.agencyId, stop.code ? `Arrêt ${stop.code}` : ""].filter(Boolean).join(" · ");
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<LocationFailure | null>(null);
  const [locationRetry, setLocationRetry] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [position, setPosition] = useState<LocationFix | null>(null);
  const [mapFocus, setMapFocus] = useState<{ lon: number; lat: number; zoom?: number; accuracy?: number } | null>(null);
  const [pickingLocation, setPickingLocation] = useState(false);
  const [manualDeparture, setManualDeparture] = useState<Place | null>(null);
  const [departureError, setDepartureError] = useState("");
  const locationRun = useRef(0);
  const locationRequest = useRef<AbortController | null>(null);
  const fromInput = useRef<HTMLInputElement>(null);
  const toInput = useRef<HTMLInputElement>(null);
  const searchResults = useRef<HTMLUListElement>(null);
  const pendingResultFocus = useRef<"first" | "last" | null>(null);
  const mapPickButton = useRef<HTMLButtonElement>(null);
  const destinationAction = useRef<HTMLButtonElement>(null);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const departuresRun = useRef<AbortController | null>(null);
  const planRun = useRef(0);

  useEffect(() => () => { ++locationRun.current; locationRequest.current?.abort(); }, []);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 641px)");
    const showDesktopPanel = () => { if (desktop.matches) setCollapsed(false); };
    showDesktopPanel();
    desktop.addEventListener("change", showDesktopPanel);
    return () => desktop.removeEventListener("change", showDesktopPanel);
  }, []);

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
            hints: FALLBACK_CITIES.find((entry) => entry.id === item.city)?.hints || [item.name, "Arrêts près d'ici"] as [string, string],
          }));
        if (loaded.length) setCities(loaded);
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

  useEffect(() => {
    if (!searchOpen || !pendingResultFocus.current || deferredQuery !== typed) return;
    const buttons = searchResults.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons?.length) return;
    const target = pendingResultFocus.current === "first" ? 0 : buttons.length - 1;
    pendingResultFocus.current = null;
    buttons[target].focus();
  }, [searchOpen, deferredQuery, typed, hits]);

  const selectedRoute = useMemo(
    () => atlas?.routes.find((r) => r.id === selectedRouteId) ?? null,
    [atlas, selectedRouteId],
  );
  const activeItinerary = useMemo(
    () => itineraries.find((item) => item.id === chosen) ?? itineraries[0] ?? null,
    [itineraries, chosen],
  );
  const exploreRoutes = useMemo(() => {
    const routes = atlas?.routes ?? [];
    const featured = routes.filter((route) => route.type === 1 || /^80[0-7]$/.test(route.shortName));
    return (featured.length ? featured : routes).slice(0, 6);
  }, [atlas]);

  function pickStopAs(field: Field, stop: AtlasStop) {
    setSearchOpen(false);
    const place: Place = {
      label: stop.name,
      lon: stop.lon,
      lat: stop.lat,
      stopId: stop.id,
    };
    if (field === "from") {
      cancelLocation();
      setManualDeparture(null);
      setFrom(place);
      setFromQuery(stop.name);
    } else {
      setTo(place);
      setToQuery(stop.name);
    }
  }

  async function openStop(stop: AtlasStop) {
    invalidateTrip();
    setCollapsed(false);
    setSearchOpen(false);
    setDepartureError("");
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
      if (departuresRun.current === run && !run.signal.aborted) {
        setDepartures([]);
        setDepartureError("Les horaires sont indisponibles pour le moment.");
      }
    } finally {
      if (departuresRun.current === run) setDeparturesBusy(false);
    }
  }

  function pickPoiAs(field: Field, poi: Poi) {
    setSearchOpen(false);
    setSelectedStop(null);
    const place: Place = { label: poi.name, lon: poi.lon, lat: poi.lat };
    if (field === "from") {
      cancelLocation();
      setManualDeparture(null);
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
    clearDepartures();
    setSearchOpen(false);
    setSelectedStop(null);
    setCollapsed(false);
    setItineraries([]);
    const run = ++planRun.current;
    setPlanning(true);
    setPlanError("");
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

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    const raw = typed.trim();
    const action = resolveSearchAction({ from, to, query: raw });
    if (action === "plan" && from && to) {
      void plan();
      return;
    }
    if (action === "schedule" && atlas && raw) {
       const intent = await understandQuery(raw, cities as CityHint[]);
      if (intent.city && intent.city !== city) {
         setPlanError("Choisis d’abord cette ville dans la barre du haut, puis relance la recherche.");
         return;
       }
       const hit = searchAtlas(atlas, intent.query, 1, undefined, { pois })[0];
       if (hit?.kind === "stop") void openStop(hit.stop);
       else if (hit?.kind === "poi") pickPoiAs(activeField, hit.poi);
       else if (hit?.kind === "route") selectRoute(hit.route.id);
       else setPlanError("Aucun résultat. Essaie un nom d’arrêt, une adresse connue ou un numéro de ligne.");
    }
  }

  function cancelLocation() {
    ++locationRun.current;
    locationRequest.current?.abort();
    locationRequest.current = null;
    setLocationBusy(false);
    setLocationMessage("");
    setLocationError(null);
  }

  function applyDeparture(place: Place) {
    invalidateTrip();
    departuresRun.current?.abort();
    setDepartures([]);
    setDeparturesBusy(false);
    setDepartureError("");
    setSearchOpen(false);
    const detected = cityForPoint(place.lon, place.lat);
    const availableCity = cities.find((entry) => entry.id === detected);
    let note = "";
    if (availableCity && detected !== city) {
      setAtlas(null);
      setPois([]);
      setCity(availableCity.id);
      setTo(null);
      setToQuery("");
      setLoadError("");
      note = ` Réseau de ${availableCity.label} sélectionné.`;
    } else if (!availableCity) {
      note = " Ce point est hors des réseaux disponibles. Choisis un départ dans une ville couverte pour préparer un trajet.";
    }
    setVisit(null);
    setFrom(place);
    setFromQuery(place.label);
    setActiveField("to");
    return note;
  }

  async function locate() {
    cancelLocation();
    setLocationError(null);
    setLocationMessage("");
    setLocationRetry(false);
    setSearchOpen(false);
    setPickingLocation(false);
    if (window.innerWidth <= 640) setCollapsed(true);
    fromInput.current?.blur();
    toInput.current?.blur();
    if (!window.isSecureContext) {
      setLocationError("insecure");
      return;
    }
    if (!navigator.geolocation) {
      setLocationError("unsupported");
      return;
    }
    const run = ++locationRun.current;
    const controller = new AbortController();
    locationRequest.current = controller;
    setLocationBusy(true);
    try {
      const fix = await requestLocation(navigator.geolocation, {
        signal: controller.signal,
        onRetry: () => { if (run === locationRun.current) setLocationRetry(true); },
      });
      if (run !== locationRun.current) return;
      const note = applyDeparture({ label: tr("myPosition"), lon: fix.lon, lat: fix.lat });
      setPosition(fix);
      setManualDeparture(null);
      setMapFocus({ ...fix });
      setLocationMessage(`Position reçue et utilisée comme départ. ${accuracyLabel(fix.accuracy)}.${note}`);
    } catch (error) {
      if (run !== locationRun.current) return;
      if (error instanceof Error && error.name === "AbortError") return;
      setLocationError(error instanceof LocationRequestError ? error.reason : "unavailable");
    } finally {
      if (run === locationRun.current) {
        setLocationBusy(false);
        locationRequest.current = null;
      }
    }
  }

  function beginMapPick() {
    cancelLocation();
    ++planRun.current;
    setPlanning(false);
    setLocationError(null);
    setLocationMessage("");
    setSearchOpen(false);
    setPickingLocation(true);
    if (window.innerWidth <= 640) setCollapsed(true);
  }

  function cancelMapPick() {
    setPickingLocation(false);
    requestAnimationFrame(() => mapPickButton.current?.focus());
  }

  function confirmMapPick(point: { lon: number; lat: number }) {
    const place = { ...point, label: "Départ choisi sur la carte" };
    const note = applyDeparture(place);
    setManualDeparture(place);
    setMapFocus({ ...point, zoom: 15 });
    setPickingLocation(false);
    setLocationMessage(`Départ choisi sur la carte. Ajoute ta destination.${note}`);
    requestAnimationFrame(() => destinationAction.current?.focus());
  }

  function invalidateTrip() {
    ++planRun.current;
    setPlanning(false);
    setItineraries([]);
    setChosen(null);
    setPlanError("");
    setSelectedStop(null);
    setSelectedRouteId(null);
    clearDepartures();
  }

  function clearDepartures() {
    departuresRun.current?.abort();
    departuresRun.current = null;
    setDepartures([]);
    setDeparturesBusy(false);
    setDepartureError("");
  }

  function selectRoute(id: string) {
    invalidateTrip();
    setSelectedRouteId(id);
    setSearchOpen(false);
    const showMap = window.innerWidth <= 640;
    setCollapsed(showMap);
    if (showMap) requestAnimationFrame(() => panelToggle.current?.focus());
  }

  function clearField(field: Field) {
    if (field === "from") {
      cancelLocation();
      setManualDeparture(null);
      setFrom(null);
      setFromQuery("");
    } else {
      setTo(null);
      setToQuery("");
    }
    invalidateTrip();
    setActiveField(field);
    (field === "from" ? fromInput : toInput).current?.focus();
    setSearchOpen(false);
  }

  function enterSearchResults(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (!typed.trim() || deferredQuery !== typed || hits.length === 0) return;
    event.preventDefault();
    const buttons = searchResults.current?.querySelectorAll<HTMLButtonElement>("button");
    if (buttons?.length) buttons[event.key === "ArrowDown" ? 0 : buttons.length - 1].focus();
    else {
      pendingResultFocus.current = event.key === "ArrowDown" ? "first" : "last";
      setSearchOpen(true);
    }
  }

  function navigateSearchResults(event: KeyboardEvent<HTMLUListElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowUp" && index <= 0) {
      (activeField === "from" ? fromInput : toInput).current?.focus();
      return;
    }
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowUp" ? index - 1 : Math.min(index + 1, buttons.length - 1);
    buttons[next].focus();
  }

  function swapPlaces() {
    cancelLocation();
    setManualDeparture(null);
    setLocationMessage("");
    invalidateTrip();
    setFrom(to);
    setTo(from);
    setFromQuery(toQuery);
    setToQuery(fromQuery);
    setSearchOpen(false);
    if (from && to) void plan(to, from);
  }

  async function applyHint(name: string, field: Field) {
    if (!atlas) return;
    const hit = searchAtlas(atlas, name, 1)[0];
    if (hit?.kind === "stop") {
      pickStopAs(field, hit.stop);
      if (field === "from" && to) void plan({
        label: hit.stop.name,
        lon: hit.stop.lon,
        lat: hit.stop.lat,
        stopId: hit.stop.id,
      }, to);
      if (field === "to" && from) {
        void plan(from, {
          label: hit.stop.name,
          lon: hit.stop.lon,
          lat: hit.stop.lat,
          stopId: hit.stop.id,
        });
      }
    } else {
      if (field === "from") setFromQuery(name);
      else setToQuery(name);
    }
  }

  return (
    <main className={`rive-app relative h-[100dvh] overflow-hidden bg-paper text-ink ${pickingLocation ? "is-picking-location" : ""}`} onKeyDown={(event) => {
      if (event.key === "Escape" && pickingLocation) cancelMapPick();
    }}>
      <a href="#journey-destination" className="skip-link" onClick={(event) => {
        event.preventDefault();
        setPickingLocation(false);
        setCollapsed(false);
        setActiveField("to");
        requestAnimationFrame(() => toInput.current?.focus());
      }}>Aller à la recherche</a>
      <MapView
        city={city}
        atlas={atlas}
        focus={mapFocus ?? visit}
        position={position}
        manualDeparture={manualDeparture}
        pickingLocation={pickingLocation}
        onPickLocation={confirmMapPick}
        onCancelPick={cancelMapPick}
        selectedStop={selectedStop}
        selectedRouteId={selectedRouteId}
        itinerary={activeItinerary}
        onStop={(stop) => void openStop(stop)}
        onRoute={selectRoute}
      />

      <div className="pointer-events-none absolute inset-0 z-[2]">
        <header className="rive-brand"><span className="brand-symbol"><Bus size={24} weight="bold" /></span><span>rive<span className="brand-dot">.</span></span><p>La ville, à ta portée.</p></header>
        <div className="city-navigation">
          <div className="glass city-strip" role="group" aria-label="Choisir une ville">
            {chips.map((item) => {
              const on = item.kind === "visit" ? visit?.id === item.id : item.city === city && !visit;
              return (
                <button
                  key={item.id}
                  aria-pressed={on}
                  type="button"
                  onClick={() => {
                    if (on) return;
                    ++planRun.current;
                    cancelLocation();
                    departuresRun.current?.abort();
                    setPlanning(false);
                    setLocationBusy(false);
                    setLocationError(null);
                    setLocationMessage("");
                    setMapFocus(null);
                    setManualDeparture(null);
                    setPickingLocation(false);
                    setSearchOpen(false);
                    setDepartureError("");
                    if (item.city !== city) setAtlas(null);
                    setCity(item.city);
                    setVisit(item.visit || null);
                    setLoadError("");
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
                  }}
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

        {!pickingLocation && <section className="location-tools" aria-label="Ta position et ton départ">
          <div className="location-buttons">
            <button type="button" className="location-primary locate-button" onClick={() => void locate()} disabled={locationBusy}>
              <Crosshair size={20} weight="bold" className={locationBusy ? "animate-pulse" : ""} />
              {locationBusy ? "Recherche…" : "Me localiser"}
            </button>
            {locationBusy
              ? <button type="button" className="location-secondary glass" onClick={cancelLocation}>Annuler</button>
              : <button ref={mapPickButton} type="button" className="location-secondary glass" onClick={beginMapPick}><MapPin size={18} />Choisir sur la carte</button>}
          </div>
          {(locationBusy || locationError || locationMessage) && <div className="location-feedback glass">
            <p role="status">{locationBusy
              ? locationRetry ? "Toujours en recherche… Rive essaie une dernière fois." : "Si le navigateur le demande, choisis « Autoriser »."
              : locationError ? LOCATION_ERRORS[locationError] : locationMessage}</p>
            {locationError && <>
              {position && <p className="location-detail">Le repère conserve la dernière position reçue.</p>}
              <p className="location-detail">Tu peux réessayer avec « Me localiser » ou choisir ton départ sur la carte.</p>
              <details className="location-help">
                <summary>J’ai déjà autorisé. Que faire ?</summary>
                <ol>
                  <li>Dans les réglages du site, vérifie que la position est autorisée.</li>
                  <li>Sur Mac : Réglages Système → Confidentialité et sécurité → Service de localisation. Active-le pour l’application qui affiche Rive, puis vérifie que le Wi-Fi est activé.</li>
                  <li>Si le navigateur intégré ne reçoit toujours rien, ouvre la même adresse dans Safari ou Chrome, ou utilise « Choisir sur la carte ».</li>
                </ol>
              </details>
            </>}
            {!locationBusy && <div className="location-feedback-actions">
              {locationMessage && <button ref={destinationAction} type="button" onClick={() => {
                setCollapsed(false);
                setActiveField("to");
                setLocationMessage("");
                requestAnimationFrame(() => toInput.current?.focus());
              }}>Choisir ma destination <ArrowRight size={16} /></button>}
              <button type="button" className="location-dismiss" onClick={() => { setLocationMessage(""); setLocationError(null); }}>Fermer</button>
            </div>}
          </div>}
        </section>}

        <aside className={`journey-panel glass ${collapsed ? "is-collapsed" : ""}`} aria-label="Rechercher et préparer un trajet">
          <button ref={panelToggle} type="button" className="panel-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-controls="journey-content">
            <span><MapTrifold size={18} />{collapsed ? selectedRoute ? `Ligne ${selectedRoute.shortName} · Voir les détails` : "Préparer mon trajet" : "Voir la carte"}</span><CaretDown size={18} />
          </button>
          <div id="journey-content" className="journey-content" hidden={collapsed}>
        <form onSubmit={onSearch} onKeyDown={(event) => {
          if (event.key === "Escape" && searchOpen) {
            event.preventDefault();
            (activeField === "from" ? fromInput : toInput).current?.focus();
            setSearchOpen(false);
          }
        }}>
          <div className="search-section">
            <div className="flex items-center justify-between px-2 pb-2">
              <div><p className="eyebrow">ON Y VA ?</p><h1>Où vas-tu ?</h1></div>
            </div>
            <p className="search-intro">Un trajet à préparer. Un arrêt à consulter.</p>
            <div className="journey-field mb-2 flex items-center gap-2 rounded-[10px] border border-hairline bg-well px-3 py-2.5 transition-colors focus-within:border-sodium">
              <PersonSimpleWalk size={16} className="text-sodium/80" />
              <div className="journey-field-body">
              <label htmlFor="journey-origin" className="journey-field-label">Départ</label>
              <input
                id="journey-origin"
                ref={fromInput}
                autoComplete="off"
                maxLength={512}
                value={fromQuery}
                onChange={(e) => {
                  cancelLocation();
                  setManualDeparture(null);
                  setLocationMessage("");
                  invalidateTrip();
                  setSearchOpen(true);
                  setFromQuery(e.target.value);
                  setFrom(null);
                  setActiveField("from");
                }}
                onFocus={() => { setActiveField("from"); setSearchOpen(true); }}
                onKeyDown={enterSearchResults}
                placeholder="Point de départ"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
              />
              </div>
              {fromQuery && <button type="button" className="clear-field" aria-label="Effacer le départ" onClick={() => clearField("from")}><X size={16} /></button>}
            </div>
            <div className="journey-field flex items-center gap-2 rounded-[10px] border border-hairline bg-well px-3 py-2.5 transition-colors focus-within:border-sodium">
              <MapPin size={16} className="text-sodium" />
              <div className="journey-field-body">
              <label htmlFor="journey-destination" className="journey-field-label">Destination</label>
              <input
                id="journey-destination"
                ref={toInput}
                autoComplete="off"
                maxLength={512}
                value={toQuery}
                onChange={(e) => {
                  invalidateTrip();
                  setSearchOpen(true);
                  setToQuery(e.target.value);
                  setTo(null);
                  setActiveField("to");
                }}
                onFocus={() => { setActiveField("to"); setSearchOpen(true); }}
                onKeyDown={enterSearchResults}
                placeholder="Destination, arrêt ou ligne"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
              />
              </div>
              {toQuery && <button type="button" className="clear-field" aria-label="Effacer la destination" onClick={() => clearField("to")}><X size={16} /></button>}
              <button
                type="submit"
                disabled={!typed.trim() || planning || !atlas}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-sodium text-[#f0fdfa] transition-opacity disabled:opacity-30"
                aria-label={from && to ? tr("searchTrip") : "Rechercher un arrêt ou une ligne"}
              >
                <MagnifyingGlass size={15} weight="bold" />
              </button>
            </div>

            <div className="search-actions">
              <span><Clock size={15} /> Horaires du jour</span>
              <button type="button" onClick={swapPlaces} disabled={!fromQuery && !toQuery}><ArrowsDownUp size={16} /> Inverser</button>
            </div>
            {searchOpen && typed.trim() && deferredQuery === typed && hits.length === 0 && atlas && (
              <p className="feedback" role="status">Aucun résultat dans cette ville. Essaie un autre arrêt ou une ligne.</p>
            )}
            {searchOpen && typed.trim() && deferredQuery === typed && hits.length > 0 && (
              <ul ref={searchResults} className="search-results mt-2 divide-y divide-hairline" aria-label="Résultats de recherche" onKeyDown={navigateSearchResults}>
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
                        <MapPin size={16} className="text-muted" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{hit.stop.name}</span>
                          {(hit.stop.agencyId || hit.stop.code) && (
                            <span className="block text-[11px] text-muted">{stopDetail(hit.stop)}</span>
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
                        <MapPin size={16} className="text-sodium" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{hit.poi.name}</span>
                          <span className="block text-[11px] text-muted">
                            {hit.poi.category || "Lieu"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ) : (
                    <li key={`r-${hit.route.id}`}>
                      <button
                        type="button"
                        onClick={() => selectRoute(hit.route.id)}
                        className="flex w-full items-center gap-3 px-2 py-2.5 text-left"
                      >
                        <RouteBadge route={hit.route} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink/80">
                            {hit.route.longName || hit.route.shortName}
                          </span>
                          {hit.route.agencyId && (
                            <span className="block text-[11px] text-muted">{hit.route.agencyId}</span>
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
          </div>
        </form>

        <div className="journey-results" aria-live="polite" aria-busy={planning || departuresBusy}>
          {!selectedStop && !selectedRoute && !planning && !itineraries.length && !planError && (
            <section className="explore-section">
              <div className="section-heading"><h2>Explore le réseau</h2><span>{visit?.label || cities.find((item) => item.id === city)?.label}</span></div>
              <p>Choisis une ligne pour voir son parcours sur la carte.</p>
              <div className="route-grid">
                {exploreRoutes.map((route) => (
                  <button type="button" key={route.id} onClick={() => selectRoute(route.id)} title={route.longName || route.shortName}>
                    <RouteBadge route={route} /><span>{route.longName || route.shortName}</span><ArrowRight size={16} />
                  </button>
                ))}
              </div>
              <a className="atlas-link" href="/Transit/index.html">Ouvrir l’atlas complet <ArrowRight size={17} /></a>
            </section>
          )}
          <AnimatePresence mode="wait">
            {selectedStop && (
              <motion.section
                key={selectedStop.id}
                initial={reduce ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: 16 }}
                transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
                className="departure-section p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-medium tracking-tight">{selectedStop.name}</h2>
                    {(selectedStop.agencyId || selectedStop.code) && <p className="mt-1 text-sm text-muted">{stopDetail(selectedStop)}</p>}
                    <p className="mt-1 text-sm text-muted">{tr("remoteHint")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { clearDepartures(); setSelectedStop(null); }}
                    className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-well text-ink/70 transition-colors hover:bg-well-hi hover:text-ink"
                    aria-label={tr("close")}
                  >
                    <X size={14} />
                  </button>
                </div>
                <ul className="mt-4 space-y-3">
                  {departuresBusy && <li className="text-sm text-muted">Lecture des horaires…</li>}
                  {departureError && <li className="feedback">{departureError}<button type="button" className="retry-button" onClick={() => void openStop(selectedStop)}>Réessayer</button></li>}
                  {!departuresBusy && !departureError && departures.length === 0 && (
                    <li className="text-sm text-muted">{tr("noPassages")}</li>
                  )}
                  {departures.map((row) => (
                    <li key={`${row.routeId}-${row.headsign}`} className="flex items-center gap-3">
                      <span
                        className="inline-flex min-w-12 items-center justify-center rounded-full px-2 py-1 text-xs font-semibold"
                        style={{ background: row.color, color: row.textColor }}
                      >
                        {row.shortName}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{row.headsign}</p>
                        <p className="font-mono text-[11px] text-muted">
                          {(row.times && row.times.length > 0 ? row.times : [row.depart])
                            .slice(0, 5)
                            .map((t) => formatClock(t))
                            .join("  ")}
                          {row.agencyId ? `  ${row.agencyId}` : ""}
                        </p>
                      </div>
                      <span
                        className="departure-countdown"
                      >
                        {row.wait > 90 ? formatClock(row.depart) : formatRelative(row.wait)}
                      </span>
                    </li>
                  ))}
                </ul>
              </motion.section>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {(planning || itineraries.length > 0 || planError) && (
              <motion.section
                initial={reduce ? false : { opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: 18 }}
                transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
                className="detail-section p-5"
              >
                {planning && (
                  <p className="text-sm text-muted">Lecture des horaires…</p>
                )}
                {planError && <p className="text-sm text-ink">{planError}</p>}
                {itineraries.map((item) => {
                  const on = item.id === (chosen ?? itineraries[0]?.id);
                  const transit = item.legs.find((leg) => leg.kind === "transit");
                  return (
                    <button
                      key={item.id}
                      aria-pressed={on}
                      type="button"
                      onClick={() => setChosen(item.id)}
                      className={`mb-3 w-full rounded-[10px] p-4 text-left transition-colors last:mb-0 ${
                        on ? "bg-well ring-1 ring-sodium/40" : "bg-transparent hover:bg-well"
                      }`}
                    >
                      <div className="flex items-end justify-between">
                        <p className="text-3xl font-medium tracking-tight">
                          {item.minutes} min
                        </p>
                        <p className="text-xs text-muted">
                          {item.transfers === 0
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
                              {i > 0 && <ArrowRight size={12} className="text-muted" />}
                              <span
                                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                                style={{ background: leg.color, color: leg.textColor }}
                              >
                                {leg.shortName}
                              </span>
                              <span className="text-ink/75">
                                {leg.headsign}
                                {leg.agencyId ? ` · ${leg.agencyId}` : ""}
                              </span>
                            </span>
                          ),
                        )}
                      </div>
                      {transit && on && (
                        <p className="mt-3 font-mono text-[11px] text-muted">
                          {formatClock(transit.depart)} → {formatClock(transit.arrive)}
                          {atlas ? ` · ${atlas.meta.agencyId}` : ""}
                        </p>
                      )}
                    </button>
                  );
                })}
              </motion.section>
            )}
          </AnimatePresence>

          {selectedRoute && !selectedStop && itineraries.length === 0 && (
            <section className="detail-section p-5">
              <div className="section-heading"><h2>Parcours de la ligne</h2><button type="button" className="close-button" aria-label="Fermer le parcours" onClick={() => setSelectedRouteId(null)}><X size={18} /></button></div>
              <div className="flex items-center gap-3">
                <RouteBadge route={selectedRoute} />
                <div>
                  <h2 className="text-lg font-medium">{selectedRoute.shortName}</h2>
                  <p className="text-sm text-muted">{selectedRoute.longName}</p>
                </div>
              </div>
            </section>
          )}
        </div>

        <footer className="journey-footer"><span>Gratuit. Sans abonnement.</span><span>Horaires officiels · Rive</span></footer>
          </div>
        </aside>
        <div className="map-caption"><MapPin size={15} /><span>{visit?.label || cities.find((item) => item.id === city)?.label}</span><span>Bus · Métro · Marche</span></div>

      </div>

      {!atlas && !loadError && (
        <div className="loading-notice glass" role="status">
          <p className="text-sm text-muted">{tr("loading")}</p>
        </div>
      )}
      {loadError && (
        <div className="loading-notice glass" role="alert">
          <p className="max-w-sm text-sm text-ink">Impossible de charger ce réseau. {loadError} Choisis une autre ville ou <button className="retry-button" onClick={() => window.location.reload()}>réessaie</button>.</p>
        </div>
      )}
    </main>
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
