(function () {
  'use strict';
  const { validate, calculate, scan } = window.CavityModel;
  const byId = id => document.getElementById(id);
  const form = byId('cavity-form');
  const slider = byId('scan-point');
  let config;
  let data;
  let frame;
  let previousInput = 0;
  const fmt = (value, decimals = 2) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: decimals }) : value === Infinity ? '∞' : '—';
  const fixed = (value, decimals) => value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const superscript = value => String(value).replace(/[-0-9]/g, digit => ({ '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' })[digit]);
  function scientific(value) {
    if (!Number.isFinite(value) || value === 0) return fmt(value);
    const exponent = Math.floor(Math.log10(Math.abs(value)));
    return `${fmt(value / 10 ** exponent)} × 10${superscript(exponent)}`;
  }
  function frequency(value) {
    for (const [scale, suffix] of [[1e12, 'THz'], [1e9, 'GHz'], [1e6, 'MHz'], [1e3, 'kHz'], [1, 'Hz']]) {
      if (value >= scale) return `${fmt(value / scale, 3)} ${suffix}`;
    }
    return `${scientific(value)} Hz`;
  }
  function readNumber(id) { return byId(id).value === '' ? NaN : byId(id).valueAsNumber; }
  function readConfig() {
    return {
      transmissions: [0, 1, 2, 3].map(i => readNumber(`mirror-${i}`)),
      inputPort: Number(byId('input-port').value), outputPort: Number(byId('output-port').value), scanMirror: Number(byId('scan-mirror').value),
      scanStart: readNumber('scan-start'), scanEnd: readNumber('scan-end'), tickSpacing: readNumber('tick-spacing'),
      length: readNumber('length'), wavelength: readNumber('wavelength'), groupIndex: readNumber('group-index'), otherLoss: readNumber('other-loss'),
    };
  }
  function syncPorts() {
    const input = Number(byId('input-port').value);
    if (Number(byId('output-port').value) === input) {
      byId('output-port').value = String(previousInput);
      byId('control-status').textContent = `Output port moved to mirror ${previousInput + 1} so the input and output remain distinct.`;
    }
    for (const option of byId('output-port').options) option.disabled = Number(option.value) === input;
    previousInput = input;
    for (let i = 0; i < 4; i++) byId(`mirror-label-${i}`).textContent = `Mirror ${i + 1}${i === input ? ' · input' : ''} (ppm)`;
  }
  function update(event) {
    syncPorts();
    const next = readConfig();
    const errors = validate(next);
    form.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
    errors.forEach(error => byId(error.field).setAttribute('aria-invalid', 'true'));
    byId('form-error').hidden = errors.length === 0;
    byId('form-error').textContent = errors.length ? `${errors[0].message} Plots show the last valid settings.` : '';
    byId('results').dataset.invalid = String(errors.length > 0);
    slider.disabled = errors.length > 0;
    if (errors.length) return;

    const current = next.transmissions[next.scanMirror];
    if (current < next.scanStart || current > next.scanEnd) {
      const changedRange = event && ['scan-start', 'scan-end'].includes(event.target.id);
      if (changedRange) {
        next.transmissions[next.scanMirror] = Math.max(next.scanStart, Math.min(next.scanEnd, current));
        byId(`mirror-${next.scanMirror}`).value = next.transmissions[next.scanMirror];
        byId('control-status').textContent = 'Current scan point moved inside the new scan range.';
      } else {
        next.scanStart = Math.min(next.scanStart, current);
        next.scanEnd = Math.max(next.scanEnd, current);
        byId('scan-start').value = next.scanStart;
        byId('scan-end').value = next.scanEnd;
        if ((next.scanEnd - next.scanStart) / next.tickSpacing > 60) {
          next.tickSpacing = 10 ** Math.ceil(Math.log10((next.scanEnd - next.scanStart) / 20));
          byId('tick-spacing').value = next.tickSpacing;
        }
        byId('control-status').textContent = 'Scan range expanded to include the selected mirror transmission.';
      }
    }
    config = next;
    slider.min = config.scanStart;
    slider.max = config.scanEnd;
    slider.step = 'any';
    slider.value = config.transmissions[config.scanMirror];
    data = scan(config);
    render();
  }
  function render() {
    if (!config) return;
    const current = calculate(config);
    const scanMirror = config.scanMirror + 1;
    const output = config.outputPort + 1;
    byId('subtitle').textContent = `Four-mirror, traveling-wave cavity · resonant continuous-wave input through mirror ${config.inputPort + 1}`;
    byId('power-context').textContent = `Mirror ${scanMirror} scanned · output at mirror ${output}`;
    byId('decay-context').textContent = `Mirror ${scanMirror} scanned · κext at mirror ${output}`;
    byId('decay-legend').textContent = `Mirror ${output} κext / 2π`;
    byId('scan-readout').textContent = `${fmt(current.scannedPpm, 3)} ppm`;
    slider.setAttribute('aria-valuetext', `${fmt(current.scannedPpm, 3)} parts per million on mirror ${scanMirror}`);
    byId('coupled-value').textContent = `${fixed(current.coupled * 100, 2)}%`;
    byId('leakage-title').textContent = `Mirror ${output} leakage per pass`;
    byId('leakage-value').textContent = `${fmt(current.output * 100, 4)}%`;
    const escape = current.escapeShare === null ? 'undefined escape share' : `${fmt(current.escapeShare * 100, 1)}% escape share`;
    byId('output-note').textContent = `${fixed(current.outputPower * 100, 2)}% of incident power exits here · ${escape}`;
    byId('circulating-value').textContent = `${fixed(current.circulating, 2)} ×`;
    byId('kappa-value').textContent = `${fixed(current.linewidth / 1e6, 3)} MHz`;
    byId('kappa-note').textContent = `κ = ${fmt(current.kappa / 1e6)} × 10⁶ s⁻¹`;
    byId('external-value').textContent = `${fixed(current.externalLinewidth / 1e6, 3)} MHz`;
    byId('external-note').textContent = `κext = ${fmt(current.kappaExt / 1e6)} × 10⁶ s⁻¹ · ${escape}`;
    byId('fsr-value').textContent = frequency(current.fsr);
    byId('finesse-note').textContent = `Finesse = ${fmt(current.finesse, 0)}`;
    byId('length-hint').textContent = `${fmt(config.length, 5)} m gives an FSR near ${frequency(current.fsr)}${config.groupIndex === 1 ? ' in air' : ` at nᵍ = ${fmt(config.groupIndex, 4)}`}.`;
    byId('wavelength-hint').textContent = `Resonant drive · optical frequency ${frequency(current.frequency)}`;
    byId('quality-note').textContent = `At ${fmt(config.wavelength, 4)} nm, Q = ${scientific(current.quality)}.`;
    const maxLoss = Math.max(...data.map(point => point.total));
    let warning = '';
    if (maxLoss > 0.1) warning = 'The scan includes more than 10% total round-trip loss. This high-finesse approximation becomes less accurate at large losses.';
    if (current.total === 0) warning = 'All losses and transmissions are zero: an initially empty cavity cannot be excited. Finesse and Q are infinite; escape share is undefined.';
    byId('model-warning').hidden = !warning;
    byId('model-warning').textContent = warning;
    window.CavityCharts.draw(byId('power-chart'), config, data, current, 'power');
    window.CavityCharts.draw(byId('decay-chart'), config, data, current, 'decay');
  }
  function setScanPoint(value) {
    if (slider.disabled || !config) return;
    const clamped = Math.max(config.scanStart, Math.min(config.scanEnd, value));
    const rounded = Number(clamped.toPrecision(10));
    config.transmissions[config.scanMirror] = rounded;
    byId(`mirror-${config.scanMirror}`).value = rounded;
    slider.value = rounded;
    // The selected mirror is swept in every sample, so changing this point does not change the curves.
    render();
  }
  slider.addEventListener('input', () => setScanPoint(slider.valueAsNumber));
  slider.addEventListener('keydown', event => {
    if (!config || slider.disabled) return;
    const step = (config.scanEnd - config.scanStart) / (event.shiftKey ? 100 : 1000);
    const actions = { ArrowRight: () => slider.valueAsNumber + step, ArrowUp: () => slider.valueAsNumber + step, ArrowLeft: () => slider.valueAsNumber - step, ArrowDown: () => slider.valueAsNumber - step, Home: () => config.scanStart, End: () => config.scanEnd };
    if (actions[event.key]) { event.preventDefault(); setScanPoint(actions[event.key]()); }
  });
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', update);
  for (const kind of ['power', 'decay']) {
    const svg = byId(`${kind}-chart`);
    const tooltip = byId(`${kind}-tooltip`);
    svg.addEventListener('pointermove', event => {
      if (!config || slider.disabled) return;
      const value = window.CavityCharts.pointAt(svg, event.clientX);
      const point = calculate(config, value);
      tooltip.textContent = kind === 'power'
        ? `${fmt(value)} ppm\nNet coupled: ${fmt(point.coupled * 100)}%\nOutput: ${fmt(point.outputPower * 100)}%\nCirculating: ${fmt(point.circulating)} ×`
        : `${fmt(value)} ppm\nTotal κ / 2π: ${fmt(point.linewidth / 1e6, 3)} MHz\nOutput κext / 2π: ${fmt(point.externalLinewidth / 1e6, 3)} MHz`;
      tooltip.hidden = false;
      const bounds = svg.getBoundingClientRect();
      tooltip.style.left = `${Math.max(6, Math.min(bounds.width - tooltip.offsetWidth - 6, event.clientX - bounds.left + 12))}px`;
      tooltip.style.top = `${Math.max(4, Math.min(bounds.height - tooltip.offsetHeight - 4, event.clientY - bounds.top - tooltip.offsetHeight - 8))}px`;
    });
    svg.addEventListener('pointerleave', () => { tooltip.hidden = true; });
    svg.addEventListener('click', event => {
      if (!config || slider.disabled) return;
      setScanPoint(window.CavityCharts.pointAt(svg, event.clientX));
    });
  }
  update();
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  });
  observer.observe(byId('power-chart'));
  observer.observe(byId('decay-chart'));
})();
