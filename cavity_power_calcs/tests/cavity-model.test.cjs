const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, C, calculate, validate, scan } = require('../cavity-model.js');
const config = overrides => ({ ...DEFAULTS, transmissions: [...DEFAULTS.transmissions], ...overrides });
function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

test('default readouts use the exact round-trip model', () => {
  const result = calculate(config());
  assert.equal((result.coupled * 100).toFixed(2), '32.41');
  assert.equal((result.output * 100).toFixed(0), '1');
  assert.equal(result.circulating.toFixed(2), '31.78');
  assert.equal((result.linewidth / 1e6).toFixed(3), '2.507');
  assert.equal((result.externalLinewidth / 1e6).toFixed(3), '2.239');
  assert.equal((result.fsr / 1e9).toFixed(1), '1.4');
  assert.equal(result.finesse.toFixed(0), '558');
  assert.equal((result.escapeShare * 100).toFixed(1), '89.4');
});

test('one million ppm on all mirrors couples all light into the next port at any detuning', () => {
  for (let inputPort = 0; inputPort < 4; inputPort++) for (let outputPort = 0; outputPort < 4; outputPort++) {
    if (inputPort === outputPort) continue;
    for (const detuningMHz of [0, 1.25, -1500, 1500, 1e9]) {
      const result = calculate(config({ transmissions: [1e6, 1e6, 1e6, 1e6], inputPort, outputPort, detuningMHz }));
      assert.equal(result.coupled, 1);
      assert.equal(result.circulating, 1);
      assert.equal(result.reflected, 0);
      assert.equal(result.outputPower, outputPort === (inputPort + 1) % 4 ? 1 : 0);
      assert.equal(result.escapeShare, result.outputPower);
      assert.equal(result.kappa, Infinity);
      assert.equal(result.kappaExt, Infinity);
      assert.equal(result.finesse, null);
      assert.equal(result.quality, null);
    }
  }
});

test('with transparent downstream mirrors, an input transmission scan is single-pass transmission', () => {
  const settings = config({ transmissions: [1e6, 1e6, 1e6, 1e6], scanEnd: 1e6, tickSpacing: 1e5, detuningMHz: 1500 });
  for (const point of scan(settings, 20)) {
    near(point.coupled, point.scannedPpm * 1e-6);
    near(point.outputPower, point.coupled);
    near(point.circulating, point.coupled);
    near(point.reflected + point.coupled, 1);
  }
});

test('single-pass output powers include every preceding mirror and the specified lumped loss', () => {
  const result = calculate(config({ transmissions: [1e6, 300000, 400000, 500000], otherLoss: 200000, detuningMHz: 1500 }));
  near(result.circulating, 1);
  [0.168, 0.3, 0.28, 0.21].forEach((expected, i) => near(result.portPowers[i], expected));
  near(result.absorbedPower, 0.042);
  near(result.coupled, 0.832);
  const absorbed = calculate(config({ transmissions: [500000, 0, 0, 0], otherLoss: 1e6 }));
  near(absorbed.absorbedPower, 0.5);
  near(absorbed.reflected, 0.5);
  near(absorbed.coupled, 0.5);
  assert.equal(absorbed.outputPower, 0);
});

test('moderate-loss Airy response agrees with hand-calculated on, quarter, and half-FSR powers', () => {
  const settings = config({ transmissions: [500000, 500000, 500000, 500000] });
  const fsr = calculate(settings).fsr;
  // rho = 1/4. The denominator is 9/16, 17/16, or 25/16 at these phases.
  for (const [offset, denominator] of [[0, 9], [0.25, 17], [0.5, 25]]) {
    const result = calculate({ ...settings, detuningMHz: offset * fsr / 1e6 });
    near(result.circulating, 8 / denominator);
    near(result.coupled, 7 / denominator);
    [4, 2, 1].forEach((numerator, i) => near(result.portPowers[i + 1], numerator / denominator));
    near(result.reflected, 1 - 7 / denominator);
  }
});

test('critical coupling has zero reflection and maximal net power transfer', () => {
  const criticalPpm = (1 - 0.99 * 0.9999 * 0.9999) * 1e6;
  const result = calculate(config(), criticalPpm);
  near(result.coupled, 1);
  near(result.reflected, 0);
  assert.ok(calculate(config(), 9000).coupled < result.coupled);
  assert.ok(calculate(config(), 12000).coupled < result.coupled);
});

