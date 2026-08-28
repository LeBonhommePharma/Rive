import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Atlas } from "./atlas/types";
import { activeServiceIndexes } from "./services";
import { weekdayMon0 } from "./time";

/* ------------------------------------------------------------------ *
 * Sky clocks — pinned, because the sky has no feed window.
 *
 * Where the sun and moon sit at a given instant is a fixed physical
 * fact. No GTFS refresh can move it, so the celestial fixtures pin an
 * absolute instant on purpose: those tests must go red when the
 * astronomy code changes and at no other time. 2026-08-18 is a
 * waxing-moon evening over Québec — moon above the horizon at 21:00
 * local, with both a moonrise and a moonset inside the local day.
 * Roughly a third of all dates fail those assertions, so this instant
 * must NOT be derived from anything that drifts.
 * ------------------------------------------------------------------ */

export const SKY_DAY_CLOCK = "2026-08-18T16:00:00-04:00";
export const SKY_NIGHT_CLOCK = "2026-08-18T23:30:00-04:00";
export const SKY_MOONLIGHT_CLOCK = "2026-08-18T21:00:00-04:00";

export function skyDayClock(): Date {
  return new Date(SKY_DAY_CLOCK);
}

export function skyNightClock(): Date {
  return new Date(SKY_NIGHT_CLOCK);
}

export function skyMoonlightClock(): Date {
  return new Date(SKY_MOONLIGHT_CLOCK);
}

/* ------------------------------------------------------------------ *
 * Service clocks — derived, because the feed window does drift.
 *
 * Every shipped feed is refreshed on its own schedule, so any absolute
 * service date is a date that must eventually fall outside the window
 * and take the publish gate down with it. Worse, a feed's *declared*
 * first day is the single worst date to sit on: it is the boundary the
 * agency reshapes on every refresh, and it routinely carries partial
 * service. So the service day is read out of the calendar the atlas
 * actually ships, and lands on a date the feed itself treats as an
 * ordinary working weekday.
 *
 * This derivation reads the calendar only. It never looks at stops,
 * trips or departures, so a feed that ships a normal-looking calendar
 * with no service at a real stop still fails the gate — which is the
 * whole point of the gate.
 * ------------------------------------------------------------------ */

type ServiceCalendar = Pick<Atlas, "services" | "calendar" | "exceptions">;
type Feed = { city: string; calendar: ServiceCalendar; first: string; last: string };

const MS_DAY = 86_400_000;
/** 20:00 UTC is mid-afternoon in Montréal under both EDT and EST. */
const AFTERNOON_UTC_HOURS = 20;
/** The next UTC midnight is still the same civil evening in Montréal. */
const EVENING_UTC_HOURS = 24;
/** A feed that claims a multi-year window is malformed; refuse to scan it forever. */
const MAX_SCAN_DAYS = 400;
const DAILY_SERVICE = /^(\d{8})daily$/;
const STAMP = /^\d{8}$/;

function dataDir(): string {
  return join(process.cwd(), "public", "data");
}

function stampOf(utcMidnight: Date): string {
  return utcMidnight.toISOString().slice(0, 10).replace(/-/g, "");
}

function dayOf(stamp: string): Date {
  return new Date(
    Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8))),
  );
}

function at(utcMidnight: Date, hours: number): Date {
  return new Date(utcMidnight.getTime() + hours * 3_600_000);
}

function shippedCities(): string[] {
  const index = JSON.parse(readFileSync(join(dataDir(), "index.json"), "utf8")) as {
    cities?: Array<{ city?: unknown }>;
  };
  return (index.cities || []).map((row) => String(row?.city || "")).filter(Boolean);
}

function readCalendar(city: string): ServiceCalendar {
  let atlas: Atlas;
  try {
    atlas = JSON.parse(readFileSync(join(dataDir(), city, "atlas.json"), "utf8")) as Atlas;
  } catch (cause) {
    throw new Error(`clock: cannot read public/data/${city}/atlas.json`, { cause });
  }
  return {
    services: atlas.services || [],
    calendar: atlas.calendar || [],
    exceptions: atlas.exceptions || [],
  };
}

/**
 * The dates this feed says anything at all about, read from the calendar
 * rows, the calendar_dates exceptions and the synthetic `<date>daily`
 * services — never from meta.start, which is the field that drifts.
 */
