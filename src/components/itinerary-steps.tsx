import { PersonSimpleWalk } from "@phosphor-icons/react";
import type { Itinerary } from "@/lib/atlas/types";
import { itinerarySteps, type DisplayStep } from "@/lib/itinerary-display";
import { LineChip } from "@/components/line-chip";

function AccessMark({ step }: { step: Extract<DisplayStep, { kind: "walk" | "bike" | "road" }> }) {
  switch (step.kind) {
    case "walk":
      return (
        <span className="rive-access">
          <PersonSimpleWalk size={14} />
          {step.minutes} min
        </span>
      );
    case "bike":
      return <span className="rive-access">{step.system === "avelo" ? "àVélo" : "BIXI"} {step.minutes} min</span>;
    case "road":
      return <span className="rive-access">Auto {step.minutes} min</span>;
    default: {
      const _never: never = step;
      return _never;
    }
  }
}

function StepRow({ step }: { step: DisplayStep }) {
  switch (step.kind) {
    case "walk":
    case "bike":
    case "road":
      return (
        <li className="rive-step">
          <AccessMark step={step} />
          <div>
            <p>{step.label}</p>
          </div>
        </li>
      );
    case "transit":
      return (
        <li className="rive-step">
          <LineChip shortName={step.shortName} color={step.color} textColor={step.textColor} />
          <div>
            <p>
              {step.headsign}
              {step.agencyId ? ` · ${step.agencyId}` : ""}
            </p>
            <p className="rive-clocks">
              {step.clocks.join("  →  ")}
              {step.fromLabel && step.toLabel ? `  ·  ${step.fromLabel} → ${step.toLabel}` : ""}
            </p>
          </div>
        </li>
      );
    default: {
      const _never: never = step;
      return _never;
    }
  }
}

export function ItinerarySteps({ itinerary }: { itinerary: Itinerary }) {
  const steps = itinerarySteps(itinerary);
  if (steps.length === 0) return null;
  return (
    <ol className="rive-steps">
      {steps.map((step, index) => (
        <StepRow key={`${step.kind}-${index}`} step={step} />
      ))}
    </ol>
  );
}
