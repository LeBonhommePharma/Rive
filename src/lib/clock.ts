import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Pick a weekday inside the newest tracked feed window so refreshes keep the fixtures valid. */
function fixtureDay(): { year: number; month: number; day: number } {
  let yyyymmdd = "20260818";
  try {
    const index = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "index.json"), "utf8")) as {
      cities?: Array<{ start?: unknown }>;
    };
    const starts = (index.cities || [])
      .map((city) => String(city.start || ""))
      .filter((value) => /^\d{8}$/.test(value));
    if (starts.length) yyyymmdd = starts.sort().at(-1) || yyyymmdd;
  } catch {
    /* Keep the stable fallback when the helper is imported outside the repo. */
  }
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() + 2);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const FIXTURE_DAY = fixtureDay();
const utc = (dayOffset: number, hour: number, minute = 0) =>
  new Date(Date.UTC(FIXTURE_DAY.year, FIXTURE_DAY.month - 1, FIXTURE_DAY.day + dayOffset, hour, minute)).toISOString();

/** Weekday afternoon in America/Montreal, inside the newest tracked feed window. */
export const DAYTIME_CLOCK = utc(0, 20);

/** Same service day, later — a given time that is not "now". */
export const EVENING_CLOCK = utc(1, 0);

/** Same civil day, after local nightfall. */
export const NIGHT_CLOCK = utc(1, 3, 30);

/** Same civil day, after sunset and before moonset. */
export const MOONLIGHT_CLOCK = utc(1, 1);

export function daytimeClock(): Date {
  return new Date(DAYTIME_CLOCK);
}

export function eveningClock(): Date {
  return new Date(EVENING_CLOCK);
}

export function nightClock(): Date {
  return new Date(NIGHT_CLOCK);
}

export function moonlightClock(): Date {
  return new Date(MOONLIGHT_CLOCK);
}
