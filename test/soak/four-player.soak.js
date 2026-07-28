const { test, expect } = require('@playwright/test');

const SOAK_MS = Math.max(20_000, Number(process.env.NEON_SOAK_MS || 180_000));
const SAMPLE_MS = Math.max(2_000, Number(process.env.NEON_SOAK_SAMPLE_MS || 5_000));

test('four-CPU browser battle remains responsive during a long render soak', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(baseURL);
  await page.locator('#nickname-input').fill('SOAK-VIEWER');
  await page.waitForTimeout(350);
  if (await page.locator('#patch-notes').isVisible()) await page.locator('#patch-notes-close').click();
  await page.locator('#demo-button').click();
  await expect(page.locator('#game')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__NEON_METRICS__.players)).toBe(4);

  const startedAt = Date.now();
  const samples = [];
  while (Date.now() - startedAt < SOAK_MS) {
    await page.waitForTimeout(Math.min(SAMPLE_MS, SOAK_MS - (Date.now() - startedAt)));
    samples.push(await page.evaluate(() => {
      const metrics = { ...window.__NEON_METRICS__ };
      const heap = performance.memory?.usedJSHeapSize || 0;
      return { ...metrics, heap, now: performance.now() };
    }));
  }

  const steady = samples.slice(Math.min(2, Math.floor(samples.length / 3)));
  const fpsValues = steady.map(sample => sample.fps).filter(Number.isFinite);
  const snapshotValues = steady.map(sample => sample.snapshotHz).filter(Number.isFinite);
  const heapValues = samples.map(sample => sample.heap).filter(value => value > 0);
  const minFps = Math.min(...fpsValues);
  const minSnapshotHz = Math.min(...snapshotValues);
  const maxParticles = Math.max(...steady.map(sample => sample.particles || 0));
  const emergencyCorrections = Math.max(...steady.map(sample => sample.emergencyCorrections || 0));
  const heapGrowth = heapValues.length > 3 ? heapValues.at(-1) - Math.min(...heapValues.slice(0, 3)) : 0;

  expect(samples.length).toBeGreaterThanOrEqual(Math.floor(SOAK_MS / SAMPLE_MS) - 1);
  expect(minFps).toBeGreaterThanOrEqual(42);
  expect(minSnapshotHz).toBeGreaterThanOrEqual(20);
  expect(maxParticles).toBeLessThanOrEqual(64);
  expect(emergencyCorrections).toBeLessThanOrEqual(2);
  // V8 grows its heap in chunks; catch sustained leaks without treating one
  // normal heap expansion as a failure.
  if (heapValues.length > 3) expect(heapGrowth).toBeLessThan(48 * 1024 * 1024);
});
