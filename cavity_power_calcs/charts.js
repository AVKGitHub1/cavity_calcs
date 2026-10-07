(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = { blue: '#096bd1', green: '#009b75', orange: '#e94c13' };
  function element(tag, attrs = {}, text) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function niceCeiling(value) {
    if (!(value > 0)) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    return [1, 1.5, 2, 3, 4, 5, 6, 8, 10].find(step => step * magnitude >= value) * magnitude;
  }
  function tickText(value) {
    if (value === 0) return '0';
    if (Math.abs(value) >= 1e6 || Math.abs(value) < 0.001) return value.toExponential(1);
    return String(Number(value.toPrecision(5)));
  }
  function draw(svg, config, data, current, kind) {
    const width = Math.max(250, svg.getBoundingClientRect().width);
    const height = svg.getBoundingClientRect().height;
    const scale = Math.max(1, Math.min(1.4, width / 610));
    const margin = { top: 15 * scale, right: (width < 400 ? 34 : 44) * scale, bottom: 53 * scale, left: 41 * scale };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const isPower = kind === 'power';
    const leftMax = isPower ? 105 : Math.max(8, niceCeiling(Math.max(...data.map(p => p.linewidth / 1e6)) * 1.12));
    const rightMax = isPower ? Math.max(150, niceCeiling(Math.max(...data.map(p => p.circulating)) * 1.08)) : 0;
    const x = value => margin.left + (value - config.scanStart) / (config.scanEnd - config.scanStart) * plotWidth;
    const y = (value, right = false) => margin.top + plotHeight * (1 - value / (right ? rightMax : leftMax));
    const series = isPower ? [
      { color: COLORS.blue, get: p => p.coupled * 100 },
      { color: COLORS.green, get: p => p.outputPower * 100, dash: '1.7 3.6' },
      { color: COLORS.orange, get: p => p.circulating, dash: '5 4', right: true },
    ] : [
      { color: COLORS.blue, get: p => p.linewidth / 1e6 },
      { color: COLORS.green, get: p => p.externalLinewidth / 1e6, dash: '1.7 3.6' },
    ];
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const fragment = document.createDocumentFragment();
    fragment.append(element('title', {}, isPower ? 'Power versus scanned transmission' : 'Decay rates versus scanned transmission'));
    fragment.append(element('desc', {}, `Mirror ${config.scanMirror + 1} scanned from ${config.scanStart} to ${config.scanEnd} ppm. Current point: ${current.scannedPpm} ppm. Use the Current scan point slider to explore the values.`));
    const defs = element('defs');
    const clip = element('clipPath', { id: `${svg.id}-clip` });
    clip.append(element('rect', { x: margin.left, y: margin.top - 3, width: plotWidth, height: plotHeight + 6 }));
    defs.append(clip); fragment.append(defs);
    const grid = element('g', { 'font-family': 'Arial, sans-serif', 'font-size': 7.5 * scale, fill: '#7586a0' });
    const leftTicks = isPower ? [0, 20, 40, 60, 80, 100] : Array.from({ length: 6 }, (_, i) => leftMax * i / 5);
    leftTicks.forEach(value => {
      grid.append(element('line', { x1: margin.left, x2: width - margin.right, y1: y(value), y2: y(value), stroke: '#e8eef7', 'stroke-width': 1 }));
      grid.append(element('text', { x: margin.left - 7, y: y(value) + 2.5, 'text-anchor': 'end' }, tickText(value)));
    });
    if (isPower) for (let i = 0; i <= 5; i++) {
      const value = rightMax * i / 5;
      grid.append(element('text', { x: width - margin.right + 7, y: y(value, true) + 2.5 }, tickText(value)));
    }
    const ticks = [config.scanStart];
    const firstTick = Math.floor(config.scanStart / config.tickSpacing) + 1;
    for (let i = firstTick; i * config.tickSpacing < config.scanEnd - config.tickSpacing * 1e-9; i++) ticks.push(i * config.tickSpacing);
    ticks.push(config.scanEnd);
    const labelEvery = Math.max(1, Math.ceil(ticks.length / Math.max(4, Math.floor(plotWidth / (29 * scale)))));
    ticks.forEach((value, index) => {
      grid.append(element('line', { x1: x(value), x2: x(value), y1: y(0), y2: y(0) + 4, stroke: '#bacbe1' }));
      if (index === 0 || index === ticks.length - 1 || (index % labelEvery === 0 && index < ticks.length - labelEvery)) {
        grid.append(element('text', { transform: `translate(${x(value) + 1} ${y(0) + 12 * scale}) rotate(45)`, 'text-anchor': 'start' }, tickText(value)));
      }
    });
    grid.append(element('rect', { x: margin.left, y: margin.top, width: plotWidth, height: plotHeight, fill: 'none', stroke: '#bdcde4', 'stroke-width': 1 }));
    grid.append(element('text', { x: margin.left + plotWidth / 2, y: height - 4, 'text-anchor': 'middle', fill: '#2c4e78', 'font-size': 8 * scale }, `Mirror ${config.scanMirror + 1} transmission (ppm)`));
    grid.append(element('text', { transform: `translate(${10 * scale} ${margin.top + plotHeight / 2}) rotate(-90)`, 'text-anchor': 'middle' }, isPower ? 'Incident power (%)' : 'κ / 2π (MHz)'));
    if (isPower) grid.append(element('text', { transform: `translate(${width - 5 * scale} ${margin.top + plotHeight / 2}) rotate(90)`, 'text-anchor': 'middle' }, 'Circulating / incident'));
    fragment.append(grid);
    const curves = element('g', { 'clip-path': `url(#${svg.id}-clip)` });
    curves.append(element('line', { x1: x(current.scannedPpm), x2: x(current.scannedPpm), y1: margin.top, y2: y(0), stroke: '#91a5c1', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    series.forEach(seriesItem => {
      const path = data.map((point, index) => `${index ? 'L' : 'M'}${x(point.scannedPpm).toFixed(3)},${y(seriesItem.get(point), seriesItem.right).toFixed(3)}`).join(' ');
      const attrs = { d: path, fill: 'none', stroke: seriesItem.color, 'stroke-width': 1.7, 'stroke-linejoin': 'round' };
      if (seriesItem.dash) attrs['stroke-dasharray'] = seriesItem.dash;
      curves.append(element('path', attrs));
      curves.append(element('circle', { cx: x(current.scannedPpm), cy: y(seriesItem.get(current), seriesItem.right), r: 3, fill: seriesItem.color, stroke: '#fff', 'stroke-width': 0.7 }));
    });
    fragment.append(curves);
    svg.replaceChildren(fragment);
    svg.chartLayout = { margin, width, height, plotWidth, config };
  }
  function pointAt(svg, clientX) {
    const layout = svg.chartLayout;
    if (!layout) return null;
    const localX = (clientX - svg.getBoundingClientRect().left) * layout.width / svg.getBoundingClientRect().width;
    const fraction = Math.max(0, Math.min(1, (localX - layout.margin.left) / layout.plotWidth));
    return layout.config.scanStart + fraction * (layout.config.scanEnd - layout.config.scanStart);
  }
  root.CavityCharts = Object.freeze({ draw, pointAt });
})(window);
