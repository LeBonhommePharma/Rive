import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";

it("ships the matching MapLibre worker and its sibling module for Next.js", () => {
  const sourcePackage = createRequire(import.meta.url).resolve("maplibre-gl/package.json");
  const { version } = JSON.parse(readFileSync(sourcePackage, "utf8"));
  const temporary = mkdtempSync(join(tmpdir(), "rive-worker-test-"));
  try {
    execFileSync(process.execPath, [join(process.cwd(), "scripts/copy-maplibre-worker.mjs")], { cwd: temporary });
    const destination = join(temporary, "public", "maplibre", version);
    for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
      assert.deepEqual(readFileSync(join(destination, file)), readFileSync(join(dirname(sourcePackage), "dist", file)));
    }
    assert.match(readFileSync(join(destination, "maplibre-gl-worker.mjs"), "utf8"), /\.\/maplibre-gl-shared\.mjs/);
    assert.ok(readFileSync(join(destination, "LICENSE.txt")).length > 0);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
