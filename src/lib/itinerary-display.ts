import type { Itinerary, TripLeg } from "./atlas/types";
import { formatMeters } from "./geo";
import { formatClock } from "./time";

export type TransitLeg = Extract<TripLeg, { kind: "transit" }>;

export type DisplayStep =
  | {
      kind: "walk";
      minutes: number;
      meters: number;
      label: string;
    }
  | {
      kind: "bike";
      minutes: number;
      meters: number;
      label: string;
      system: "avelo" | "bixi";
    }
  | {
      kind: "road";
      minutes: number;
      meters: number;
      label: string;
    }
  | {
      kind: "transit";
      minutes: number;
      shortName: string;
      color: string;
      textColor: string;
      headsign: string;
      agencyId?: string;
      depart: number;
      arrive: number;
      fromLabel: string;
      toLabel: string;
      clocks: string[];
    };

function placeLabel(place: { label?: string; name?: string } | null | undefined): string {
  if (!place || typeof place !== "object") return "";
  if (typeof place.label === "string" && place.label) return place.label;
  if (typeof place.name === "string" && place.name) return place.name;
  return "";
}

function transitStep(leg: TransitLeg): DisplayStep {
  return {
    kind: "transit",
    minutes: leg.minutes,
    shortName: leg.shortName,
    color: leg.color,
    textColor: leg.textColor,
    headsign: leg.headsign,
    agencyId: leg.agencyId,
    depart: leg.depart,
    arrive: leg.arrive,
    fromLabel: placeLabel(leg.from),
    toLabel: placeLabel(leg.to),
    clocks: [formatClock(leg.depart), formatClock(leg.arrive)],
  };
}

export function itinerarySteps(itinerary: Itinerary | null | undefined): DisplayStep[] {
  if (!itinerary || !Array.isArray(itinerary.legs)) return [];
  const steps: DisplayStep[] = [];
  for (const leg of itinerary.legs) {
    switch (leg.kind) {
      case "walk":
        steps.push({
          kind: "walk",
          minutes: leg.minutes,
          meters: leg.meters,
          label: `Marche ${formatMeters(leg.meters) || `${leg.minutes} min`}`,
        });
        break;
      case "bike":
        steps.push({
          kind: "bike",
          minutes: leg.minutes,
          meters: leg.meters,
          system: leg.system,
          label: `${leg.system === "avelo" ? "àVélo" : "BIXI"} ${formatMeters(leg.meters) || `${leg.minutes} min`}`,
        });
        break;
      case "road":
        steps.push({
          kind: "road",
          minutes: leg.minutes,
          meters: leg.meters,
          label: `Auto ${formatMeters(leg.meters) || `${leg.minutes} min`}`,
        });
        break;
      case "transit":
        steps.push(transitStep(leg));
        break;
      default: {
        const _never: never = leg;
        void _never;
        break;
      }
    }
  }
  return steps;
}

export function transitLegsOf(itinerary: Itinerary | null | undefined): TransitLeg[] {
  if (!itinerary) return [];
  return itinerary.legs.filter((leg): leg is TransitLeg => leg.kind === "transit");
}

export function itineraryHasTransfer(itinerary: Itinerary | null | undefined): boolean {
  if (!itinerary) return false;
  return itinerary.transfers > 0 || transitLegsOf(itinerary).length > 1;
}