test('power is conserved from small losses to fully open mirrors for every port choice', () => {
  for (let inputPort = 0; inputPort < 4; inputPort++) for (let outputPort = 0; outputPort < 4; outputPort++) {
    if (inputPort === outputPort) continue;
    for (const transmissions of [DEFAULTS.transmissions, [500000, 900000, 300000, 700000], [1e6, 1e6, 1e6, 1e6], [0, 200000, 1e6, 900000]])
    for (const otherLoss of [235, 400000, 1e6]) for (const detuningMHz of [0, -1.25, 1500]) {
      const settings = config({ transmissions, inputPort, outputPort, otherLoss, detuningMHz });
      const result = calculate(settings);
      near(result.portPowers.reduce((sum, value) => sum + value, result.absorbedPower), 1);
      assert.ok(result.outputPower <= result.coupled + 1e-12);
      assert.ok(result.coupled >= 0 && result.coupled <= 1 + 1e-12);
      assert.ok(result.portPowers.every(value => value >= 0 && value <= 1 + 1e-12));
      near(result.outputPower, result.portPowers[outputPort]);
      // Independent input-output expression including prompt reflection.
      const inputReflectivity = 1 - transmissions[inputPort] * 1e-6;
      const otherSurvival = transmissions.reduce((product, value, i) => product * (i === inputPort ? 1 : 1 - value * 1e-6), 1 - otherLoss * 1e-6);
      const interference = 2 * Math.sqrt(inputReflectivity * otherSurvival) * Math.cos(2 * Math.PI * detuningMHz * 1e6 / result.fsr);
      near(result.reflected, (inputReflectivity + otherSurvival - interference) / (1 + inputReflectivity * otherSurvival - interference), 1e-9);
    }
  }
});

test('half the exact Airy FWHM halves powers for either sign without changing cavity properties', () => {
  const resonant = calculate(config());
  for (const sign of [-1, 1]) {
    const detuned = calculate(config({ detuningMHz: sign * resonant.airyLinewidth / 2e6 }));
    for (const key of ['circulating', 'coupled', 'outputPower']) near(detuned[key], resonant[key] / 2);
    near(detuned.resonanceResponse, 0.5);
    for (const key of ['kappa', 'kappaExt', 'linewidth', 'externalLinewidth', 'fsr', 'finesse', 'escapeShare', 'frequency', 'quality', 'output']) {
      near(detuned[key], resonant[key]);
    }
  }
});

test('detuning response is symmetric and periodic across longitudinal resonances', () => {
  const fsrMHz = calculate(config()).fsr / 1e6;
  for (const offset of [0, 1.25, 100, fsrMHz / 2]) {
    const reference = calculate(config({ detuningMHz: offset }));
    for (const periods of [-3, -1, 0, 1, 3]) for (const sign of [-1, 1]) {
      const result = calculate(config({ detuningMHz: sign * offset + periods * fsrMHz }));
      for (const key of ['circulating', 'coupled', 'outputPower']) near(result[key], reference[key]);
    }
  }
});

test('fixed detuning uses each scan point round-trip survival and phase', () => {
  for (const scanMirror of [0, 1, 2, 3]) {
    const settings = config({ detuningMHz: 2, scanMirror });
    for (const point of scan(settings, 10)) {
      const resonant = calculate({ ...settings, detuningMHz: 0 }, point.scannedPpm);
      const rho = point.roundTripAmplitude;
      const response = (1 - rho) ** 2 / ((1 - rho) ** 2 + 4 * rho * Math.sin(Math.PI * 2e6 / point.fsr) ** 2);
      for (const key of ['circulating', 'coupled', 'outputPower']) near(point[key], resonant[key] * response);
    }
  }
  const original = calculate(config({ detuningMHz: 1 }));
  for (const overrides of [{ length: DEFAULTS.length * 2 }, { groupIndex: 2 }]) {
    const detuned = calculate(config({ ...overrides, detuningMHz: 1 }));
    const twiceDetuned = calculate(config({ detuningMHz: 2 }));
    near(detuned.circulating, twiceDetuned.circulating);
    assert.ok(detuned.circulating < original.circulating);
  }
});

test('scanning the output mirror changes its rate, scanning another mirror does not', () => {
  const scanOutput = config({ scanMirror: 1 });
  near(calculate(scanOutput, 2000).kappaExt, -Math.log(0.998) * calculate(scanOutput).fsr);
  const scanOther = config({ scanMirror: 3 });
  near(calculate(scanOther, 2000).kappaExt, calculate(scanOther, 1000).kappaExt);
  assert.ok(calculate(scanOther, 2000).coupled !== calculate(scanOther, 1000).coupled);
});

test('decay uses logarithmic survival; spectral finesse becomes undefined for broad or flat responses', () => {
  const settings = config({ transmissions: [500000, 500000, 500000, 500000], otherLoss: 200000 });
  const result = calculate(settings);
  near(result.kappa / result.fsr, -Math.log(0.8 * 0.5 ** 4));
  near(result.kappaExt / result.fsr, -Math.log(0.5));
  assert.ok(Math.abs(result.airyLinewidth - result.linewidth) > 0.01 * result.fsr);
  const broad = calculate(config({ transmissions: [900000, 900000, 900000, 900000] }));
  assert.equal(broad.airyLinewidth, null);
  assert.equal(broad.finesse, null);
  assert.ok(Number.isFinite(broad.kappa));
});

