const { test, expect } = require('@playwright/test');

const SOAK_MS = Math.max(30_000, Number(process.env.NEON_NETWORK_SOAK_MS || process.env.NEON_SOAK_MS || 180_000));
const SAMPLE_MS = Math.max(2_000, Number(process.env.NEON_SOAK_SAMPLE_MS || 5_000));
const PROFILES = [
  { latency: 0, packetLoss: 0 },
  { latency: 55, packetLoss: 0 },
  { latency: 105, packetLoss: 1 },
  { latency: 160, packetLoss: 2 }
];

async function openNetworkClient(browser, baseURL, index) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const profile = PROFILES[index];
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latency,
    downloadThroughput: 1_200_000,
    uploadThroughput: 600_000,
    packetLoss: profile.packetLoss
  });
  await page.goto(baseURL);
  await page.locator('#nickname-input').fill(`SOAK-NET-${index + 1}`);
  await page.waitForTimeout(800 + profile.latency * 2);
  if (await page.locator('#patch-notes').isVisible()) await page.locator('#patch-notes-close').click();
  return { context, page, cdp, profile, samples: [] };
}

test('four independently delayed browsers survive a long shared battle', async ({ browser, baseURL }) => {
  const clients = [];
  try {
    for (let index = 0; index < PROFILES.length; index++) {
      clients.push(await openNetworkClient(browser, baseURL, index));
    }
    const [host, ...guests] = clients;
    await host.page.locator('#create-button').click();
    await expect(host.page.locator('#waiting-room')).toBeVisible();
    await host.page.locator('#stocks-input').fill('9');
    await host.page.locator('#stocks-input').dispatchEvent('change');
    await expect.poll(() => host.page.locator('#stocks-input').inputValue()).toBe('9');
    const roomCode = (await host.page.locator('#waiting-room-code').textContent()).trim();
    expect(roomCode).toMatch(/^[A-Z0-9]{5}$/);
    for (const guest of guests) {
      await guest.page.locator('#room-input').fill(roomCode);
      await guest.page.locator('#join-button').click();
      await expect(guest.page.locator('#waiting-room')).toBeVisible();
    }
    await expect(host.page.locator('#player-list .player-pill:not(.empty)')).toHaveCount(4);
    for (const client of clients) await client.page.locator('#waiting-ready').click();
    await expect(host.page.locator('#waiting-start')).toBeEnabled();
    await host.page.locator('#waiting-start').click();
    await Promise.all(clients.map(client => expect(client.page.locator('#game')).toBeVisible()));
    await host.page.waitForTimeout(3_200);

    const startedAt = Date.now();
    let cycle = 0;
    let reconnected = false;
    while (Date.now() - startedAt < SOAK_MS) {
      await Promise.all(clients.map(async (client, index) => {
        const direction = (cycle + index) % 2 ? 'ArrowLeft' : 'ArrowRight';
        await client.page.keyboard.down(direction);
        await client.page.waitForTimeout(150 + index * 25);
        if (cycle % 3 === index % 3) await client.page.keyboard.press(index % 2 ? 'KeyX' : 'KeyZ');
        if (cycle % 7 === index) await client.page.keyboard.press('ArrowUp');
        await client.page.keyboard.up(direction);
      }));

      if (!reconnected && Date.now() - startedAt >= SOAK_MS * .52) {
        reconnected = true;
        await clients[2].page.reload();
        await expect(clients[2].page.locator('#game')).toBeVisible();
        await expect.poll(() => clients[2].page.evaluate(() => window.__NEON_METRICS__.players)).toBe(4);
      }

      await host.page.waitForTimeout(Math.min(SAMPLE_MS, Math.max(0, SOAK_MS - (Date.now() - startedAt))));
      const batch = await Promise.all(clients.map(client => client.page.evaluate(() => ({
        ...window.__NEON_METRICS__,
        heap: performance.memory?.usedJSHeapSize || 0
      }))));
      batch.forEach((sample, index) => clients[index].samples.push(sample));
      cycle += 1;
    }

    for (let index = 0; index < clients.length; index++) {
      const samples = clients[index].samples;
      const steady = samples.slice(Math.min(2, Math.floor(samples.length / 3)));
      const heaps = samples.map(sample => sample.heap).filter(value => value > 0);
      const heapGrowth = heaps.length > 3 ? heaps.at(-1) - Math.min(...heaps.slice(0, 3)) : 0;
      expect(steady.length, `client ${index + 1} did not produce enough samples`).toBeGreaterThanOrEqual(3);
      expect(Math.min(...steady.map(sample => sample.fps))).toBeGreaterThanOrEqual(32);
      expect(Math.min(...steady.map(sample => sample.snapshotHz))).toBeGreaterThanOrEqual(8);
      expect(Math.max(...steady.map(sample => sample.inputAckMs))).toBeLessThan(2_800);
      expect(Math.max(...steady.map(sample => sample.correctionPeakPx))).toBeLessThanOrEqual(240);
      expect(Math.max(...steady.map(sample => sample.emergencyCorrections || 0))).toBeLessThanOrEqual(8);
      if (heaps.length > 3) expect(heapGrowth).toBeLessThan(64 * 1024 * 1024);
    }
  } finally {
    for (const client of clients) await client.context.close().catch(() => {});
  }
});
