// Run with: node --test scripts/gtfs-refresh.test.mjs
// Kept beside the ingest rather than in src/lib: it tests scripts/, and the
// refresh workflow runs it before every ingest.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  EXIT_DEGRADED,
  EXIT_FAILED,
  EXIT_OK,
  ageDays,
  buildIndexPayload,
  curlArgs,
  describeRefreshFailure,
  formatAge,
  refreshFailureMessage,
  runExitCode,
  staleFeedRecord,
  summaryMarkdown,
} from "./gtfs-refresh.mjs";

const flagValue = (args, flag) => args[args.indexOf(flag) + 1];

test("curl bounds the connect, retries every error class, and waits between attempts", () => {
  const args = curlArgs("https://example.test/gtfs.zip", "/tmp/out.zip.part", 1234);
  assert.equal(flagValue(args, "--connect-timeout"), "30");
  assert.equal(flagValue(args, "--retry"), "5");
  assert.ok(args.includes("--retry-all-errors"));
  assert.equal(flagValue(args, "--retry-delay"), "30");
  assert.ok(args.includes("--fail"));
  assert.ok(args.includes("--no-progress-meter"));
  assert.ok(!args.includes("-s") && !args.includes("--silent"), "-s would hide the retry warnings");
  assert.equal(flagValue(args, "--max-filesize"), "1234");
  assert.equal(flagValue(args, "--proto"), "=https");
  assert.equal(flagValue(args, "--proto-redir"), "=https");
  assert.equal(flagValue(args, "-o"), "/tmp/out.zip.part");
  assert.equal(args.at(-1), "https://example.test/gtfs.zip");
});

test("curl failures are named by exit code, without paths or timestamps", () => {
  // A real execFileSync failure, not a hand-built one: a closed local port
  // gives curl exit 7 with no network involved.
  let real;
  try {
    execFileSync("curl", curlArgs("https://127.0.0.1:1/gtfs.zip", "/dev/null", 1).map((a) => (a === "5" ? "0" : a)), { stdio: "pipe" });
  } catch (error) {
    real = error;
  }
  assert.ok(real, "curl should have failed");
  assert.equal(refreshFailureMessage(real), "download failed: curl exit 7 (could not connect)");
  const timeout = Object.assign(new Error("Command failed: curl -o /home/runner/x/.cache/gtfs/stm.zip.part …"), { status: 28 });
  assert.equal(refreshFailureMessage(timeout), "download failed: curl exit 28 (timed out)");
  const unknown = Object.assign(new Error("Command failed: curl x"), { status: 99 });
  assert.equal(refreshFailureMessage(unknown), "download failed: curl exit 99");
  // Other commands keep their own message.
  const unzip = Object.assign(new Error("Command failed: unzip -Z1 a.zip"), { status: 9 });
  assert.equal(refreshFailureMessage(unzip), "Command failed: unzip -Z1 a.zip");
});

test("non-curl errors are one line, root-relative, bounded", () => {
  assert.equal(refreshFailureMessage(new Error("bad /r/a/b.txt\nstack"), "/r"), "bad a/b.txt");
  assert.equal(refreshFailureMessage(new Error("x".repeat(500))).length, 200);
  assert.equal(refreshFailureMessage(""), "unknown error");
});

test("age is measured against the caller's clock", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  assert.equal(ageDays("2026-09-24T12:00:00Z", now), 3);
  assert.equal(ageDays("not a date", now), null);
  assert.equal(formatAge("2026-09-27T07:00:00Z", now), "5 hours");
  assert.equal(formatAge("2026-09-20T00:00:00Z", now), "7.5 days");
  assert.equal(formatAge("garbage", now), "unknown age");
});

test("the staleness record carries an absolute fetch time, never an age", () => {
  const record = staleFeedRecord(
    { slug: "stm", agencyHint: "STM" },
    { status: "fallback", fetchedAt: "2026-09-20T00:00:00.000Z", message: "download failed: curl exit 28 (timed out)" },
  );
  assert.deepEqual(record, {
    agency: "STM",
    feed: "stm",
    fetchedAt: "2026-09-20T00:00:00.000Z",
    reason: "download failed: curl exit 28 (timed out)",
  });
  // Same fallback on the next run -> byte-identical record -> no commit churn.
  assert.equal(
    JSON.stringify(record),
    JSON.stringify(staleFeedRecord({ slug: "stm", agencyHint: "STM" }, { fetchedAt: record.fetchedAt, message: record.reason })),
  );
});

test("city failures name the feed and omit volatile detail", () => {
  assert.deepEqual(describeRefreshFailure("montreal", { slug: "rtl", agencyHint: "RTL", url: "https://r" }, "feed rtl unavailable"), {
    city: "montreal",
    feed: "rtl",
    agency: "RTL",
    url: "https://r",
    message: "feed rtl unavailable",
  });
});

test("a healthy index is unchanged; failures sit beside cities[]", () => {
  assert.deepEqual(Object.keys(buildIndexPayload("t", [{ city: "a" }])), ["builtAt", "cities"]);
  const withFailure = buildIndexPayload("t", [{ city: "a" }], [{ city: "b", message: "m" }]);
  assert.deepEqual(withFailure.refreshFailures, [{ city: "b", message: "m" }]);
  assert.deepEqual(withFailure.cities, [{ city: "a" }]);
});

const row = (status, extra = {}) => ({ city: "c", feed: `f-${status}`, status, ...extra });

test("exit code: fresh or deliberately cached is OK", () => {
  assert.equal(runExitCode({ citiesBuilt: 2, citiesSkipped: 0, feeds: [row("fresh"), row("cached")] }), EXIT_OK);
});

test("exit code: any fallback, failed feed or skipped city is DEGRADED, never OK", () => {
  assert.equal(runExitCode({ citiesBuilt: 2, citiesSkipped: 0, feeds: [row("fresh"), row("fallback")] }), EXIT_DEGRADED);
  assert.equal(runExitCode({ citiesBuilt: 1, citiesSkipped: 1, feeds: [row("fresh"), row("failed")] }), EXIT_DEGRADED);
  // A city skipped for a non-fetch reason (e.g. the coverage assert) is degraded too.
  assert.equal(runExitCode({ citiesBuilt: 1, citiesSkipped: 1, feeds: [row("fresh")] }), EXIT_DEGRADED);
});

test("exit code: nothing built is FAILED", () => {
  assert.equal(runExitCode({ citiesBuilt: 0, citiesSkipped: 4, feeds: [row("failed")] }), EXIT_FAILED);
  assert.equal(runExitCode(null), EXIT_FAILED);
});

test("the summary names stale feeds and their data age", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const md = summaryMarkdown(
    {
      citiesBuilt: 1,
      citiesSkipped: 1,
      feeds: [
        row("fresh", { city: "quebec", feed: "rtc", fetchedAt: "2026-09-27T12:00:00Z" }),
        row("fallback", { city: "montreal", feed: "stm", fetchedAt: "2026-09-24T12:00:00Z", message: "download failed: curl exit 28 (timed out)" }),
        row("failed", { city: "sherbrooke", feed: "sts", message: "download failed: curl exit 7 (could not connect)" }),
      ],
      cityFailures: [{ city: "sherbrooke", message: "feed sts unavailable" }],
    },
    now,
  );
  assert.match(md, /DEGRADED/);
  assert.match(md, /\| montreal \| stm \| \*\*FALLBACK \(stale\)\*\* \| 3\.0 days \|/);
  assert.match(md, /\| sherbrooke \| sts \| \*\*FAILED\*\* \|/);
  assert.match(md, /\*\*sherbrooke\*\* kept its previous atlas/);
});