test('small-loss limit recovers the original Lorentzian approximation', () => {
  const settings = config({ transmissions: [1, 10, 0.1, 0.1] });
  const total = 11.2e-6;
  const fsr = C / settings.length;
  for (const detuningMHz of [0, total * fsr / (4 * Math.PI * 1e6)]) {
    const result = calculate({ ...settings, detuningMHz });
    const approximation = 4e-6 / (total ** 2 + (4 * Math.PI * detuningMHz * 1e6 / fsr) ** 2);
    near(result.circulating, approximation, 1e-5);
  }
});

test('length and group index scale decay rates and FSR, but not resonant powers', () => {
  const original = calculate(config());
  for (const settings of [config({ length: DEFAULTS.length * 2 }), config({ groupIndex: 2 })]) {
    const changed = calculate(settings);
    near(changed.fsr, original.fsr / 2);
    near(changed.kappa, original.kappa / 2);
    near(changed.circulating, original.circulating);
    near(changed.finesse, original.finesse);
  }
});

test('resonance wavelength sets optical frequency and Q at fixed detuning', () => {
  const original = calculate(config({ detuningMHz: 2 }));
  const changed = calculate(config({ wavelength: 1560, detuningMHz: 2 }));
  near(original.frequency, C / 780e-9);
  near(changed.frequency, original.frequency / 2);
  near(changed.quality, original.quality / 2);
  near(changed.linewidth, original.linewidth);
  near(changed.coupled, original.coupled);
});

test('a blocked input and a closed cavity produce well-defined results', () => {
  for (const detuningMHz of [0, -2, 2]) {
    const blocked = calculate(config({ detuningMHz }), 0);
    near(blocked.circulating, 0); near(blocked.outputPower, 0); near(blocked.reflected, 1);
    const closed = calculate(config({ transmissions: [0, 0, 0, 0], detuningMHz }));
    assert.equal(closed.finesse, Infinity);
    assert.equal(closed.quality, Infinity);
    assert.equal(closed.escapeShare, null);
    assert.equal(closed.kappa, 0);
    assert.equal(closed.circulating, 0);
    Object.values(closed).forEach(value => assert.ok(!Number.isNaN(value)));
  }
});

test('invalid physical inputs, shared ports, and unbounded tick counts are rejected', () => {
  for (const overrides of [
    { transmissions: [-1, 1, 1, 1] }, { transmissions: [1, 1, 1, 1000001] },
    { transmissions: [NaN, 1, 1, 1] }, { length: 0 }, { groupIndex: 0 },
    { wavelength: Infinity }, { otherLoss: -1 }, { inputPort: 1, outputPort: 1 },
    { detuningMHz: NaN }, { detuningMHz: Infinity }, { detuningMHz: -Infinity },
    { detuningMHz: -1e9 - 1 }, { detuningMHz: 1e9 + 1 },
    { scanStart: 15000, scanEnd: 0 }, { scanStart: 0, scanEnd: 0 }, { tickSpacing: 0.01 },
  ]) assert.ok(validate(config(overrides)).length > 0, JSON.stringify(overrides));
  assert.deepEqual(validate(config()), []);
  assert.deepEqual(validate(config({ detuningMHz: -1.25 })), []);
});

test('scans include endpoints and narrow critical-coupling peaks, and do not mutate inputs', () => {
  const settings = config({ transmissions: [1000, 0.1, 0.01, 0.01] });
  const original = JSON.stringify(settings);
  const points = scan(settings);
  assert.equal(points[0].scannedPpm, settings.scanStart);
  assert.equal(points.at(-1).scannedPpm, settings.scanEnd);
  assert.ok(points.some(point => Math.abs(point.coupled - 1) < 1e-12));
  assert.equal(JSON.stringify(settings), original);
  assert.throws(() => scan(settings, Infinity), RangeError);
});

test('detuned scans resolve shifted narrow power peaks even with no fixed loss', () => {
  for (const transmissions of [[1000, 0.1, 0.01, 0.01], [1000, 0, 0, 0]]) {
    const settings = config({ transmissions, detuningMHz: 0.0001 });
    const points = scan(settings);
    const peak = points.reduce((best, point) => point.circulating > best.circulating ? point : best);
    assert.ok(peak.scannedPpm > 0 && peak.scannedPpm < 1);
    assert.ok(calculate(settings, peak.scannedPpm * 0.9999).circulating < peak.circulating);
    assert.ok(calculate(settings, peak.scannedPpm * 1.0001).circulating < peak.circulating);
    assert.ok(points.every(point => Number.isFinite(point.circulating)));
  }
});
