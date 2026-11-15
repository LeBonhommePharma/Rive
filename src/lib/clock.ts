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
export type Feed = { city: string; calendar: ServiceCalendar; first: string; last: string };

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

type SourceFeed = { agency: string; prefix: string };

function registryFeeds(city: string): SourceFeed[] {
  const path = join(process.cwd(), "src", "lib", "registry.json");
  let registry: { cities?: Array<{ id?: unknown; gtfs?: Array<{ agency?: unknown; prefix?: unknown }> }> };
  try {
    registry = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error("clock: cannot read src/lib/registry.json", { cause });
  }
  const row = (registry.cities || []).find((entry) => entry?.id === city);
  const feeds = (row?.gtfs || []).map((feed) => ({
    agency: String(feed?.agency || ""),
    prefix: typeof feed?.prefix === "string" ? feed.prefix : "",
  }));
  if (feeds.length === 0) {
    throw new Error(`clock: src/lib/registry.json lists no GTFS feeds for shipped city ${city}.`);
  }
  return feeds;
}

/**
 * One calendar per *source* feed, not per city.
 *
 * A city can merge several agencies (Québec = RTC + STLévis). Their
 * calendars move independently: RTC republishes forward-only, so its
 * past days vanish on every refresh while STLévis keeps a season-long
 * calendar. Judged as one merged calendar, a past day on which only
 * STLévis still runs clears the "half of peak" bar, and every RTC stop
 * the tests use (D'Youville, Youville) has no passage at all. That is
 * the exact failure that took the publish gate down from 2026-10-25.
 * Splitting by the registry's id prefix makes each agency prove a full
 * service on the chosen day by itself.
 */
