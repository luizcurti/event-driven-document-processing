import { build } from "esbuild";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const entryPoints = globSync("src/functions/*.ts", { cwd: rootDir }).map((file) =>
  path.join(rootDir, file)
);

await build({
  entryPoints,
  outdir: path.join(rootDir, "dist/functions"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  logLevel: "info",
  // The Lambda Node.js runtime ships the AWS SDK v3 pre-installed; everything
  // else we depend on (prom-client, etc.) must be bundled into the artifact.
  external: ["@aws-sdk/*"]
});
