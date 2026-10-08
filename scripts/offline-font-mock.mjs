#!/usr/bin/env node
/**
 * Offline `next build` helper (development/CI only — never used at runtime).
 *
 * Turbopack resolves `next/font/google` by fetching
 * https://fonts.googleapis.com/css2?family=... and then each font file. In a
 * sandbox or CI runner without outbound access to fonts.googleapis.com /
 * fonts.gstatic.com the build fails with
 * `Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'`.
 *
 * Turbopack supports a mock for the *stylesheet* only:
 *   NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/path/to/mock.json
 * where mock.json maps each exact stylesheet URL -> CSS text. Font files in that
 * CSS are still fetched over HTTP, so this script also serves a placeholder
 * .woff2 over http://127.0.0.1:<port>/.
 *
 * Usage:
 *   node scripts/offline-font-mock.mjs            # starts the font server, writes /tmp/font-mock/mock.json
 *   NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/tmp/font-mock/mock.json npm run build
 *
 * Keep this process running for the duration of the build.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.FONT_MOCK_PORT ?? 8765);
const OUT_DIR = process.env.FONT_MOCK_DIR ?? "/tmp/font-mock";
const BROWSER_UA_WEIGHTS = { Inter: "100..900", "JetBrains+Mono": "100..800" };
const DISPLAYS = ["swap", "optional"];

const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F";
const LATIN_EXT = "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF";

const face = (family, url, range) =>
  `@font-face { font-family: '${family}'; font-style: normal; font-weight: 100 900; ` +
  `font-display: swap; src: url(${url}) format('woff2'); unicode-range: ${range}; }`;

const stylesheetFor = (family, slug) =>
  `/* latin */\n${face(family, `http://127.0.0.1:${PORT}/${slug}-latin.woff2`, LATIN)}\n` +
  `/* latin-ext */\n${face(family, `http://127.0.0.1:${PORT}/${slug}-latin-ext.woff2`, LATIN_EXT)}`;

const mocked = {};
for (const [family, weights] of Object.entries(BROWSER_UA_WEIGHTS)) {
  const slug = family.replace("+", "-").toLowerCase();
  const css = stylesheetFor(family.replace("+", " "), slug);
  for (const axes of [`:wght@${weights}`, ""]) {
    for (const display of DISPLAYS) {
      mocked[`https://fonts.googleapis.com/css2?family=${family}${axes}&display=${display}`] = css;
    }
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const mockPath = path.join(OUT_DIR, "mock.json");
fs.writeFileSync(mockPath, JSON.stringify(mocked, null, 2));

// Minimal bytes: a real woff2 header would be nice but Turbopack only embeds them.
const FONT_BYTES = Buffer.concat([Buffer.from("wOF2", "ascii"), Buffer.alloc(2048)]);

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "font/woff2", "Content-Length": FONT_BYTES.length });
    res.end(FONT_BYTES);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`font-file server on http://127.0.0.1:${PORT}/`);
    console.log(`mock written to ${mockPath} (${Object.keys(mocked).length} stylesheet URLs)`);
    console.log(`run: NEXT_FONT_GOOGLE_MOCKED_RESPONSES=${mockPath} npm run build`);
  });
