const { test, expect } = require('@playwright/test');

async function openPlayer(browser, baseURL, nickname, viewport = { width: 1280, height: 720 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(baseURL);
  await page.locator('#nickname-input').fill(nickname);
  await expect(page.locator('#create-button')).toBeVisible();
  await page.waitForTimeout(350);
  if (await page.locator('#patch-notes').isVisible()) await page.locator('#patch-notes-close').click();
  return { context, page };
}

test('main UI stays inside desktop and mobile viewports', async ({ browser, baseURL }) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const player = await openPlayer(browser, baseURL, `LAYOUT-${viewport.width}`, viewport);
    const overflow = await player.page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      menu: document.querySelector('#menu .menu-card')?.getBoundingClientRect().toJSON()
    }));
    expect(overflow.width).toBeLessThanOrEqual(overflow.viewport + 1);
    expect(overflow.menu.x).toBeGreaterThanOrEqual(0);
    expect(overflow.menu.x + overflow.menu.width).toBeLessThanOrEqual(viewport.width + 1);
    if (viewport.width === 1280) {
      await expect(player.page.locator('#menu .menu-card')).toHaveScreenshot('main-menu-desktop.png', {
        animations: 'disabled',
        caret: 'hide'
      });
    }
    await player.context.close();
  }
});

test('four browsers can create, join, ready, play, reconnect, and keep render budgets', async ({ browser, baseURL }) => {
  const clients = [];
  try {
  for (let index = 0; index < 4; index++) clients.push(await openPlayer(browser, baseURL, `E2E-${index + 1}`));
  const [host, ...guests] = clients;

  await host.page.locator('#create-button').click();
  await expect(host.page.locator('#waiting-room')).toBeVisible();
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
  for (const client of clients) await expect(client.page.locator('#waiting-room')).toBeHidden();

  await host.page.waitForTimeout(2600);
  const metrics = await host.page.evaluate(() => window.__NEON_METRICS__);
  expect(metrics.players).toBe(4);
  expect(metrics.snapshotHz).toBeGreaterThanOrEqual(20);
  expect(metrics.snapshotHz).toBeLessThanOrEqual(36);
  expect(metrics.fps).toBeGreaterThanOrEqual(45);
  expect(metrics.particles).toBeLessThanOrEqual(64);

  const resumedPage = guests[0].page;
  await resumedPage.reload();
  await expect(resumedPage.locator('#game')).toBeVisible();
  await expect.poll(
    () => resumedPage.evaluate(() => window.__NEON_METRICS__.players),
    { timeout: 5_000 }
  ).toBe(4);
  } finally {
    for (const client of clients) await client.context.close().catch(() => {});
  }
});

test('high latency, jitter, and light packet loss keep prediction and interpolation responsive', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const network = await context.newCDPSession(page);
  try {
    await network.send('Network.enable');
    await network.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 80,
      downloadThroughput: 1_500_000,
      uploadThroughput: 750_000,
      packetLoss: 0
    });
    await page.goto(baseURL);
    await page.locator('#nickname-input').fill('E2E-NET');
    await page.waitForTimeout(350);
    if (await page.locator('#patch-notes').isVisible()) await page.locator('#patch-notes-close').click();
    await page.locator('#bot-match-button').click();
    await expect(page.locator('#game')).toBeVisible();
    await page.waitForTimeout(3_200);
    const moderate = await page.evaluate(() => window.__NEON_METRICS__);

    await network.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: 900_000,
      uploadThroughput: 450_000,
      packetLoss: 2
    });
    await page.waitForTimeout(5_200);
    const stressed = await page.evaluate(() => window.__NEON_METRICS__);

    expect(moderate.fps).toBeGreaterThanOrEqual(40);
    expect(stressed.fps).toBeGreaterThanOrEqual(40);
    expect(stressed.snapshotHz).toBeGreaterThanOrEqual(10);
    expect(stressed.interpolationMs).toBeGreaterThanOrEqual(moderate.interpolationMs);
    expect(stressed.interpolationMs).toBeLessThanOrEqual(150);
  } finally {
    await context.close();
  }
});
