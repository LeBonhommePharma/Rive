"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { version as maplibreVersion } from "maplibre-gl/package.json";
import type { FilterSpecification, GeoJSONSource, Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import type { Atlas, AtlasStop, CityId, Itinerary } from "@/lib/atlas/types";
import { decodePolyline } from "@/lib/geo";
import { accuracyCollection, accuracyLabel, type LocationFix } from "@/lib/location";
import {
  TRIP_ROAD_FILTER,
  TRIP_ROAD_PAINT,
  TRIP_TRANSIT_FILTER,
  TRIP_WALK_FILTER,
  itineraryCollection,
  mapPoint,
} from "@/lib/map-legs";

const STYLE = "https://tiles.openfreemap.org/styles/positron";

type Props = {
  city: CityId;
  atlas: Atlas | null;
  focus?: { lon: number; lat: number; zoom?: number; accuracy?: number } | null;
  position?: LocationFix | null;
  manualDeparture?: { lon: number; lat: number } | null;
  pickingLocation?: boolean;
  onPickLocation: (point: { lon: number; lat: number }) => void;
  onCancelPick: () => void;
  selectedStop?: AtlasStop | null;
  selectedRouteId?: string | null;
  itinerary?: Itinerary | null;
  onStop: (stop: AtlasStop) => void;
  onRoute: (routeId: string) => void;
};

type LineProps = {
  routeId: string;
  shortName: string;
  color: string;
  type: number;
  dir: number;
  kind: "metro" | "frequent" | "local";
};

function routeKind(type: number, shortName: string): LineProps["kind"] {
  if (type === 1) return "metro";
  if (/^80[0-7]/.test(shortName)) return "frequent";
  return "local";
}

function buildRouteCollection(atlas: Atlas): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const route of atlas.routes) {
    for (const dir of route.dirs) {
      const coords = decodePolyline(dir.line);
      if (coords.length < 2) continue;
      features.push({
        type: "Feature",
        properties: {
          routeId: route.id,
          shortName: route.shortName,
          color: route.color,
          type: route.type,
          dir: dir.id,
          kind: routeKind(route.type, route.shortName),
        } satisfies LineProps,
        geometry: { type: "LineString", coordinates: coords },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function buildStopCollection(atlas: Atlas): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: atlas.stops
      .filter((stop) => stop.kind !== 2)
      .map((stop) => ({
        type: "Feature" as const,
        properties: {
          id: stop.id,
          name: stop.name,
          kind: stop.kind,
          routes: stop.routes.join(","),
        },
        geometry: {
          type: "Point" as const,
          coordinates: [stop.lon, stop.lat],
        },
      })),
  };
}



export function MapView({
  city,
  atlas,
  focus,
  position,
  manualDeparture,
  pickingLocation = false,
  onPickLocation,
  onCancelPick,
  selectedStop,
  selectedRouteId,
  itinerary,
  onStop,
  onRoute,
}: Props) {
  const [mapDelayed, setMapDelayed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [viewportRevision, setViewportRevision] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const atlasRef = useRef(atlas);
  const onStopRef = useRef(onStop);
  const onRouteRef = useRef(onRoute);
  const pickingRef = useRef(pickingLocation);
  const cameraTarget = useRef<unknown>(null);

  useEffect(() => {
    atlasRef.current = atlas;
    onStopRef.current = onStop;
    onRouteRef.current = onRoute;
    pickingRef.current = pickingLocation;
  }, [atlas, onStop, onRoute, pickingLocation]);

  useEffect(() => {
    if (!rootRef.current || mapRef.current) return;
    maplibregl.setWorkerUrl(`/maplibre/${maplibreVersion}/maplibre-gl-worker.mjs`);
    const map = new maplibregl.Map({
      container: rootRef.current,
      style: STYLE,
      center: [-71.2082, 46.8131],
      zoom: 12.4,
      pitch: 0,
      attributionControl: false,
      fadeDuration: 0,
      locale: {
        "Map.Title": "Carte du réseau. Utilise les flèches pour te déplacer.",
        "NavigationControl.ZoomIn": "Agrandir la carte",
        "NavigationControl.ZoomOut": "Réduire la carte",
        "AttributionControl.ToggleAttribution": "Afficher les crédits de la carte",
      },
    });
    mapRef.current = map;
    let desktopViewport = window.innerWidth > 640;
    const adjustCamera = () => {
      const desktop = window.innerWidth > 640;
      if (desktop === desktopViewport) return;
      desktopViewport = desktop;
      cameraTarget.current = null;
      setViewportRevision((revision) => revision + 1);
    };
    // Reframe only after MapLibre has resized its canvas and projection.
    map.on("resize", adjustCamera);
    const slowMap = window.setTimeout(() => {
      if (!map.loaded()) setMapDelayed(true);
    }, 12000);
    map.on("idle", () => { window.clearTimeout(slowMap); setMapDelayed(false); });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("style.load", () => {
      map.addSource("rive-routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("rive-stops", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("rive-trip", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("rive-accuracy", { type: "geojson", data: accuracyCollection(null) });
      map.addLayer({
        id: "rive-accuracy-fill", type: "fill", source: "rive-accuracy",
        paint: { "fill-color": "#00A2FF", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "rive-accuracy-outline", type: "line", source: "rive-accuracy",
        paint: { "line-color": "#007ABF", "line-width": 1.5, "line-opacity": 0.65 },
      });

      map.addLayer({
        id: "rive-local",
        type: "line",
        source: "rive-routes",
        minzoom: 13,
        filter: ["==", ["get", "kind"], "local"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2.1,
          "line-opacity": 0.42,
        },
      });
      map.addLayer({
        id: "rive-frequent",
        type: "line",
        source: "rive-routes",
        minzoom: 11,
        filter: ["==", ["get", "kind"], "frequent"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3.4,
          "line-opacity": 0.86,
        },
      });
      map.addLayer({
        id: "rive-metro",
        type: "line",
        source: "rive-routes",
        minzoom: 10,
        filter: ["==", ["get", "kind"], "metro"],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 5.2,
          "line-opacity": 0.94,
        },
      });
      map.addLayer({
        id: "rive-selected-route",
        type: "line",
        source: "rive-routes",
        filter: ["==", ["get", "routeId"], ""],
        paint: {
          "line-color": "#FF9300",
          "line-width": 6.5,
          "line-opacity": 0.95,
          "line-blur": 0.4,
        },
      });
      map.addLayer({
        id: "rive-trip-walk",
        type: "line",
        source: "rive-trip",
        filter: TRIP_WALK_FILTER as FilterSpecification,
        paint: {
          "line-color": [
            "match",
            ["get", "kind"],
            "bike",
            "#34c759",
            "#8e8e93",
          ],
          "line-width": 3,
          "line-dasharray": [1.2, 1.6],
          "line-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "rive-trip-road",
        type: "line",
        source: "rive-trip",
        filter: TRIP_ROAD_FILTER as FilterSpecification,
        paint: { ...TRIP_ROAD_PAINT },
      });
      map.addLayer({
        id: "rive-trip-line",
        type: "line",
        source: "rive-trip",
        filter: TRIP_TRANSIT_FILTER as FilterSpecification,
        paint: {
          "line-color": ["get", "color"],
          "line-width": 6,
          "line-opacity": 0.96,
        },
      });
      map.addLayer({
        id: "rive-stations",
        type: "circle",
        source: "rive-stops",
        minzoom: 11,
        filter: ["==", ["get", "kind"], 1],
        paint: {
          "circle-radius": 5.5,
          "circle-color": "#f4f7f9",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#10161c",
        },
      });
      map.addLayer({
        id: "rive-stop-dots",
        type: "circle",
        source: "rive-stops",
        minzoom: 14,
        filter: ["==", ["get", "kind"], 0],
        paint: {
          "circle-radius": 3.4,
          "circle-color": "#e8eef2",
          "circle-stroke-width": 1.4,
          "circle-stroke-color": "#10161c",
          "circle-opacity": 0.92,
        },
      });

      const pick = (e: maplibregl.MapMouseEvent) => {
        if (pickingRef.current) return;
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ["rive-stop-dots", "rive-stations", "rive-metro", "rive-frequent", "rive-local"],
        });
        const stopHit = hits.find((f: MapGeoJSONFeature) => f.properties && "id" in f.properties);
        if (stopHit?.properties?.id) {
          const stop = atlasRef.current?.stops.find((s) => s.id === stopHit.properties!.id);
          if (stop) onStopRef.current(stop);
          return;
        }
        const routeHit = hits.find((f: MapGeoJSONFeature) => f.properties && "routeId" in f.properties);
        if (routeHit?.properties?.routeId) {
          onRouteRef.current(String(routeHit.properties.routeId));
        }
      };
      map.on("click", pick);
      for (const layer of ["rive-stop-dots", "rive-stations", "rive-metro", "rive-frequent"]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }
      setMapReady(true);
    });

    return () => {
      window.clearTimeout(slowMap);
      map.remove();
      mapRef.current = null;
      cameraTarget.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    (map.getSource("rive-routes") as GeoJSONSource)?.setData(atlas ? buildRouteCollection(atlas) : empty);
    (map.getSource("rive-stops") as GeoJSONSource)?.setData(atlas ? buildStopCollection(atlas) : empty);
  }, [atlas, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || pickingLocation || (!focus && !atlas)) return;
    // Loading a newly detected city's routes must not undo the position focus.
    const key = focus ?? city;
    if (cameraTarget.current === key) return;
    cameraTarget.current = key;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 800;
    if (focus && typeof focus.accuracy === "number") {
      const bounds = maplibregl.LngLatBounds.fromLngLat(new maplibregl.LngLat(focus.lon, focus.lat), Math.max(60, focus.accuracy));
      map.fitBounds(bounds, {
        padding: window.innerWidth > 640
          ? { top: 170, right: 70, bottom: 70, left: 430 }
          : { top: 155, right: 35, bottom: 100, left: 35 },
        maxZoom: 15.5, duration,
      });
    } else {
      map.easeTo({
        center: focus ? [focus.lon, focus.lat] : atlas!.meta.center,
        zoom: focus?.zoom ?? atlas?.meta.zoom ?? 13,
        offset: window.innerWidth > 640 ? [190, 0] : [0, 0],
        duration,
      });
    }
  }, [atlas, city, focus, mapReady, pickingLocation, viewportRevision]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource("rive-accuracy") as GeoJSONSource)?.setData(accuracyCollection(position ?? null));
    if (!position) return;
    const element = document.createElement("div");
    element.className = "user-location-marker";
    element.setAttribute("role", "img");
    const received = new Date(position.timestamp).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
    const label = `Position reçue à ${received}. ${accuracyLabel(position.accuracy)}.`;
    element.setAttribute("aria-label", label);
    element.title = label;
    const marker = new maplibregl.Marker({ element }).setLngLat([position.lon, position.lat]).addTo(map);
    return () => { marker.remove(); };
  }, [position, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !manualDeparture) return;
    const element = document.createElement("div");
    element.className = "manual-departure-marker";
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", "Départ choisi sur la carte");
    element.title = "Départ choisi sur la carte";
    const marker = new maplibregl.Marker({ element }).setLngLat([manualDeparture.lon, manualDeparture.lat]).addTo(map);
    return () => { marker.remove(); };
  }, [manualDeparture, mapReady]);

  useEffect(() => {
    if (!pickingLocation) return;
    mapRef.current?.stop();
    mapRef.current?.getCanvas().focus({ preventScroll: true });
  }, [pickingLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer("rive-selected-route")) return;
    map.setFilter("rive-selected-route", [
      "==",
      ["get", "routeId"],
      selectedRouteId || "",
    ]);
    if (!selectedRouteId || pickingRef.current) return;
    const route = atlas?.routes.find((entry) => entry.id === selectedRouteId);
    const coords = route?.dirs.flatMap((direction) => decodePolyline(direction.line)) ?? [];
    if (coords.length < 2) return;
    const bounds = coords.reduce(
      (extent, point) => extent.extend(point),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    );
    map.fitBounds(bounds, {
      padding: window.innerWidth > 640
        ? { top: 155, right: 90, bottom: 65, left: 440 }
        : { top: 145, right: 80, bottom: 110, left: 30 },
      maxZoom: 15,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
    });
  }, [atlas, selectedRouteId, mapReady, viewportRevision]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("rive-trip") as GeoJSONSource | undefined;
    source?.setData(itineraryCollection(itinerary ?? null));
    if (itinerary && map && !pickingRef.current) {
      const coords = itinerary.legs.flatMap((leg) => [mapPoint(leg.from), mapPoint(leg.to)]);
      if (coords.length) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(coords[0], coords[0]),
        );
        map.fitBounds(bounds, {
          padding: window.innerWidth > 640
            ? { top: 100, right: 80, bottom: 60, left: 440 }
            : { top: 90, right: 30, bottom: Math.min(window.innerHeight * 0.55, 420), left: 30 },
          duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 800,
          maxZoom: 14.6,
        });
      }
    }
  }, [itinerary, mapReady, viewportRevision]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStop || pickingRef.current) return;
    map.easeTo({
      center: [selectedStop.lon, selectedStop.lat],
      zoom: Math.max(map.getZoom(), 14.4),
      offset: window.innerWidth > 640 ? [190, 0] : [0, -window.innerHeight * 0.22],
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
    });
  }, [selectedStop, mapReady, viewportRevision]);

  return <>
    <div ref={rootRef} className="rive-map absolute inset-0" />
    {pickingLocation && <>
      <div className="map-picker-target" aria-hidden="true"><span /></div>
      <section className="map-picker glass" aria-label="Choisir le départ sur la carte">
        <p><strong>Place ton départ sous le repère.</strong><span>Déplace la carte avec le doigt, la souris ou les flèches.</span></p>
        <div>
          <button type="button" className="location-primary" disabled={!mapReady} onClick={() => {
            const map = mapRef.current;
            if (!map) return;
            const canvas = map.getCanvas();
            const point = map.unproject([canvas.clientWidth / 2, canvas.clientHeight / 2]).wrap();
            onPickLocation({ lon: point.lng, lat: point.lat });
          }}>Confirmer ce départ</button>
          <button type="button" onClick={onCancelPick}>Annuler</button>
        </div>
      </section>
    </>}
    {mapDelayed && <p className="map-loading-message" role="status">La carte met du temps à charger. La recherche reste disponible.</p>}
  </>;
}
