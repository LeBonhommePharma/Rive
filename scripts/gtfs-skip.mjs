/**
 * City-scoped refresh failures. Import-safe: no network, no writes.
 *
 * One agency's outage must not freeze the cities that do not use it. When a
 * city cannot be rebuilt, the ingest leaves that city's last good atlas alone
 * and records why here, so the published index carries the gap instead of
 * hiding it. A city that is absent without explanation is as bad as a stale
 * one that looks fresh.
 */

const MAX_MESSAGE = 200;

/**
 * One line, absolute paths stripped, length bounded.
 *
 * Deliberately carries no timestamp: a repeated outage must produce a
 * byte-identical record so the refresh workflow's "unchanged" check keeps
 * holding and a dead feed cannot churn a commit every six hours.
 */
export function refreshFailureMessage(error, root = "") {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const line = raw.split("\n", 1)[0].trim();
  const trimmed = root ? line.replaceAll(`${root}/`, "") : line;
  if (!trimmed) return "unknown error";
  return trimmed.length > MAX_MESSAGE ? `${trimmed.slice(0, MAX_MESSAGE - 3)}...` : trimmed;
}

/** A published record of one city's failed refresh, naming the feed that broke. */
export function describeRefreshFailure(city, feed, error, root = "") {
  const record = { city: String(city || "unknown") };
  if (feed && typeof feed === "object") {
    if (feed.slug) record.feed = String(feed.slug);
    if (feed.agencyHint) record.agency = String(feed.agencyHint);
    if (feed.url) record.url = String(feed.url);
  }
  record.message = refreshFailureMessage(error, root);
  return record;
}

/**
 * The index.json payload.
 *
 * `cities[]` keeps its invariant — every entry has an atlas on disk and is
 * loadable — so failures are published beside it rather than inside it. A
 * skipped city that still has a previous build stays in `cities[]` and is
 * named in `refreshFailures`; one that has never been built appears only in
 * `refreshFailures`. Either way it is visible.
 *
 * The key is omitted entirely when nothing failed, so a healthy index is
 * unchanged from before this existed.
 */
export function buildIndexPayload(builtAt, cities, failures = []) {
  const rows = (Array.isArray(failures) ? failures : []).filter(Boolean);
  return {
    builtAt,
    ...(rows.length ? { refreshFailures: rows } : {}),
    cities: Array.isArray(cities) ? cities : [],
  };
}
