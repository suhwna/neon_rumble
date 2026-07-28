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

test('fighter silhouettes and four-player impacts stay visually readable', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${baseURL}/?visualTest=1`);
  await page.waitForFunction(() => typeof window.__NEON_SET_VISUAL_FIXTURE__ === 'function');

  await page.evaluate(() => window.__NEON_SET_VISUAL_FIXTURE__('motion-grid'));
  await page.waitForTimeout(450);
  await expect(page.locator('#game')).toHaveScreenshot('combat-motion-grid.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.012
  });

  await page.evaluate(() => window.__NEON_SET_VISUAL_FIXTURE__('four-player-impact'));
  await page.waitForTimeout(450);
  await expect(page.locator('#game')).toHaveScreenshot('combat-four-player-impact.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.012
  });
});

test('every authored move renders distinct startup, active, and recovery silhouettes', async ({ page, baseURL }) => {
  const crypto = require('node:crypto');
  const actions = [
    'groundNeutral', 'groundSide', 'groundUp', 'groundDown', 'dashAttack',
    'airNeutral', 'airForward', 'airBack', 'airUp', 'airDown',
    'specialNeutral', 'specialSide', 'specialUp', 'specialDown'
  ];
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${baseURL}/?visualTest=1`);
  await page.waitForFunction(() => typeof window.__NEON_SET_VISUAL_FIXTURE__ === 'function');

  for (const action of actions) {
    const hashes = [];
    for (const phase of ['startup', 'active', 'recovery']) {
      const result = await page.evaluate(
        ([selectedAction, selectedPhase]) => window.__NEON_SET_VISUAL_FIXTURE__(`motion:${selectedAction}:${selectedPhase}`),
        [action, phase]
      );
      expect(result.players).toBe(4);
      await page.waitForTimeout(80);
      const image = await page.locator('#game').screenshot();
      hashes.push(crypto.createHash('sha1').update(image).digest('hex'));
    }
    expect(new Set(hashes).size, `${action} phases must not share one silhouette`).toBe(3);
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
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(420);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(500);
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
    expect(moderate.inputAckMs).toBeGreaterThan(0);
    expect(stressed.inputAckMs).toBeGreaterThan(0);
    // WebSocket/TCP retransmission can spike ACK delay under synthetic packet
    // loss; prediction must keep the rendered correction bounded meanwhile.
    expect(stressed.inputAckMs).toBeLessThan(2_200);
    expect(stressed.correctionPx).toBeLessThan(90);
    expect(stressed.correctionPeakPx).toBeLessThan(220);
    expect(stressed.snapshotHz).toBeGreaterThanOrEqual(10);
    expect(stressed.interpolationMs).toBeGreaterThanOrEqual(moderate.interpolationMs);
    expect(stressed.interpolationMs).toBeLessThanOrEqual(150);
  } finally {
    await context.close();
  }
});

test('four clients with different latency profiles keep one authoritative battle coherent', async ({ browser, baseURL }) => {
  const profiles = [
    { latency: 0, packetLoss: 0 },
    { latency: 55, packetLoss: 0 },
    { latency: 105, packetLoss: 1 },
    { latency: 160, packetLoss: 2 }
  ];
  const clients = [];
  try {
    for (let index = 0; index < profiles.length; index++) {
      const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: profiles[index].latency,
        downloadThroughput: 1_200_000,
        uploadThroughput: 600_000,
        packetLoss: profiles[index].packetLoss
      });
      await page.goto(baseURL);
      await page.locator('#nickname-input').fill(`NET-${index + 1}`);
      await page.waitForTimeout(800 + profiles[index].latency * 2);
      if (await page.locator('#patch-notes').isVisible()) await page.locator('#patch-notes-close').click();
      clients.push({ context, page, cdp, profile: profiles[index] });
    }

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
    await Promise.all(clients.map(client => expect(client.page.locator('#game')).toBeVisible()));
    await host.page.waitForTimeout(3_200);

    for (let cycle = 0; cycle < 12; cycle++) {
      await Promise.all(clients.map(async (client, index) => {
        const direction = (cycle + index) % 2 ? 'ArrowLeft' : 'ArrowRight';
        await client.page.keyboard.down(direction);
        await client.page.waitForTimeout(180 + index * 25);
        if (cycle % 3 === index % 3) await client.page.keyboard.press(index % 2 ? 'KeyX' : 'KeyZ');
        await client.page.keyboard.up(direction);
      }));
      await host.page.waitForTimeout(320);
    }

    const metrics = await Promise.all(clients.map(client =>
      client.page.evaluate(() => ({ ...window.__NEON_METRICS__, connected: window.__NEON_METRICS__.players === 4 }))
    ));
    for (let index = 0; index < metrics.length; index++) {
      const sample = metrics[index];
      expect(sample.connected, `client ${index + 1} lost the four-player state`).toBe(true);
      expect(sample.fps).toBeGreaterThanOrEqual(35);
      expect(sample.snapshotHz).toBeGreaterThanOrEqual(8);
      expect(sample.inputAckMs).toBeGreaterThan(0);
      expect(sample.inputAckMs).toBeLessThan(2_500);
      expect(sample.correctionPeakPx).toBeLessThanOrEqual(240);
      expect(sample.emergencyCorrections).toBeLessThanOrEqual(4);
    }
  } finally {
    for (const client of clients) await client.context.close().catch(() => {});
  }
});
