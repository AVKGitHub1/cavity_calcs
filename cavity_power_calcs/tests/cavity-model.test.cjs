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

test('power is conserved with internal loss for every distinct input/output choice', () => {
  for (let inputPort = 0; inputPort < 4; inputPort++) for (let outputPort = 0; outputPort < 4; outputPort++) {
    if (inputPort === outputPort) continue;
    const settings = config({ inputPort, outputPort, otherLoss: 235 });
    const result = calculate(settings);
    const portPower = settings.transmissions.reduce((sum, value, index) => sum + (index === inputPort ? 0 : result.circulating * value * 1e-6), 0);
    near(result.reflected + portPower + result.circulating * 235e-6, 1);
    assert.ok(result.outputPower <= result.coupled + 1e-12);
    near(result.outputPower, result.circulating * result.output);
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

test('wavelength sets optical frequency and Q without introducing detuning', () => {
  const original = calculate(config());
  const changed = calculate(config({ wavelength: 1560 }));
  near(original.frequency, C / 780e-9);
  near(changed.frequency, original.frequency / 2);
  near(changed.quality, original.quality / 2);
  near(changed.linewidth, original.linewidth);
  near(changed.coupled, original.coupled);
});

test('a blocked input and a closed cavity produce well-defined results', () => {
  const blocked = calculate(config(), 0);
  near(blocked.circulating, 0); near(blocked.outputPower, 0); near(blocked.reflected, 1);
  const closed = calculate(config({ transmissions: [0, 0, 0, 0] }));
  assert.equal(closed.finesse, Infinity);
  assert.equal(closed.quality, Infinity);
  assert.equal(closed.escapeShare, null);
  assert.equal(closed.kappa, 0);
  assert.equal(closed.circulating, 0);
  Object.values(closed).forEach(value => assert.ok(!Number.isNaN(value)));
});

test('invalid physical inputs, shared ports, and unbounded tick counts are rejected', () => {
  for (const overrides of [
    { transmissions: [-1, 1, 1, 1] }, { transmissions: [1, 1, 1, 1000001] },
    { transmissions: [NaN, 1, 1, 1] }, { length: 0 }, { groupIndex: 0 },
    { wavelength: Infinity }, { otherLoss: -1 }, { inputPort: 1, outputPort: 1 },
    { scanStart: 15000, scanEnd: 0 }, { scanStart: 0, scanEnd: 0 }, { tickSpacing: 0.01 },
  ]) assert.ok(validate(config(overrides)).length > 0, JSON.stringify(overrides));
  assert.deepEqual(validate(config()), []);
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
