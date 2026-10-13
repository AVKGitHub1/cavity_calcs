/* Exact traveling-wave round-trip model. Power fractions, not amplitudes. */
(function (root) {
  'use strict';
  const C = 299792458;
  const PPM = 1e-6;
  const DEFAULTS = Object.freeze({
    transmissions: Object.freeze([1000, 10000, 100, 100]),
    inputPort: 0, outputPort: 1, scanMirror: 0,
    scanStart: 0, scanEnd: 15000, tickSpacing: 1000,
    length: 0.21413747, wavelength: 780, detuningMHz: 0, groupIndex: 1, otherLoss: 0,
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
      ['detuningMHz', 'detuning', 'Laser detuning (MHz)', -1e9, 1e9],
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
    const loss = config.otherLoss * PPM;
    const mirrorLogs = transmission.map(value => Math.log1p(-value));
    const otherLog = mirrorLogs.reduce((sum, value, index) => sum + (index === config.inputPort ? 0 : value), Math.log1p(-loss));
    const roundTripLog = mirrorLogs[config.inputPort] + otherLog;
    const total = Math.max(0, -Math.expm1(roundTripLog));
    const returnLoss = -Math.expm1(otherLog);
    const roundTripAmplitude = Math.exp(roundTripLog / 2);
    // expm1 retains very small losses when exp(roundTripLog / 2) rounds to one.
    const resonanceGap = -Math.expm1(roundTripLog / 2);
    const fsr = C / (config.groupIndex * config.length);
    const kappa = Math.max(0, -roundTripLog * fsr);
    const kappaExt = -mirrorLogs[config.outputPort] * fsr;
    const detuningHz = config.detuningMHz * 1e6;
    const phase = 2 * Math.PI * ((detuningHz % fsr) / fsr);
    // |1 - rho exp(i phi)|² = (1 - rho)² + 4 rho sin²(phi / 2).
    const denominator = Math.hypot(resonanceGap, 2 * Math.sqrt(roundTripAmplitude) * Math.sin(phase / 2));
    // A perfectly closed, initially empty cavity cannot be excited.
    const circulating = denominator === 0 ? 0 : (input / denominator) / denominator;
    const coupled = denominator === 0 ? 0 : (input / denominator) * (returnLoss / denominator);
    const resonanceResponse = denominator === 0 ? 0 : (resonanceGap / denominator) ** 2;
    // Reference power is just after input injection. Propagate in cyclic mirror order.
    // The additional lumped loss is encountered immediately before returning to input.
    const passFractions = [0, 0, 0, 0];
    let surviving = 1;
    for (let step = 1; step < 4; step++) {
      const port = (config.inputPort + step) % 4;
      passFractions[port] = surviving * transmission[port];
      surviving *= 1 - transmission[port];
    }
    const absorbedPower = circulating * surviving * loss;
    passFractions[config.inputPort] = surviving * (1 - loss) * input;
    const portPowers = passFractions.map(fraction => circulating * fraction);
    // At input the measurable power includes prompt reflection and interference.
    const reflected = Math.max(0, 1 - coupled);
    portPowers[config.inputPort] = reflected;
    const outputPower = portPowers[config.outputPort];
    const linewidth = kappa / (2 * Math.PI);
    const halfMaximumSine = roundTripAmplitude === 0 ? Infinity : resonanceGap / (2 * Math.sqrt(roundTripAmplitude));
    const airyLinewidth = halfMaximumSine > 1 ? null : 2 * fsr / Math.PI * Math.asin(halfMaximumSine);
    const frequency = C / (config.wavelength * 1e-9);
    return {
      scannedPpm, total, input, output, circulating, coupled, outputPower, detuningHz, resonanceResponse,
      reflected, portPowers, absorbedPower, roundTripAmplitude, kappa, kappaExt, linewidth, airyLinewidth,
      externalLinewidth: kappaExt / (2 * Math.PI), fsr,
      finesse: airyLinewidth === null ? null : airyLinewidth === 0 ? Infinity : fsr / airyLinewidth,
      escapeShare: total === 0 ? null : passFractions[config.outputPort] / total,
      frequency, quality: roundTripAmplitude === 0 ? null : linewidth === 0 ? Infinity : frequency / linewidth,
    };
  }

  function scan(config, samples = 500) {
    if (validate(config).length) throw new RangeError('Invalid cavity or scan parameters.');
    if (!Number.isInteger(samples) || samples < 2 || samples > 10000) throw new RangeError('Samples must be an integer from 2 to 10000.');
    const points = new Set([config.scanStart, config.scanEnd]);
    for (let i = 1; i < samples; i++) points.add(config.scanStart + (config.scanEnd - config.scanStart) * i / samples);
    // Resolve narrow peaks near zero, even in scans spanning many decades.
    const fixedLog = config.transmissions.reduce((sum, value, index) => sum + (index === config.scanMirror ? 0 : Math.log1p(-value * PPM)), Math.log1p(-config.otherLoss * PPM));
    const fixedSurvival = Math.exp(fixedLog);
    const fixedLoss = -Math.expm1(fixedLog);
    const fsr = C / (config.groupIndex * config.length);
    const phase = 2 * Math.PI * ((config.detuningMHz * 1e6 % fsr) / fsr);
    const discriminant = Math.hypot(fixedLoss, 2 * Math.sqrt(fixedSurvival) * Math.sin(phase));
    // Extrema for numerators proportional to scanned T, or independent of it.
    const transmissionPeak = Math.cos(phase) <= 0 ? 1 : 2 * discriminant / (1 + fixedSurvival + discriminant);
    const buildupPeak = Math.cos(phase) <= 0 ? 1 : fixedSurvival === 0 ? 0 : (Math.sin(phase) ** 2 - fixedLoss) / fixedSurvival;
    for (const peak of [transmissionPeak, buildupPeak]) {
      if (peak <= 0 || peak > 1) continue;
      for (let i = -60; i <= 60; i++) {
        const value = peak / PPM * Math.pow(10, i / 15);
        if (value > config.scanStart && value < config.scanEnd) points.add(value);
      }
    }
    return [...points].sort((a, b) => a - b).map(value => calculate(config, value));
  }

  const api = Object.freeze({ C, PPM, DEFAULTS, validate, calculate, scan });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CavityModel = api;
})(typeof window === 'undefined' ? this : window);
