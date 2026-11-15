import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Atlas } from "./atlas/types";
import {
  daytimeClock,
  jointDaytimeClock,
  SERVICE_FEEDS,
  serviceDayOf,
  serviceDayStamp,
  sourceFeeds,
  type Feed,
} from "./clock";
import { activeServiceIndexes } from "./services";

/*
 * Regression for the 2026-10-25 → 2026-11-08 red publish gate.
 *
 * Québec ships RTC (unprefixed, forward-only `<date>daily` services) merged
 * with STLévis (`stlevis:` prefix, season-long calendar rows). Judged as one
 * calendar, a past weekday on which only STLévis still ran looked like a full
 * service day, so the derived test clock landed on a day with zero RTC
 * passages and every D'Youville / Youville assertion failed.
 */

type Calendar = Pick<Atlas, "services" | "calendar" | "exceptions">;

const WEEK = [1, 1, 1, 1, 1, 0, 0];

function merged(): Calendar {
  return {
    services: ["20261110daily", "20261111daily", "stlevis:51", "stlevis:52"],
    calendar: [
      { id: "stlevis:51", start: "20260824", end: "20261220", days: WEEK },
      { id: "stlevis:52", start: "20260824", end: "20261220", days: WEEK },
    ],
    exceptions: [
      { id: "20261110daily", date: "20261110", type: 1 },
      { id: "20261111daily", date: "20261111", type: 1 },
    ],
  } as unknown as Calendar;
}

describe("derived service clock", () => {
  it("judges each merged agency on its own calendar, not the city's union", () => {
    const feeds = sourceFeeds("quebec", merged());
    assert.deepEqual(
      feeds.map((feed) => [feed.city, feed.first, feed.last]),
      [
        ["quebec/RTC", "20261110", "20261111"],
        ["quebec/STLévis", "20260824", "20261220"],
      ],
    );
    assert.deepEqual(feeds[0].calendar.services, ["20261110daily", "20261111daily"]);
    assert.deepEqual(feeds[1].calendar.services, ["stlevis:51", "stlevis:52"]);
  });

  it("fails loudly when a registered agency ships nothing, instead of quietly using the other one", () => {
    const onlyLevis = merged();
    onlyLevis.services = onlyLevis.services.filter((id) => id.startsWith("stlevis:"));
    onlyLevis.exceptions = [];
    assert.throws(() => sourceFeeds("quebec", onlyLevis), /quebec\/RTC .*ships no services/);
  });

  it("gives each agency its own day even when the feed windows do not overlap", () => {
    // The 2026-11 shape: RTL already on its winter feed while STS ended in December.
    const winter: Feed = {
      city: "montreal/RTL",
      first: "20270104",
      last: "20270404",
      calendar: {
        services: ["rtl:w"],
        calendar: [{ id: "rtl:w", start: "20270104", end: "20270404", days: WEEK }],
        exceptions: [],
      } as unknown as Calendar,
    };
    const fall: Feed = {
      city: "sherbrooke/STS",
      first: "20260622",
      last: "20261220",
      calendar: {
        services: ["f"],
        calendar: [{ id: "f", start: "20260622", end: "20261220", days: WEEK }],
        exceptions: [],
      } as unknown as Calendar,
    };
    const stamp = (day: Date) => day.toISOString().slice(0, 10).replace(/-/g, "");
    const w = stamp(serviceDayOf(winter));
    const f = stamp(serviceDayOf(fall));
    assert.ok(w >= winter.first && w <= winter.last, `RTL day ${w} outside its window`);
    assert.ok(f >= fall.first && f <= fall.last, `STS day ${f} outside its window`);
  });

  it("refuses a feed with no weekday service, by name, rather than lowering the bar", () => {
    const weekendOnly: Feed = {
      city: "sherbrooke/STS",
      first: "20261201",
      last: "20261220",
      calendar: {
        services: ["we"],
        calendar: [{ id: "we", start: "20261201", end: "20261220", days: [0, 0, 0, 0, 0, 1, 1] }],
        exceptions: [],
      } as unknown as Calendar,
    };
    assert.throws(() => serviceDayOf(weekendOnly), /sherbrooke\/STS runs no full-service weekday/);
  });

  it("refuses an unknown feed label instead of falling back to some other agency", () => {
    assert.throws(() => daytimeClock("montreal/nope"), /unknown feed "montreal\/nope"/);
    assert.throws(() => jointDaytimeClock(["montreal/STM"]), /at least two feeds/);
  });

  it("lands every shipped agency on a day on which that agency runs a full service", () => {
    const index = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "index.json"), "utf8")) as {
      cities: Array<{ city: string }>;
    };
    assert.ok(index.cities.length > 0, "index.json lists no cities");
    let checked = 0;
    for (const { city } of index.cities) {
      const atlas = JSON.parse(
        readFileSync(join(process.cwd(), "public", "data", city, "atlas.json"), "utf8"),
      ) as Atlas;
      for (const feed of sourceFeeds(city, atlas)) {
        checked++;
        assert.ok(SERVICE_FEEDS.includes(feed.city), `${feed.city} has no derived day`);
        const stamp = serviceDayStamp(feed.city);
        assert.ok(stamp >= feed.first && stamp <= feed.last, `${feed.city} day ${stamp} outside ${feed.first}..${feed.last}`);
        assert.ok(
          activeServiceIndexes(feed.calendar, daytimeClock(feed.city)).size > 0,
          `${feed.city} runs no service on its derived day ${stamp}`,
        );
      }
    }
    assert.equal(checked, SERVICE_FEEDS.length, "every registered feed must be derived — none skipped");
  });

  it("joins only the agencies a cross-agency ride uses, each at full service", () => {
    const clock = jointDaytimeClock(["montreal/STL", "montreal/STM"]);
    const atlas = JSON.parse(
      readFileSync(join(process.cwd(), "public", "data", "montreal", "atlas.json"), "utf8"),
    ) as Atlas;
    const feeds = sourceFeeds("montreal", atlas).filter((feed) => feed.city !== "montreal/RTL");
    assert.equal(feeds.length, 2);
    for (const feed of feeds) {
      assert.ok(activeServiceIndexes(feed.calendar, clock).size > 0, `${feed.city} idle on joint day`);
    }
  });
});
