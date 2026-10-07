/* High-finesse, on-resonance traveling-wave model. Power fractions, not amplitudes. */
(function (root) {
  'use strict';
  const C = 299792458;
  const PPM = 1e-6;
  const DEFAULTS = Object.freeze({
    transmissions: Object.freeze([1000, 10000, 100, 100]),
    inputPort: 0, outputPort: 1, scanMirror: 0,
    scanStart: 0, scanEnd: 15000, tickSpacing: 1000,
    length: 0.21413747, wavelength: 780, groupIndex: 1, otherLoss: 0,
  });

  function validate(config) {
    const errors = [];
    const bounded = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
    if (!Array.isArray(config.transmissions) || config.transmissions.length !== 4) {
      errors.push({ field: 'mirror-0', message: 'Enter transmissions for all four mirrors.' });
    } else config.transmissions.forEach((value, index) => {
      if (!bounded(value, 0, 1e6)) errors.push({ field: `mirror-${index}`, message: `Mirror ${index + 1} transmission must be between 0 and 1,000,000 ppm.` });
    });
    for (const [key, field] of [['inputPort', 'input-port'], ['outputPort', 'output-port'], ['scanMirror', 'scan-mirror']]) {
      if (!Number.isInteger(config[key]) || !bounded(config[key], 0, 3)) errors.push({ field, message: 'Choose one of the four mirrors.' });
    }
    if (config.inputPort === config.outputPort) errors.push({ field: 'output-port', message: 'Choose an output mirror different from the input mirror.' });
    for (const [key, field, name, min, max] of [
      ['length', 'length', 'Round-trip length', 1e-9, 1e9],
      ['wavelength', 'wavelength', 'Wavelength', 1e-6, 1e9],
      ['groupIndex', 'group-index', 'Group index', 1e-6, 1e6],
      ['otherLoss', 'other-loss', 'Other round-trip loss', 0, 1e6],
      ['scanStart', 'scan-start', 'Scan start', 0, 1e6],
      ['scanEnd', 'scan-end', 'Scan end', 0, 1e6],
      ['tickSpacing', 'tick-spacing', 'Tick spacing', 1e-6, 1e6],
    ]) {
      if (!bounded(config[key], min, max)) errors.push({ field, message: `${name} must be a number between ${min} and ${max.toLocaleString('en-US')}.` });
    }
    if (config.scanEnd <= config.scanStart) errors.push({ field: 'scan-end', message: 'Scan end must be greater than scan start.' });
    if ((config.scanEnd - config.scanStart) / config.tickSpacing > 60) errors.push({ field: 'tick-spacing', message: 'Increase tick spacing to show at most 60 intervals.' });
    return errors;
  }

  function calculate(config, scannedPpm = config.transmissions[config.scanMirror]) {
    const transmission = config.transmissions.map((value, index) => (index === config.scanMirror ? scannedPpm : value) * PPM);
    const input = transmission[config.inputPort];
    const output = transmission[config.outputPort];
    const other = transmission.reduce((sum, value, index) => sum + (index === config.inputPort ? 0 : value), config.otherLoss * PPM);
    const total = input + other;
    const fsr = C / (config.groupIndex * config.length);
    const kappa = total * fsr;
    const kappaExt = output * fsr;
    // A perfectly closed, initially empty cavity cannot be excited.
    const circulating = total === 0 ? 0 : 4 * (input / total) / total;
    const coupled = total === 0 ? 0 : 4 * (input / total) * (other / total);
    const outputPower = total === 0 ? 0 : 4 * (input / total) * (output / total);
    const linewidth = kappa / (2 * Math.PI);
    const frequency = C / (config.wavelength * 1e-9);
    return {
      scannedPpm, total, input, output, circulating, coupled, outputPower,
      reflected: 1 - coupled, kappa, kappaExt, linewidth,
      externalLinewidth: kappaExt / (2 * Math.PI), fsr,
      finesse: total === 0 ? Infinity : 2 * Math.PI / total,
      escapeShare: total === 0 ? null : output / total,
      frequency, quality: linewidth === 0 ? Infinity : frequency / linewidth,
    };
  }

  function scan(config, samples = 500) {
    if (validate(config).length) throw new RangeError('Invalid cavity or scan parameters.');
    if (!Number.isInteger(samples) || samples < 2 || samples > 10000) throw new RangeError('Samples must be an integer from 2 to 10000.');
    const points = new Set([config.scanStart, config.scanEnd]);
    for (let i = 1; i < samples; i++) points.add(config.scanStart + (config.scanEnd - config.scanStart) * i / samples);
    // Resolve narrow peaks near zero, even in scans spanning many decades.
    const fixedLoss = config.otherLoss + config.transmissions.reduce((sum, value, index) => sum + (index === config.scanMirror ? 0 : value), 0);
    if (fixedLoss > 0) for (let i = -60; i <= 60; i++) {
      const value = fixedLoss * Math.pow(10, i / 15);
      if (value > config.scanStart && value < config.scanEnd) points.add(value);
    }
    return [...points].sort((a, b) => a - b).map(value => calculate(config, value));
  }

  const api = Object.freeze({ C, PPM, DEFAULTS, validate, calculate, scan });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CavityModel = api;
})(typeof window === 'undefined' ? this : window);
