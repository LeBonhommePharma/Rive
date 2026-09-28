/**
 * Refresh-outcome bookkeeping for the GTFS ingest. Import-safe: no network,
 * no writes, so every rule here is testable without touching an agency host.
 *
 * Each feed ends a run in exactly one state:
 *
 *   fresh    — fetched from the agency this run and validated.
 *   cached   — not fetched (no --force); the local archive was reused on
 *              purpose. Local development only; CI always runs --force.
 *   fallback — the fetch failed, so the last good archive was used instead.
 *              The atlas is valid but may be out of date, and says so.
 *   failed   — the fetch failed and there was no last good archive.
 *
 * A city is only rebuilt when every one of its feeds has usable data. One
 * `failed` feed leaves that city's previous atlas on disk untouched: a stale
 * complete city beats a fresh amputated one, because a rider searching an RTL
 * stop in a Montréal atlas with RTL dropped would get "no such stop" rather
 * than "not refreshed". (Design carried forward from 559ce02.)
 */

const MAX_MESSAGE = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Exit codes for scripts/ingest-gtfs.mjs. */
export const EXIT_OK = 0;
/** Nothing was written: our breakage or a dead network, not one agency. */
export const EXIT_FAILED = 1;
/** An atlas was written, but at least one feed is not fresh. */
export const EXIT_DEGRADED = 3;

/**
 * curl flags for one official archive.
 *
 * --connect-timeout 30   An unreachable host fails in 30 s instead of the
 *                        kernel's ~135 s SYN timeout (observed on STM).
 * --retry 5 --retry-all-errors
 *                        Plain --retry only retries curl's "transient" set
 *                        (timeouts, 408/429/5xx). --retry-all-errors extends
 *                        it to everything, including refused connections, DNS
 *                        and TLS failures and 4xx such as RTL's 403.
 * --retry-delay 30       Fixed 30 s between attempts. The old default backoff
 *                        was 1, 2, 4 s — 7 s in total, useless against an
 *                        outage. A fixed delay also disables that backoff.
 * --speed-limit/-time    A connection that stalls mid-transfer (<1 KB/s for
 *                        60 s) is abandoned and retried, so a slow-loris body
 *                        cannot hang the job either.
 * --no-progress-meter    Keeps CI logs readable. Unlike -s it still prints the
 *                        "Will retry in 30 seconds" lines.
 *
 * Worst case for a dead host: 6 attempts x 30 s + 5 x 30 s ≈ 5.5 min.
 */
export function curlArgs(url, outPath, maxBytes) {
  return [
    "-L",
    "--fail",
    "--no-progress-meter",
    "--connect-timeout", "30",
    "--retry", "5",
    "--retry-all-errors",
    "--retry-delay", "30",
    "--speed-limit", "1024",
    "--speed-time", "60",
    "--max-filesize", String(maxBytes),
    "--proto", "=https",
    "--proto-redir", "=https",
    "-o", outPath,
    url,
  ];
}

const CURL_EXIT_NAMES = {
  6: "could not resolve host",
  7: "could not connect",
  22: "HTTP error response",
  28: "timed out",
  35: "TLS handshake failed",
  56: "connection reset while receiving",
  60: "TLS certificate rejected",
  63: "archive larger than the size cap",
};

/**
 * One line, absolute paths stripped, length bounded.
 *
 * Deliberately carries no timestamp: a repeated outage must produce a
 * byte-identical record so the refresh workflow's "unchanged" check keeps
 * holding and a dead feed cannot churn a commit every six hours.
 */
export function refreshFailureMessage(error, root = "") {
  // execFileSync failures carry the exit code in `status` and the command line
  // in the message ("Command failed: curl …"); they do not carry spawnargs.
  const status = error && typeof error === "object" ? error.status : undefined;
  const isCurl = error instanceof Error && error.message.startsWith("Command failed: curl ");
  if (isCurl && Number.isInteger(status)) {
    const name = CURL_EXIT_NAMES[status];
    return `download failed: curl exit ${status}${name ? ` (${name})` : ""}`;
  }
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const line = raw.split("\n", 1)[0].trim();
  const trimmed = root ? line.replaceAll(`${root}/`, "") : line;
  if (!trimmed) return "unknown error";
  return trimmed.length > MAX_MESSAGE ? `${trimmed.slice(0, MAX_MESSAGE - 3)}...` : trimmed;
}

/** Whole days, one decimal, never negative. */
export function ageDays(fetchedAt, now = Date.now()) {
  const then = Date.parse(fetchedAt);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.round(((now - then) / DAY_MS) * 10) / 10);
}

