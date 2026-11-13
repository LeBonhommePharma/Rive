import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Atlas } from "./atlas/types";
import { daytimeClock, SERVICE_DAY_STAMP, sourceFeeds } from "./clock";
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

  it("lands on a day on which every agency of every shipped city runs", () => {
    const index = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "index.json"), "utf8")) as {
      cities: Array<{ city: string }>;
    };
    const clock = daytimeClock();
    assert.ok(index.cities.length > 0, "index.json lists no cities");
    let checked = 0;
    for (const { city } of index.cities) {
      const atlas = JSON.parse(
        readFileSync(join(process.cwd(), "public", "data", city, "atlas.json"), "utf8"),
      ) as Atlas;
      for (const feed of sourceFeeds(city, atlas)) {
        checked++;
        assert.ok(
          activeServiceIndexes(feed.calendar, clock).size > 0,
          `${feed.city} runs no service on derived day ${SERVICE_DAY_STAMP}`,
        );
      }
    }
    assert.ok(checked > index.cities.length - 1, `checked ${checked} feeds — expected at least one per city`);
  });
});
