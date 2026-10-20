/**
 * Test bootstrap for the research suites.
 *
 * Imported FIRST by every research test file so that:
 *   1. the file store points at a scratch directory (never the
 *      real data/) and the repository selects the file backend
 *      before any module reads process.env;
 *   2. the `@/` path alias — which Next.js resolves at build time
 *      but plain `node` cannot — is mapped onto the compiled
 *      output tree, so the service/job layers can be exercised
 *      end to end without a bundler.
 *
 * The alias hook is a process-local CJS resolver patch, the same
 * technique module-alias/tsconfig-paths use. It only ever runs in
 * the node --test harness.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";

if (!process.env.TC_DATA_DIR) {
  process.env.TC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tc-research-test-"));
}
// Force the JSON file backend so tests never need a database.
process.env.DATA_BACKEND = "file";
// A throwaway key so provider resolution succeeds in tests; it is
// never sent anywhere because the fetch implementation is faked.
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key-not-real";

// ---- resolve "@/..." onto the compiled output tree ----
// This file compiles to output/research-js/lib/research/testSetup.js,
// so the output root (output/research-js) is two levels up.
const OUTPUT_ROOT = path.resolve(__dirname, "..", "..");
type Resolve = (this: unknown, request: string, ...rest: unknown[]) => string;
const moduleAny = Module as unknown as { _resolveFilename: Resolve };
const originalResolveFilename = moduleAny._resolveFilename;
moduleAny._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(OUTPUT_ROOT, request.slice(2)), ...rest);
  }
  return originalResolveFilename.call(this, request, ...rest);
} as Resolve;