function coveredRange(calendar: ServiceCalendar): { first: string; last: string } | null {
  let first = "";
  let last = "";
  const note = (lo: string, hi: string) => {
    if (!STAMP.test(lo) || !STAMP.test(hi)) return;
    if (!first || lo < first) first = lo;
    if (!last || hi > last) last = hi;
  };
  for (const row of calendar.calendar) note(String(row.start), String(row.end));
  for (const row of calendar.exceptions) note(String(row.date), String(row.date));
  for (const id of calendar.services) {
    const daily = DAILY_SERVICE.exec(id);
    if (daily) note(daily[1], daily[1]);
  }
  return first && last ? { first, last } : null;
}

function windowsOf(feeds: Feed[]): string {
  return feeds.map((feed) => `${feed.city} ${feed.first}..${feed.last}`).join(", ");
}

/**
 * A working weekday shared by every shipped feed, as far from either edge
 * of the shared window as the calendars allow.
 *
 * "Working" means the feed runs at least half as many services as it runs
 * on its busiest weekday. That threshold is what rejects a ramp-in day, a
 * holiday, or a skeleton timetable without hard-coding which dates those
 * are.
 */
function deriveServiceDay(): Date {
  const cities = shippedCities();
  if (cities.length === 0) {
    throw new Error("clock: public/data/index.json lists no cities, so no service day can be derived.");
  }

  const feeds: Feed[] = cities.map((city) => {
    const calendar = readCalendar(city);
    const range = coveredRange(calendar);
    if (!range) {
      throw new Error(`clock: ${city}/atlas.json declares no service dates at all.`);
    }
    return { city, calendar, first: range.first, last: range.last };
  });

  const first = feeds.map((feed) => feed.first).sort().at(-1) as string;
  const last = feeds.map((feed) => feed.last).sort()[0];
  if (first > last) {
    throw new Error(`clock: the shipped feeds share no service date (${windowsOf(feeds)}).`);
  }

  const weekdays: Array<{ day: Date; counts: number[] }> = [];
  const stop = dayOf(last).getTime();
  let scanned = 0;
  for (let day = dayOf(first); day.getTime() <= stop; day = new Date(day.getTime() + MS_DAY)) {
    if (++scanned > MAX_SCAN_DAYS) break;
    const afternoon = at(day, AFTERNOON_UTC_HOURS);
    if (weekdayMon0(afternoon) > 4) continue;
    weekdays.push({
      day,
      counts: feeds.map((feed) => activeServiceIndexes(feed.calendar, afternoon).size),
    });
  }

  const peak = feeds.map((_, i) => weekdays.reduce((best, row) => Math.max(best, row.counts[i]), 0));
  const working = weekdays.filter((row) =>
    row.counts.every((count, i) => peak[i] > 0 && count * 2 >= peak[i]),
  );
  if (working.length === 0) {
    throw new Error(
      `clock: no weekday inside ${first}..${last} runs a full service in every shipped feed (${windowsOf(feeds)}).`,
    );
  }

  const lo = dayOf(first).getTime();
  const hi = dayOf(last).getTime();
  let best = working[0];
  let bestMargin = -1;
  for (const row of working) {
    const margin = Math.min(row.day.getTime() - lo, hi - row.day.getTime());
    if (margin > bestMargin) {
      best = row;
      bestMargin = margin;
    }
  }
  return best.day;
}

const SERVICE_DAY = deriveServiceDay();

/** The derived service date as YYYYMMDD — handy when a schedule assertion fails. */
export const SERVICE_DAY_STAMP = stampOf(SERVICE_DAY);

/** Weekday afternoon in America/Montreal, on a full service day in every shipped feed. */
export const DAYTIME_CLOCK = at(SERVICE_DAY, AFTERNOON_UTC_HOURS).toISOString();

/** Same service day, later — a given time that is not "now". */
export const EVENING_CLOCK = at(SERVICE_DAY, EVENING_UTC_HOURS).toISOString();

export function daytimeClock(): Date {
  return new Date(DAYTIME_CLOCK);
}

export function eveningClock(): Date {
  return new Date(EVENING_CLOCK);
}
