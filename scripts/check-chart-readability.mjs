/** Optional browser regression: npm install --no-save --package-lock=false playwright @sparticuz/chromium.
 * Use a dedicated demo data directory; changes presentation preferences only, never submits orders. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import packed from '@sparticuz/chromium';
const base = process.env.TC_PREVIEW_URL ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch({ executablePath: await packed.executablePath(), args: packed.args, headless: true });
const page = await browser.newPage({ viewport: { width: 1568, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const request = (workspace, path, body) => page.evaluate(async ({ workspace, path, body }) => {
  const token = sessionStorage.getItem('tc_preview_session');
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: {
    'content-type': 'application/json', 'x-tc-workspace': workspace,
    ...(token ? { 'X-TC-Preview-Session': token } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}, { workspace, path, body });
async function noOverlap() {
  const bounds = await page.locator('.chart-context > section').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
  }));
  for (let i = 1; i < bounds.length; i++) {
    const a = bounds[i - 1], b = bounds[i];
    if (a.left < b.right && b.left < a.right) assert.ok(a.bottom <= b.top + 1, 'Sidebar cards overlap');
  }
  assert.ok(bounds.every(b => b.height > 60), 'Sidebar cards collapsed');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow');
}
fs.mkdirSync('output', { recursive: true });
try {
  await page.goto(base + '/chart');
  await page.getByPlaceholder('API_PASSWORD').fill(process.env.TC_PREVIEW_PASSWORD ?? 'arena-preview-only');
  await page.getByRole('button', { name: 'UNLOCK DASHBOARD' }).click();
  await page.getByRole('heading', { name: 'Choose your trading workspace' }).waitFor();
  assert.equal(await page.locator('.chart-card').count(), 0, 'No chart before workspace selection');
  await request('paper', '/api/settings', { onboarded: true, dataSource: 'demo', theme: 'dark', modules: { orderbook: true, strategyScore: true, marketStructure: true } });
  await page.getByRole('button', { name: /Paper trading/ }).click();
  await page.waitForFunction(() => document.querySelector('.chart-plot-frame canvas'));
  assert.equal(await page.locator('.chart-card').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Compare both', exact: true }).count(), 0);
  assert.equal(await page.locator('[aria-label="Chart objects"]').count(), 0);
  const before = await page.locator('.chart-plot-frame').boundingBox();
  assert.ok(before.height >= 430 && before.width >= 700, 'Laptop plot squeezed');
  await page.getByRole('button').filter({ hasText: 'WHAT IS ON THIS CHART' }).click();
  const after = await page.locator('.chart-plot-frame').boundingBox();
  assert.ok(Math.abs(before.height - after.height) < 1, 'Legend stole plot height');
  await page.getByRole('button').filter({ hasText: 'WHAT IS ON THIS CHART' }).click();
  assert.equal(await page.locator('.chart-ai-review:visible').count(), 1);
  await page.getByTestId('decision-summary').waitFor();
  await page.getByText('Not compared', { exact: true }).waitFor();
  const reasons = page.getByText('Reasons & details', { exact: true });
  assert.equal(await reasons.locator('..').getAttribute('open'), null);
  await reasons.click();
  await page.getByText('Technical fallback:', { exact: true }).waitFor();
  await reasons.click();
  assert.equal(await page.getByRole('button', { name: 'Toggle strategy overlay', exact: true }).count(), 1);
  const localTimeframe = page.getByLabel('Chart timeframe', { exact: true });
  await localTimeframe.selectOption('5m');
  await page.waitForFunction(() => document.querySelector('.chart-card-heading h2')?.textContent.includes('5m'));
  await page.getByTestId('decision-summary').waitFor();
  assert.equal(await localTimeframe.inputValue(), '5m');
  assert.equal(await page.locator('[data-price-labels="essential"]').count(), 1);
  await page.getByRole('button', { name: 'All price labels', exact: true }).click();
  assert.equal(await page.locator('[data-price-labels="all"]').count(), 1);
  await page.getByRole('button', { name: 'Essential price labels', exact: true }).click();
  await page.getByRole('button', { name: 'Hide AI review', exact: true }).click();
  assert.equal(await page.locator('.chart-ai-review:visible').count(), 0);
  await page.getByRole('button', { name: 'Show AI review', exact: true }).click();
  for (const route of ['/chart', '/heikin-ashi']) {
    await page.goto(base + route);
    await page.waitForFunction(() => document.querySelector('.chart-plot-frame canvas'));
    assert.equal(await page.locator('.chart-card').count(), 1);
    assert.equal(await page.locator(`[data-chart-type="${route === '/chart' ? 'candlestick' : 'heikin-ashi'}"]`).count(), 1);
    await page.getByRole('heading', { name: route === '/chart' ? 'Candlestick workspace' : 'Heikin-Ashi workspace' }).waitFor();
    for (const width of [390, 834, 1366, 1568, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      await noOverlap();
      assert.ok((await page.locator('.chart-plot-frame').boundingBox()).height >= 350);
    }
    await page.setViewportSize({ width: 1568, height: 900 });
    await page.screenshot({ path: `output/workspace-${route.slice(1)}-dark.png`, fullPage: true });
    await request('paper', '/api/settings', { theme: 'light' });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.chart-plot-frame canvas'));
    await noOverlap();
    await page.screenshot({ path: `output/workspace-${route.slice(1)}-light.png`, fullPage: true });
    await request('paper', '/api/settings', { theme: 'dark' });
  }
  assert.equal((await request('paper', '/api/orders')).status, 403);
  assert.equal((await request('live', '/api/paper')).status, 403);
  await request('live', '/api/settings', { onboarded: true, theme: 'light' });
  await page.getByRole('button', { name: /Switch workspace/ }).click();
  await page.getByRole('heading', { name: 'Choose your trading workspace' }).waitFor();
  await page.getByRole('button', { name: /Live trading/ }).click();
  await page.getByRole('button', { name: /Workspace: Live/ }).waitFor();
  await page.goto(base + '/');
  await page.getByRole('alert').filter({ hasText: /Live account unavailable/ }).waitFor();
  assert.equal((await request('live', '/api/account')).body.account, undefined);
  assert.equal((await request('paper', '/api/settings')).body.settings.theme, 'dark');
  assert.equal((await request('live', '/api/settings')).body.settings.theme, 'light');
  // Simulate independent external decisions, without contacting any provider.
  // The real technical context is obtained with provider=rules.
  await request('paper', '/api/settings', { onboarded: true, theme: 'dark' });
  await page.getByRole('button', { name: /Switch workspace/ }).click();
  await page.getByRole('heading', { name: 'Choose your trading workspace' }).waitFor();
  await page.getByRole('button', { name: /Paper trading/ }).click();
  let comparison = 'match';
  await page.route('**/api/ai', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const upstream = await route.fetch({ postData: JSON.stringify({ ...route.request().postDataJSON(), provider: 'rules' }) });
    const result = await upstream.json();
    assert.ok(result.prediction, 'Need real rule context for comparison UI test');
    const direction = comparison === 'match' ? result.prediction.direction : result.prediction.direction === 'LONG' ? 'SHORT' : 'LONG';
    result.prediction = { ...result.prediction, direction, provider: 'openrouter', degraded: false, model: 'browser-test-only', notice: null, modelDecision: { direction, rationale: 'Mock provider decision for layout test only.', confidence: 50 } };
    result.warning = null;
    await route.fulfill({ json: result });
  });
  await page.goto(base + '/chart');
  await page.getByText('Strategy = AI', { exact: true }).waitFor();
  comparison = 'disagree';
  await page.getByRole('button', { name: 'Refresh AI decision', exact: true }).click();
  await page.getByText('Strategy ≠ AI', { exact: true }).waitFor();
  await page.unroute('**/api/ai');
  await page.goto(base + '/ai-connection');
  await page.getByRole('heading', { name: 'AI connection', exact: true }).waitFor();
  await page.locator('.connection-glow.is-missing').first().waitFor();
  await page.route('**/api/ai/keys', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    result.providers.openrouter = { ...result.providers.openrouter, configured: true, keySource: 'env', keyHint: '…test' };
    await route.fulfill({ json: result });
  });
  await page.reload();
  await page.locator('.connection-glow.is-configured').first().waitFor();
  await page.locator('.connection-glow.is-missing').first().waitFor();
  await page.unroute('**/api/ai/keys');

  assert.deepEqual(errors, []);
  console.log('PASS: profile gate and switching, independent preferences, no live-to-paper fallback, execution boundaries, separate charts, local timeframe, essential labels, decision match/disagreement/fallback, collapsed reasons, configured/missing key glow, fixed plot/legend height, AI toggle, 390/834/1366/1568/2560px, day/night, no overlap or page errors.');
} finally { await browser.close(); }