export function sourceFeeds(city: string, calendar: ServiceCalendar): Feed[] {
  const sources = registryFeeds(city);
  const prefixes = sources
    .map((feed) => feed.prefix)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const owner = (id: string) => prefixes.find((prefix) => id.startsWith(prefix)) ?? "";

  return sources.map((source) => {
    const mine = (id: unknown) => owner(String(id)) === source.prefix;
    const slice: ServiceCalendar = {
      services: calendar.services.filter(mine),
      calendar: calendar.calendar.filter((row) => mine(row.id)),
      exceptions: calendar.exceptions.filter((row) => mine(row.id)),
    };
    const label = `${city}/${source.agency}`;
    if (slice.services.length === 0) {
      throw new Error(`clock: ${label} (prefix "${source.prefix}") ships no services in ${city}/atlas.json.`);
    }
    const range = coveredRange(slice);
    if (!range) {
      throw new Error(`clock: ${label} declares no service dates at all.`);
    }
    return { city: label, calendar: slice, first: range.first, last: range.last };
  });
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

/**
 * The working weekdays of ONE source feed, judged inside that feed's own
 * window against that feed's own busiest weekday.
 *
 * "Working" means the feed runs at least half as many services as it runs
 * on its own busiest weekday. That threshold is what rejects a ramp-in day,
 * a holiday, or a skeleton timetable without hard-coding which dates those
 * are.
 *
 * Each agency is judged alone. Agencies refresh on independent schedules
 * (in 2026-11 Montréal/RTL already ran 20270104.. while Sherbrooke/STS and
 * Québec/STLévis ended 20261220), so demanding one date shared by every
 * feed breaks on every refresh by construction. The bar is not lowered to
 * find a date: a feed with no weekday at half its own peak — in practice, a
 * feed with no weekday service at all — throws, by name.
 */
export function workingDaysOf(feed: Feed): Date[] {
  const weekdays: Array<{ day: Date; count: number }> = [];
  const stop = dayOf(feed.last).getTime();
  let scanned = 0;
  for (let day = dayOf(feed.first); day.getTime() <= stop; day = new Date(day.getTime() + MS_DAY)) {
    if (++scanned > MAX_SCAN_DAYS) break;
    const afternoon = at(day, AFTERNOON_UTC_HOURS);
    if (weekdayMon0(afternoon) > 4) continue;
    weekdays.push({ day, count: activeServiceIndexes(feed.calendar, afternoon).size });
  }

  const peak = weekdays.reduce((best, row) => Math.max(best, row.count), 0);
  const working = peak > 0 ? weekdays.filter((row) => row.count * 2 >= peak).map((row) => row.day) : [];
  if (working.length === 0) {
    throw new Error(
      `clock: ${feed.city} runs no full-service weekday inside its own window ${feed.first}..${feed.last}.`,
    );
  }
  return working;
}

/** The candidate day farthest from either edge of [first, last]. */
function farthestFromEdges(days: Date[], first: string, last: string): Date {
  const lo = dayOf(first).getTime();
  const hi = dayOf(last).getTime();
  let best = days[0];
  let bestMargin = -Infinity;
  for (const day of days) {
    const margin = Math.min(day.getTime() - lo, hi - day.getTime());
    if (margin > bestMargin) {
      best = day;
      bestMargin = margin;
    }
  }
  return best;
}

/** A working weekday for one source feed, as far from its own window's edges as possible. */
export function serviceDayOf(feed: Feed): Date {
  return farthestFromEdges(workingDaysOf(feed), feed.first, feed.last);
}

type Derived = { feed: Feed; working: Date[]; day: Date };

/**
 * Every shipped source feed gets its own service day. All feeds are
 * derived up front, and every feed that cannot produce one is named in a
 * single error, so a broken agency fails the suite even when no test
 * happens to exercise it.
 */
function deriveAll(): Map<string, Derived> {
  const cities = shippedCities();
  if (cities.length === 0) {
    throw new Error("clock: public/data/index.json lists no cities, so no service day can be derived.");
  }

  const derived = new Map<string, Derived>();
  const failures: string[] = [];
  for (const city of cities) {
    let feeds: Feed[];
    try {
      feeds = sourceFeeds(city, readCalendar(city));
    } catch (error) {
      failures.push((error as Error).message);
      continue;
    }
    for (const feed of feeds) {
      try {
        const working = workingDaysOf(feed);
        derived.set(feed.city, { feed, working, day: farthestFromEdges(working, feed.first, feed.last) });
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`clock: ${failures.length} shipped feed(s) have no usable test day:\n  ${failures.join("\n  ")}`);
  }
  return derived;
}

const DERIVED = deriveAll();

/** Every derived feed label ("city/agency"), in shipping order. */
export const SERVICE_FEEDS: readonly string[] = [...DERIVED.keys()];

function derivedFeed(feed: string): Derived {
  const row = DERIVED.get(feed);
  if (!row) {
    throw new Error(`clock: unknown feed "${feed}" — shipped feeds are ${SERVICE_FEEDS.join(", ")}.`);
  }
  return row;
}

/** The feed's derived service date as YYYYMMDD — handy when a schedule assertion fails. */
export function serviceDayStamp(feed: string): string {
  return stampOf(derivedFeed(feed).day);
}

/** Weekday afternoon in America/Montreal, on a full service day for that one source feed. */
export function daytimeClock(feed: string): Date {
  return at(derivedFeed(feed).day, AFTERNOON_UTC_HOURS);
}

/** Same service day for that feed, later — a given time that is not "now". */
export function eveningClock(feed: string): Date {
  return at(derivedFeed(feed).day, EVENING_UTC_HOURS);
}

/**
 * For a test whose itinerary genuinely crosses agencies (an STL bus into
 * the STM métro): a weekday that is a working day for EACH named feed by
 * that feed's own standard. Only the feeds the test actually rides are
 * joined — never every shipped feed — and if those feeds share no working
 * day the test cannot be run honestly on the shipped data, so this throws
 * naming them.
 */
export function jointDaytimeClock(feeds: readonly string[]): Date {
  if (feeds.length < 2) {
    throw new Error("clock: jointDaytimeClock needs at least two feeds — use daytimeClock(feed) for one.");
  }
  const rows = feeds.map(derivedFeed);
  const shared = rows
    .map((row) => new Set(row.working.map(stampOf)))
    .reduce((acc, set) => new Set([...acc].filter((stamp) => set.has(stamp))));
  if (shared.size === 0) {
    const windows = rows.map((row) => `${row.feed.city} ${row.feed.first}..${row.feed.last}`).join(", ");
    throw new Error(`clock: ${feeds.join(" + ")} share no full-service weekday (${windows}).`);
  }
  const first = rows.map((row) => row.feed.first).sort().at(-1) as string;
  const last = rows.map((row) => row.feed.last).sort()[0];
  const day = farthestFromEdges([...shared].sort().map(dayOf), first, last);
  return at(day, AFTERNOON_UTC_HOURS);
}