/** "3.2 days" / "5 hours" — for logs and the job summary, never for the atlas. */
export function formatAge(fetchedAt, now = Date.now()) {
  const then = Date.parse(fetchedAt);
  if (!Number.isFinite(then)) return "unknown age";
  const hours = Math.max(0, (now - then) / (60 * 60 * 1000));
  if (hours < 48) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  return `${(hours / 24).toFixed(1)} days`;
}

/**
 * The staleness record stamped into a city's meta for every fallback feed.
 *
 * It carries the absolute time the archive was last fetched successfully, not
 * an age: an age would change every run and churn a commit every six hours,
 * while `fetchedAt` stays byte-identical for as long as the same fallback is
 * in use. Consumers compute the age against their own clock.
 */
export function staleFeedRecord(feed, outcome) {
  return {
    agency: String(feed.agencyHint || ""),
    feed: String(feed.slug || ""),
    fetchedAt: outcome.fetchedAt || null,
    reason: outcome.message || "unknown error",
  };
}

/** A published record of one city that could not be rebuilt at all. */
export function describeRefreshFailure(city, feed, error, root = "") {
  const record = { city: String(city || "unknown") };
  if (feed && typeof feed === "object") {
    if (feed.slug) record.feed = String(feed.slug);
    if (feed.agencyHint) record.agency = String(feed.agencyHint);
    if (feed.url) record.url = String(feed.url);
  }
  record.message = typeof error === "string" ? error : refreshFailureMessage(error, root);
  return record;
}

/**
 * The index.json payload.
 *
 * `cities[]` keeps its invariant — every entry has an atlas on disk and is
 * loadable — so skipped cities are published beside it, not inside it. The
 * key is omitted when nothing failed, so a healthy index is byte-identical to
 * one written before this existed. Fallback staleness lives in each city's
 * own meta (`staleFeeds`), which cities[] already mirrors.
 */
export function buildIndexPayload(builtAt, cities, failures = []) {
  const rows = (Array.isArray(failures) ? failures : []).filter(Boolean);
  return {
    builtAt,
    ...(rows.length ? { refreshFailures: rows } : {}),
    cities: Array.isArray(cities) ? cities : [],
  };
}

/**
 * Exit code for a finished run.
 *
 * Nothing built -> EXIT_FAILED. Anything short of every feed fresh (or
 * deliberately cached) -> EXIT_DEGRADED. The workflow commits whatever did
 * refresh BEFORE it acts on this code, so a red run still ships the healthy
 * cities — red here means "a human should look", not "nothing shipped".
 */
export function runExitCode(report) {
  if (!report || report.citiesBuilt === 0) return EXIT_FAILED;
  const degraded = report.feeds.some((row) => row.status === "fallback" || row.status === "failed");
  if (degraded || report.citiesSkipped > 0) return EXIT_DEGRADED;
  return EXIT_OK;
}

/** Markdown for $GITHUB_STEP_SUMMARY. */
export function summaryMarkdown(report, now = Date.now()) {
  const lines = [];
  const code = runExitCode(report);
  if (code === EXIT_OK) {
    lines.push("### GTFS refresh: all feeds fresh", "");
  } else if (code === EXIT_DEGRADED) {
    lines.push("### ⚠️ GTFS refresh: DEGRADED — not every feed is fresh", "");
  } else {
    lines.push("### ❌ GTFS refresh failed — no city could be rebuilt", "");
  }
  lines.push("| City | Feed | Status | Data age | Detail |", "| --- | --- | --- | --- | --- |");
  for (const row of report.feeds) {
    const age = row.fetchedAt ? formatAge(row.fetchedAt, now) : "—";
    const status = row.status === "fallback" ? "**FALLBACK (stale)**" : row.status === "failed" ? "**FAILED**" : row.status;
    lines.push(`| ${row.city} | ${row.feed} | ${status} | ${row.status === "fresh" ? "just fetched" : age} | ${row.message || ""} |`);
  }
  for (const row of report.cityFailures || []) {
    lines.push("", `- **${row.city}** kept its previous atlas: ${row.message}`);
  }
  if (code === EXIT_DEGRADED) {
    lines.push(
      "",
      "Fallback feeds were rebuilt from their last good archive. Their city's",
      "`meta.staleFeeds` in `public/data/<city>/meta.json` and `index.json` records",
      "when that archive was fetched. Skipped cities are listed in `refreshFailures`.",
      "Cities that refreshed normally were committed before this run was marked failed.",
    );
  }
  return `${lines.join("\n")}\n`;
}
