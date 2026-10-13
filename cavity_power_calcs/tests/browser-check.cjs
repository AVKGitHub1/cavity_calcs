// npm run test:browser (requires Google Chrome, or CHROME_PATH).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { DEFAULTS, calculate } = require('../cavity-model.js');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 889, height: 924 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.waitForSelector('#power-chart path');
    const text = id => page.locator(`#${id}`).textContent();
    assert.equal(await text('coupled-value'), '32.41%');
    assert.equal(await text('circulating-value'), '31.78 ×');
    assert.equal(await text('kappa-value'), '2.507 MHz');
    assert.equal(await page.locator('#power-chart path').count(), 3);
    assert.equal(await page.locator('#decay-chart path').count(), 2);

    const outputDir = path.resolve(__dirname, '../../.cache/cavity-preview');
    fs.mkdirSync(outputDir, { recursive: true });
    await page.screenshot({ path: path.join(outputDir, 'desktop.png'), fullPage: true });

    // Detuning updates powers and full curves, preserving intrinsic cavity rates.
    const curves = id => page.locator(`#${id} path`).evaluateAll(nodes => nodes.map(node => node.getAttribute('d')));
    // Compare geometry rather than vertices: detuning changes the adaptive scan samples.
    const decayGeometry = () => page.locator('#decay-chart path').evaluateAll(nodes => nodes.map(node =>
      [0, 0.25, 0.5, 0.75, 1].map(fraction => {
        const point = node.getPointAtLength(node.getTotalLength() * fraction);
        return [point.x.toFixed(2), point.y.toFixed(2)];
      })));
    const resonantPowerCurves = await curves('power-chart');
    const resonantDecayGeometry = await decayGeometry();
    const halfLinewidthMHz = calculate(DEFAULTS).airyLinewidth / 2e6;
    assert.equal(await page.locator('#detuning').inputValue(), '0');
    await page.locator('#detuning').fill(String(halfLinewidthMHz));
    assert.equal(await text('circulating-value'), '15.89 ×');
    assert.equal(await text('coupled-value'), '16.20%');
    assert.match(await text('output-note'), /^15\.89%/);
    assert.equal(await text('response-note'), '50% of resonant power at this scan point');
    assert.match(await text('subtitle'), /detuned/);
    assert.match(await text('power-context'), /Δf = \+1\.253 MHz/);
    assert.equal(await text('kappa-value'), '2.507 MHz');
    const detunedPowerCurves = await curves('power-chart');
    assert.notDeepEqual(detunedPowerCurves, resonantPowerCurves);
    assert.deepEqual(await decayGeometry(), resonantDecayGeometry);
    await page.screenshot({ path: path.join(outputDir, 'detuned.png'), fullPage: true });
    await page.locator('#detuning').fill(String(-halfLinewidthMHz));
    assert.equal(await text('circulating-value'), '15.89 ×');
    assert.match(await text('power-context'), /Δf = -1\.253 MHz/);
    assert.deepEqual(await curves('power-chart'), detunedPowerCurves);
    await page.locator('#detuning').fill('');
    assert.equal(await page.locator('#detuning').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#form-error').isVisible(), true);
    assert.equal(await page.locator('#scan-point').isDisabled(), true);
    assert.equal(await text('circulating-value'), '15.89 ×');
    await page.locator('#detuning').fill('1400');
    assert.equal(await page.locator('#model-warning').isVisible(), false);
    assert.equal(await text('circulating-value'), '31.78 ×');
    assert.deepEqual(await curves('power-chart'), resonantPowerCurves);
    await page.locator('#detuning').fill('0');
    assert.equal(await page.locator('#form-error').isVisible(), false);
    assert.equal(await page.locator('#model-warning').isVisible(), false);
    assert.equal(await text('circulating-value'), '31.78 ×');
    assert.deepEqual(await curves('power-chart'), resonantPowerCurves);

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
    await page.locator('#detuning').fill('1500');
    assert.equal(await page.locator('#power-tooltip').isVisible(), false);

    // A perfectly closed cavity has no NaN or invalid SVG paths.
    for (let i = 0; i < 4; i++) await page.locator(`#mirror-${i}`).fill('0');
    assert.equal(await text('circulating-value'), '0.00 ×');
    assert.equal(await text('finesse-note'), 'Finesse = ∞');
    assert.equal(await page.locator('#model-warning').isVisible(), true);
    assert.equal(await page.locator('svg path').evaluateAll(nodes => nodes.some(node => /NaN|Infinity/.test(node.getAttribute('d')))), false);

    // Regression: the reported all-transparent case stays single-pass at 1500 MHz.
    await page.locator('#input-port').selectOption('0');
    await page.locator('#output-port').selectOption('1');
    await page.locator('#scan-mirror').selectOption('0');
    await page.locator('#detuning').fill('1500');
    for (let i = 0; i < 4; i++) await page.locator(`#mirror-${i}`).fill('1000000');
    assert.equal(await text('coupled-value'), '100.00%');
    assert.equal(await text('circulating-value'), '1.00 ×');
    assert.match(await text('output-note'), /^100\.00%.*100% round-trip escape share/);
    assert.equal(await text('response-note'), 'No resonant buildup');
    assert.equal(await page.locator('#power-tooltip').isVisible(), false);
    assert.equal(await text('kappa-value'), '∞ MHz');
    assert.match(await text('finesse-note'), /undefined/);
    assert.match(await text('model-warning'), /No light survives a full round trip/);
    assert.match(await text('decay-chart'), /No finite decay rates/);
    const finiteSvg = () => page.locator('svg').evaluateAll(nodes => nodes.every(node => !/NaN|Infinity/.test(node.innerHTML)));
    assert.equal(await finiteSvg(), true);
    await page.screenshot({ path: path.join(outputDir, 'all-transparent.png'), fullPage: true });
    await page.locator('#detuning').fill('0');
    assert.equal(await text('coupled-value'), '100.00%');
    await page.locator('#output-port').selectOption('3');
    assert.match(await text('output-note'), /^0\.00%/);
    await page.locator('#input-port').selectOption('3');
    assert.equal(await page.locator('#output-port').inputValue(), '0');
    assert.match(await text('output-note'), /^100\.00%/);

    // A divergent scan endpoint must not suppress the finite portion of a rate curve.
    await page.locator('#input-port').selectOption('0');
    await page.locator('#output-port').selectOption('1');
    await page.locator('#mirror-1').fill('10000');
    await page.locator('#mirror-2').fill('100');
    await page.locator('#mirror-3').fill('100');
    assert.equal(await finiteSvg(), true);
    assert.match(await text('decay-chart'), /Infinite decay rates are not plotted/);
    assert.ok((await curves('decay-chart')).every(curve => curve.trim().length > 0));

    await page.reload();
    await page.waitForSelector('#power-chart path');
    await page.locator('#detuning').fill('-1.25');
    for (const width of [1440, 889, 700, 390, 320]) {
      await page.setViewportSize({ width, height: 924 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Horizontal overflow at ${width}px`);
      if (width === 390 || width === 1440) await page.screenshot({ path: path.join(outputDir, `${width === 390 ? 'mobile' : 'wide'}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: exact powers, transparent mirrors at 1500 MHz, sequential ports, infinite decay rates, periodic detuning, controls, validation, closed cavity, and five viewport sizes.');
    console.log(`Screenshots: ${outputDir}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
