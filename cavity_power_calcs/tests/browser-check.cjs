// npm run test:browser (requires Google Chrome, or CHROME_PATH).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 889, height: 924 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.waitForSelector('#power-chart path');
    const text = id => page.locator(`#${id}`).textContent();
    assert.equal(await text('coupled-value'), '32.53%');
    assert.equal(await text('circulating-value'), '31.89 ×');
    assert.equal(await text('kappa-value'), '2.496 MHz');
    assert.equal(await page.locator('#power-chart path').count(), 3);
    assert.equal(await page.locator('#decay-chart path').count(), 2);

    const outputDir = path.resolve(__dirname, '../../.cache/cavity-preview');
    fs.mkdirSync(outputDir, { recursive: true });
    await page.screenshot({ path: path.join(outputDir, 'desktop.png'), fullPage: true });

    // The keyboard-accessible slider moves both plot markers and the selected mirror input.
    await page.locator('#scan-point').focus();
    await page.keyboard.press('End');
    assert.equal(await page.locator('#mirror-0').inputValue(), '15000');
    assert.equal(await text('scan-readout'), '15,000 ppm');
    await page.keyboard.press('Home');
    assert.equal(await text('circulating-value'), '0.00 ×');
    await page.locator('#mirror-0').fill('1000');

    // Changing input swaps a colliding output to the former input mirror.
    await page.locator('#input-port').selectOption('1');
    assert.equal(await page.locator('#output-port').inputValue(), '0');
    assert.match(await text('subtitle'), /mirror 2$/);
    await page.locator('#output-port').selectOption('3');
    assert.equal(await text('leakage-title'), 'Mirror 4 leakage per pass');
    await page.locator('#scan-mirror').selectOption('3');
    const rateBefore = await text('external-value');
    await page.locator('#mirror-3').fill('500');
    assert.notEqual(await text('external-value'), rateBefore);
    assert.match(await text('power-context'), /Mirror 4 scanned/);

    // Wavelength changes optical frequency; fixed-coefficient resonant powers stay fixed.
    const powerBefore = await text('circulating-value');
    const frequencyBefore = await text('wavelength-hint');
    await page.locator('#wavelength').fill('1560');
    assert.equal(await text('circulating-value'), powerBefore);
    assert.notEqual(await text('wavelength-hint'), frequencyBefore);

    // Invalid/empty inputs leave clearly marked last-valid data and disable interactions.
    await page.locator('#length').fill('');
    assert.equal(await page.locator('#form-error').isVisible(), true);
    assert.equal(await page.locator('#scan-point').isDisabled(), true);
    await page.locator('#length').fill('0.21413747');
    assert.equal(await page.locator('#form-error').isVisible(), false);
    await page.locator('#scan-end').fill('0');
    assert.equal(await page.locator('#form-error').isVisible(), true);
    await page.locator('#scan-end').fill('15000');
    await page.locator('#tick-spacing').fill('0.00001');
    assert.equal(await page.locator('#form-error').isVisible(), true);
    await page.locator('#tick-spacing').fill('1000');

    // Range edits clamp the point; direct transmission edits expand the range.
    await page.locator('#scan-end').fill('200');
    assert.equal(await page.locator('#mirror-3').inputValue(), '200');
    await page.locator('#mirror-3').fill('20000');
    assert.equal(await page.locator('#scan-end').inputValue(), '20000');
    await page.locator('#power-chart').hover({ position: { x: 150, y: 100 } });
    assert.equal(await page.locator('#power-tooltip').isVisible(), true);
    await page.locator('#power-chart').click({ position: { x: 200, y: 100 } });
    assert.notEqual(await page.locator('#mirror-3').inputValue(), '20000');

    // A perfectly closed cavity has no NaN or invalid SVG paths.
    for (let i = 0; i < 4; i++) await page.locator(`#mirror-${i}`).fill('0');
    assert.equal(await text('circulating-value'), '0.00 ×');
    assert.equal(await text('finesse-note'), 'Finesse = ∞');
    assert.equal(await page.locator('#model-warning').isVisible(), true);
    assert.equal(await page.locator('svg path').evaluateAll(nodes => nodes.some(node => /NaN|Infinity/.test(node.getAttribute('d')))), false);

    await page.reload();
    await page.waitForSelector('#power-chart path');
    for (const width of [1440, 889, 700, 390, 320]) {
      await page.setViewportSize({ width, height: 924 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Horizontal overflow at ${width}px`);
      if (width === 390 || width === 1440) await page.screenshot({ path: path.join(outputDir, `${width === 390 ? 'mobile' : 'wide'}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: reference values, slider, ports, scanning, wavelength, validation, range handling, tooltips, closed cavity, and five viewport sizes.');
    console.log(`Screenshots: ${outputDir}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
