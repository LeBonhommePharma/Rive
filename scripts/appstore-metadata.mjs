#!/usr/bin/env node
// Checks the App Store Connect character limits of the metadata in ios/APP_STORE.md.
//
// Every fenced block whose info string carries `max=<n>` is measured. Lengths are
// counted in Unicode code points, which is what App Store Connect counts. A block
// with `field=keywords.*` is also checked for wasted spaces after commas.
//
//   node scripts/appstore-metadata.mjs            # report and exit 1 on any violation
//   node scripts/appstore-metadata.mjs --quiet    # only print violations

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] && !process.argv[2].startsWith("--")
  ? path.resolve(process.argv[2])
  : path.join(root, "ios", "APP_STORE.md");
const quiet = process.argv.includes("--quiet");

const source = readFileSync(file, "utf8");
const fence = /^```([^\n]*)\n([\s\S]*?)\n```$/gm;

let failures = 0;
let checked = 0;
for (const match of source.matchAll(fence)) {
  const info = match[1].trim();
  const max = /\bmax=(\d+)\b/.exec(info);
  if (!max) continue;
  const field = /\bfield=([^\s]+)/.exec(info)?.[1] ?? "(unnamed)";
  const limit = Number(max[1]);
  const text = match[2].replace(/\r/g, "");
  const length = Array.from(text).length;
  const problems = [];
  if (length > limit) problems.push(`exceeds limit by ${length - limit}`);
  if (/^\s|\s$/.test(text)) problems.push("leading or trailing whitespace");
  if (field.startsWith("keywords") && /,\s|\s,/.test(text)) {
    problems.push("spaces around commas count against the 100-character keyword limit");
  }
  if (field.startsWith("keywords") && /\n/.test(text)) problems.push("keywords must be one line");
  checked += 1;
  const status = problems.length ? "FAIL" : "ok  ";
  if (problems.length) failures += 1;
  if (!quiet || problems.length) {
    console.log(`${status} ${field.padEnd(24)} ${String(length).padStart(4)}/${limit}${problems.length ? "  " + problems.join("; ") : ""}`);
  }
}

if (checked === 0) {
  console.error(`No fenced block with max=<n> found in ${file}`);
  process.exit(2);
}
if (failures) {
  console.error(`${failures} of ${checked} metadata fields violate App Store Connect limits.`);
  process.exit(1);
}
if (!quiet) console.log(`All ${checked} metadata fields are within their limits.`);
