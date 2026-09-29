import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// MapLibre 6's module worker imports its sibling shared module. Next.js does
// not emit that pair automatically; serve both from the installed version.
const packagePath = createRequire(import.meta.url).resolve("maplibre-gl/package.json");
const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
const source = join(dirname(packagePath), "dist");
const destination = join(process.cwd(), "public", "maplibre", version);
mkdirSync(destination, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(source, file), join(destination, file));
}
copyFileSync(join(dirname(packagePath), "LICENSE.txt"), join(destination, "LICENSE.txt"));
