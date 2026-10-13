const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, C, calculate, validate, scan } = require('../cavity-model.js');
const config = overrides => ({ ...DEFAULTS, transmissions: [...DEFAULTS.transmissions], ...overrides });
function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

test('reproduces all six reference screenshot readouts', () => {
  const result = calculate(config());
  assert.equal((result.coupled * 100).toFixed(2), '32.53');
  assert.equal((result.output * 100).toFixed(0), '1');
  assert.equal(result.circulating.toFixed(2), '31.89');
  assert.equal((result.linewidth / 1e6).toFixed(3), '2.496');
  assert.equal((result.externalLinewidth / 1e6).toFixed(3), '2.228');
  assert.equal((result.fsr / 1e9).toFixed(1), '1.4');
  assert.equal(result.finesse.toFixed(0), '561');
  assert.equal((result.escapeShare * 100).toFixed(1), '89.3');
});

test('critical coupling has zero reflection and maximal net power transfer', () => {
  const result = calculate(config(), 10200);
  near(result.coupled, 1);
  near(result.reflected, 0);
  assert.ok(calculate(config(), 9000).coupled < result.coupled);
  assert.ok(calculate(config(), 12000).coupled < result.coupled);
});

test('power is conserved on and off resonance for every distinct input/output choice', () => {
  for (let inputPort = 0; inputPort < 4; inputPort++) for (let outputPort = 0; outputPort < 4; outputPort++) {
    if (inputPort === outputPort) continue;
    for (const detuningMHz of [0, -1.25, 1.25, 10]) {
      const settings = config({ inputPort, outputPort, otherLoss: 235, detuningMHz });
      const result = calculate(settings);
      const portPower = settings.transmissions.reduce((sum, value, index) => sum + (index === inputPort ? 0 : result.circulating * value * 1e-6), 0);
      near(result.reflected + portPower + result.circulating * 235e-6, 1);
      assert.ok(result.outputPower <= result.coupled + 1e-12);
      near(result.outputPower, result.circulating * result.output);
      const inputRate = result.input * result.fsr;
      const delta = 2 * Math.PI * detuningMHz * 1e6;
      // Independent input-output expression including prompt reflection.
      near(result.reflected, ((result.kappa / 2 - inputRate) ** 2 + delta ** 2) / ((result.kappa / 2) ** 2 + delta ** 2));
    }
  }
});

test('half-linewidth detuning halves powers for either sign without changing cavity properties', () => {
  const resonant = calculate(config());
  for (const sign of [-1, 1]) {
    const detuned = calculate(config({ detuningMHz: sign * resonant.linewidth / 2e6 }));
    for (const key of ['circulating', 'coupled', 'outputPower']) near(detuned[key], resonant[key] / 2);
    near(detuned.resonanceResponse, 0.5);
    for (const key of ['kappa', 'kappaExt', 'linewidth', 'externalLinewidth', 'fsr', 'finesse', 'escapeShare', 'frequency', 'quality', 'output']) {
      near(detuned[key], resonant[key]);
    }
  }
  const far = calculate(config({ detuningMHz: 50 * resonant.linewidth / 1e6 }));
  near(far.circulating, resonant.circulating / 10001);
});

test('fixed detuning uses each scan point linewidth and responds to round-trip time', () => {
  for (const scanMirror of [0, 1, 2, 3]) {
    const settings = config({ detuningMHz: 2, scanMirror });
    for (const point of scan(settings, 10)) {
      const resonant = calculate({ ...settings, detuningMHz: 0 }, point.scannedPpm);
      const response = 1 / (1 + (4e6 / point.linewidth) ** 2);
      for (const key of ['circulating', 'coupled', 'outputPower']) near(point[key], resonant[key] * response);
    }
  }
  const detuningMHz = calculate(config()).linewidth / 2e6;
  for (const overrides of [{ length: DEFAULTS.length * 2 }, { groupIndex: 2 }]) {
    const resonant = calculate(config(overrides));
    const detuned = calculate(config({ ...overrides, detuningMHz }));
    near(detuned.circulating, resonant.circulating / 5);
  }
});

test('scanning the output mirror changes its rate, scanning another mirror does not', () => {
  const scanOutput = config({ scanMirror: 1 });
  near(calculate(scanOutput, 2000).kappaExt, 2 * calculate(scanOutput, 1000).kappaExt);
  const scanOther = config({ scanMirror: 3 });
  near(calculate(scanOther, 2000).kappaExt, calculate(scanOther, 1000).kappaExt);
  assert.ok(calculate(scanOther, 2000).coupled !== calculate(scanOther, 1000).coupled);
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
    const fsr = C / (settings.groupIndex * settings.length);
    const fixedLossPpm = transmissions.slice(1).reduce((sum, value) => sum + value, 0);
    const peakPpm = Math.hypot(fixedLossPpm, 4 * Math.PI * settings.detuningMHz * 1e6 / fsr * 1e6);
    const points = scan(settings);
    const peak = points.reduce((best, point) => point.circulating > best.circulating ? point : best);
    near(peak.scannedPpm, peakPpm);
    assert.ok(calculate(settings, peakPpm * 0.9).circulating < peak.circulating);
    assert.ok(calculate(settings, peakPpm * 1.1).circulating < peak.circulating);
    assert.ok(points.every(point => Number.isFinite(point.circulating)));
  }
});
