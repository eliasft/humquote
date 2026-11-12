// HUMQuote b2: HUM-branded redesign of Option B. Same calculations (calc.js);
// new layout. Pages: #/ (quote), #/bulk-price-index, #/futures.

import {
  STATES, NETWORK_OPTIONS, DEFAULT_INPUTS,
  toRecords, latestFutures, calculateBulkPrices, bulkPriceIndex, pyRound,
} from './calc.js';

const DATA_URL = '../data/futures.json';
const STALE_AFTER_DAYS = 4;
const THEME_KEY = 'humquote.theme';
const MOBILE = window.matchMedia('(max-width: 900px)');
const DARK = window.matchMedia('(prefers-color-scheme: dark)');

const STATE_ORDER = ['NSW', 'QLD', 'VIC', 'SA'];
const RANGES = [['3M', 3], ['6M', 6], ['1Y', 12], ['2Y', 24], ['All', null]];

const app = {
  records: [],
  fetched: [],
  latestDate: null,
  error: null,
  inputs: { ...DEFAULT_INPUTS },
  state: 'NSW',
  detailsTab: 'costs',
  priceView: 'peak',
  openSections: new Set(['consumption']),
  inputsOpen: false,
  bulkRange: 'All',
  futuresState: 'NSW',
  futuresRange: '2Y',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const num = (v, dp, group = true) => (Number.isFinite(v)
  ? v.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp, useGrouping: group })
  : '—');
const money = (v, dp) => (Number.isFinite(v) ? `$${num(v, dp)}` : '—');
const signed = (v, dp) => (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '') + num(Math.abs(v), dp);

// Python's str(float), so CSV exports match the Streamlit app byte for byte.
const pyStr = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

const fy = (year) => `FY${String(year).slice(-2)}`;

function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const longDate = (iso) => parseDate(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const shortDate = (iso) => parseDate(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

function cutoffFor(range) {
  const months = RANGES.find(([k]) => k === range)?.[1];
  if (!months || !app.latestDate) return null;
  const d = parseDate(app.latestDate);
  d.setMonth(d.getMonth() - months);
  return isoDate(d);
}

// The value on the last date at or before `iso` (for "vs 30 days ago" deltas).
function valueOnOrBefore(series, iso, key) {
  for (let i = series.length - 1; i >= 0; i--) if (series[i].quoteDate <= iso) return series[i][key];
  return undefined;
}

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvDownload(filename, header, rows) {
  const csv = [header, ...rows].map((r) => r.join(',')).join('\n') + '\n';
  download(filename, new Blob([csv], { type: 'text/csv' }));
}

const ICONS = {
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>',
};
const icon = (name) => h('span', { html: ICONS[name], style: 'display:inline-flex' });

// ── Theme ─────────────────────────────────────────────────────────────────────

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : DARK.matches;
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const btn = document.getElementById('theme-toggle');
  btn.innerHTML = isDark() ? ICONS.sun : ICONS.moon;
  btn.setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme');
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* storage unavailable */ }
  applyTheme(saved === 'light' || saved === 'dark' ? saved : null);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
    applyTheme(next);
    render();
  });
  DARK.addEventListener('change', () => {
    if (!document.documentElement.dataset.theme) { applyTheme(null); render(); }
  });
}

// ── Charts ────────────────────────────────────────────────────────────────────

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function chartBase() {
  const font = { family: 'Inter, system-ui, sans-serif', size: 12, color: cssVar('--text-2') };
  const axis = {
    gridcolor: cssVar('--grid'),
    linecolor: cssVar('--axis'),
    zeroline: false,
    tickfont: { ...font, color: cssVar('--muted') },
    automargin: true,
  };
  return {
    layout: {
      font,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      showlegend: false,
      xaxis: { ...axis },
      yaxis: { ...axis },
      hoverlabel: {
        bgcolor: cssVar('--surface'),
        bordercolor: cssVar('--border-strong'),
        font: { family: 'Inter, system-ui, sans-serif', size: 13, color: cssVar('--text') },
      },
    },
    config: { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'] },
  };
}

function plot(el, traces, layout) {
  const base = chartBase();
  window.Plotly.react(el, traces, {
    ...base.layout,
    ...layout,
    xaxis: { ...base.layout.xaxis, ...layout.xaxis },
    yaxis: { ...base.layout.yaxis, ...layout.yaxis },
  }, base.config);
}

const seriesColor = (i) => cssVar(`--series-${i + 1}`);

function legend(items) {
  return h('div', { class: 'legend' }, items.map(({ label, color, line }) =>
    h('span', {}, h('i', { class: line ? 'line' : null, style: `background:${color}` }), label)));
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function segmented(label, options, value, onChange) {
  return h('div', { class: 'segmented', role: 'group', 'aria-label': label },
    options.map(([key, text]) => h('button', {
      type: 'button',
      'aria-pressed': String(key === value),
      onclick: () => { if (key !== value) onChange(key); },
    }, text ?? key)));
}

function dataTable(head, rows, { totalRow = -1, avgCol = -1, keys } = {}) {
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, head.map((c, i) => h('th', { class: i === avgCol ? 'avg' : null }, c)))),
      h('tbody', {}, rows.map((r, ri) => h('tr', { class: ri === totalRow ? 'total' : null },
        r.map((c, ci) => h('td', { class: ci === avgCol ? 'avg' : null },
          ci === 0 && keys?.[ri] ? h('span', { class: 'key', style: `background:${keys[ri]}` }) : null, c)))))));
}

function card(title, sub, ...body) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, title), sub ? h('span', { class: 'sub' }, sub) : null),
    ...body);
}

function updateDataStatus() {
  const el = document.getElementById('data-status');
  if (!app.latestDate) { el.hidden = true; return; }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const age = Math.round((today - parseDate(app.latestDate)) / 86_400_000);
  const stale = age > STALE_AFTER_DAYS;
  el.hidden = false;
  el.className = `data-status${stale ? ' stale' : ''}`;
  el.title = stale
    ? 'The daily data update may have failed: prices are more than 4 days old.'
    : 'ASX settlement prices, updated each weekday after market close.';
  el.replaceChildren(...[
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    stale ? '⚠ ' : null,
    h('span', { class: 'text-long' }, stale ? 'Prices may be out of date · ' : 'ASX data · '),
    shortDate(app.latestDate),
  ].filter(Boolean));
}

// ── Quote page ────────────────────────────────────────────────────────────────

const FIELDS = {
  consumption: {
    title: 'Consumption',
    hint: () => `${num(app.inputs.totalConsumption, 0)} kWh`,
    fields: [
      ['Annual consumption', 'totalConsumption', { unit: 'kWh', step: 10000, min: 0, dp: 2 }],
      ['Peak share', 'peakConsumption', { unit: '%', step: 1, min: 0, max: 100, dp: 2 }],
      ['Shoulder share', 'shoulderConsumption', { unit: '%', step: 1, min: 0, max: 100, dp: 2 }],
      'offpeak',
      ['Load factor', 'loadFactor', { step: 0.01, dp: 4 }],
    ],
  },
  network: {
    title: 'Network charges',
    hint: () => app.inputs.network,
    fields: [
      'network',
      ['Peak charge', 'peakCharge', { unit: 'c/kWh', step: 0.01, dp: 4 }],
      ['Off-peak charge', 'offPeakCharge', { unit: 'c/kWh', step: 0.01, dp: 4 }],
      ['Shoulder charge', 'shoulderCharge', { unit: 'c/kWh', step: 0.01, dp: 4 }],
      ['NUOS charge', 'nuosCharge', { unit: '$/kVA', step: 1, dp: 4 }],
      ['Service availability', 'serviceAvailabilityCharge', { unit: '$/day', step: 0.01, dp: 4 }],
    ],
  },
  system: {
    title: 'System charges',
    fields: [
      ['AEMO participant', 'aemoParticipantCharge', { unit: 'c/kWh', step: 0.01, dp: 4 }],
      ['AEMO ancillary services', 'aemoAncillaryServicesCharge', { unit: 'c/kWh', step: 0.01, dp: 4 }],
      ['SREC', 'srecCharge', { unit: 'c/kWh', step: 0.01, dp: 4 }],
      ['LREC', 'lrecCharge', { unit: 'c/kWh', step: 0.01, dp: 4 }],
    ],
  },
  service: {
    title: 'Service charges',
    fields: [
      ['Metering', 'meteringCharge', { unit: '$/month', step: 1, dp: 2 }],
      ['Retail service', 'retailServiceCharge', { unit: '$/month', step: 1, dp: 2 }],
      ['Admin', 'adminCharge', { unit: '$/month', step: 1, dp: 2 }],
    ],
  },
  escalation: {
    title: 'Escalation factors',
    hint: () => `${num(app.inputs.loadEscalation, 2)} × ${num(app.inputs.retailEscalation, 2)}`,
    fields: [
      ['Load escalation', 'loadEscalation', { step: 0.01, dp: 4 }],
      ['Retail escalation', 'retailEscalation', { step: 0.01, dp: 4 }],
    ],
  },
};

// Shows up to `dp` decimals without hiding precision (0.0991 stays 0.0991);
// the value is only replaced when the user edits it.
function numberField(label, key, { unit, step, min = -Infinity, max = Infinity, dp }, onChange) {
  const input = h('input', { type: 'text', inputmode: 'decimal', id: `in-${key}`, autocomplete: 'off' });
  const show = () => {
    input.value = app.inputs[key].toLocaleString('en-AU', { minimumFractionDigits: dp === 2 ? 2 : 0, maximumFractionDigits: dp });
  };
  const set = (v) => {
    if (!Number.isFinite(v)) return show();
    app.inputs[key] = Math.min(max, Math.max(min, v));
    show();
    onChange();
  };
  input.addEventListener('change', () => set(parseFloat(input.value.replace(/[,\s]/g, ''))));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      set(pyRound(app.inputs[key] + (e.key === 'ArrowUp' ? step : -step), 10));
    }
  });
  show();
  return h('div', { class: 'field' },
    h('label', { for: `in-${key}` }, label),
    h('div', { class: 'num' },
      input,
      unit ? h('span', { class: 'unit' }, unit) : null,
      h('button', { type: 'button', tabindex: '-1', 'aria-label': `Decrease ${label}`, onclick: () => set(pyRound(app.inputs[key] - step, 10)) }, '−'),
      h('button', { type: 'button', tabindex: '-1', 'aria-label': `Increase ${label}`, onclick: () => set(pyRound(app.inputs[key] + step, 10)) }, '+'),
    ));
}

function inputsPanel() {
  const panel = h('aside', { class: `card inputs-panel${app.inputsOpen ? ' open' : ''}`, 'aria-label': 'Quote inputs' });
  const hints = {};
  const refreshHints = () => {
    for (const [id, el] of Object.entries(hints)) el.textContent = FIELDS[id].hint?.() ?? '';
  };
  const changed = () => { refreshHints(); renderResults(); };

  const offPeak = h('div', { class: 'readout' });
  const updateOffPeak = () => {
    const v = 100 - app.inputs.peakConsumption - app.inputs.shoulderConsumption;
    offPeak.replaceChildren('Off-peak share', h('strong', {}, `${num(v, 2)} %`));
  };
  updateOffPeak();

  const build = () => Object.entries(FIELDS).map(([id, section]) => {
    hints[id] = h('span', { class: 'hint' }, section.hint?.() ?? '');
    const body = h('div', { class: 'section-body' }, section.fields.map((f) => {
      if (f === 'offpeak') return offPeak;
      if (f === 'network') {
        return h('div', { class: 'field' },
          h('label', { for: 'in-network' }, 'Network tariff'),
          h('select', {
            class: 'select',
            id: 'in-network',
            onchange: (e) => {
              const p = NETWORK_OPTIONS[e.target.value];
              Object.assign(app.inputs, {
                network: e.target.value,
                peakCharge: p.peak,
                offPeakCharge: p.offPeak,
                shoulderCharge: p.shoulder,
                nuosCharge: p.nuos,
                serviceAvailabilityCharge: p.service,
              });
              redraw();
              changed();
            },
          }, Object.keys(NETWORK_OPTIONS).map((n) => h('option', { value: n, selected: n === app.inputs.network }, n))));
      }
      const [label, key, opts] = f;
      const onChange = section === FIELDS.consumption ? () => { updateOffPeak(); changed(); } : changed;
      return numberField(label, key, opts, onChange);
    }));
    const details = h('details', { class: 'section', open: app.openSections.has(id) },
      h('summary', {}, section.title, hints[id]), body);
    details.addEventListener('toggle', () => {
      if (details.open) app.openSections.add(id); else app.openSections.delete(id);
    });
    return details;
  });

  const scroll = h('div', { class: 'inputs-scroll' });
  const redraw = () => scroll.replaceChildren(...build());
  redraw();

  panel.append(
    h('div', { class: 'card-head' },
      h('h2', {}, 'Quote inputs'),
      h('div', { style: 'display:flex;gap:4px' },
        h('button', {
          class: 'btn ghost mobile-only',
          type: 'button',
          onclick: () => { app.inputsOpen = !app.inputsOpen; panel.classList.toggle('open', app.inputsOpen); },
        }, icon('edit'), 'Edit'),
        h('button', {
          class: 'btn ghost',
          type: 'button',
          title: 'Reset all inputs to their defaults',
          onclick: () => { app.inputs = { ...DEFAULT_INPUTS }; updateOffPeak(); redraw(); changed(); },
        }, icon('reset'), 'Reset'),
      )),
    scroll,
  );
  return panel;
}

function heroCard(r) {
  const n = app.fetched.length;
  const tiles = [0, 1, 2].map((y) => {
    const idx = Math.min(y, n - 1);
    const clamped = idx !== y;
    return h('div', { class: 'year-tile' },
      h('div', { class: 'label' }, `Year ${y + 1}`, h('span', { class: 'fy' }, fy(app.fetched[idx].year))),
      h('div', { class: 'value' }, money(r.rates.rows[4].values[y], 4), h('span', { class: 'unit' }, '/kWh')),
      h('div', { class: 'note' }, clamped ? `Repeats ${fy(app.fetched[idx].year)}, the latest listed strip` : `${money(r.rates.rows[4].values[y] * 1000, 2)}/MWh`));
  });
  return h('section', { class: 'card hero' },
    h('div', { class: 'hero-main' },
      h('div', { class: 'hero-label' }, `Bulk electricity price · ${app.state} · 3-year average`),
      h('div', { class: 'hero-value' }, money(r.bulkPrice, 4), h('span', { class: 'unit' }, '/kWh')),
      h('div', { class: 'hero-sub' }, `${money(r.bulkPrice * 1000, 2)}/MWh · ASX settlement ${longDate(app.latestDate)}`)),
    h('div', { class: 'year-tiles' }, tiles));
}

const COMPONENTS = ['Energy', 'Network', 'Other', 'Fixed'];

function breakdownCard(r) {
  const yearLabels = [0, 1, 2].map((y) => `Year ${y + 1} · ${fy(app.fetched[Math.min(y, app.fetched.length - 1)].year)}`);
  const cats = [...yearLabels, 'Average'];
  const values = COMPONENTS.map((_, i) => [...r.rates.rows[i].values, r.rates.rows[i].average]);
  const totals = [...r.rates.rows[4].values, r.rates.rows[4].average];
  const colors = COMPONENTS.map((_, i) => seriesColor(i));

  const chart = h('div', { class: 'chart', role: 'img', 'aria-label': 'Stacked bars of the energy, network, other and fixed components of the price for each year and the average' });
  queueMicrotask(() => {
    const surface = cssVar('--chart-surface');
    plot(chart, COMPONENTS.map((name, i) => ({
      type: 'bar',
      orientation: 'h',
      name,
      y: cats,
      x: values[i],
      marker: { color: colors[i], line: { color: surface, width: 2 } },
      hovertemplate: `${name}: $%{x:.4f}/kWh<extra></extra>`,
    })), {
      barmode: 'stack',
      bargap: 0.5,
      barcornerradius: 4,
      height: 230,
      margin: { l: 10, r: 70, t: 4, b: 30 },
      xaxis: { tickprefix: '$', tickformat: '.2f', showgrid: true },
      yaxis: { autorange: 'reversed', showgrid: false, ticklen: 6, tickcolor: 'rgba(0,0,0,0)' },
      annotations: cats.map((c, i) => ({
        x: totals[i], y: c, text: money(totals[i], 4), showarrow: false, xanchor: 'left', xshift: 6,
        font: { size: 12, color: cssVar('--text'), family: 'Inter, system-ui, sans-serif' },
      })),
    });
  });

  return card('Price breakdown', '$/kWh by contract year',
    h('div', { class: 'card-body' },
      legend(COMPONENTS.map((c, i) => ({ label: c, color: colors[i] }))),
      chart,
      dataTable(['Component', 'Year 1', 'Year 2', 'Year 3', 'Average'],
        [...COMPONENTS.map((c, i) => [c, ...values[i].map((v) => money(v, 4))]),
          ['Total', ...totals.map((v) => money(v, 4))]],
        { totalRow: 4, avgCol: 4, keys: colors })));
}

const DETAIL_TABS = [
  ['costs', 'Annual costs', (r) => r.costs, 2],
  ['consumption', 'Consumption', (r) => r.consumption, 2],
  ['charges', 'Unit charges', (r) => r.charges, 4],
  ['tariffs', 'Tariffs & factors', (r) => r.energyRates, 4],
];

function detailsCard(r) {
  const body = h('div', { class: 'card-body' });
  const tabs = h('div', { class: 'tabbar', role: 'tablist' });
  const draw = () => {
    const [, , get, dp] = DETAIL_TABS.find(([k]) => k === app.detailsTab);
    const t = get(r);
    const totalRow = app.detailsTab === 'costs' ? 7 : -1;
    body.replaceChildren(dataTable([t.labelHeader, 'Year 1', 'Year 2', 'Year 3', 'Average'],
      // $/kWh rows need 4 decimals to be meaningful (e.g. bundled bulk cost 0.2150, not 0.22).
      t.rows.map((row) => [row.label, ...[...row.values, row.average].map((v) => num(v, row.label.includes('$/kWh') ? 4 : dp))]),
      { totalRow, avgCol: 4 }));
    tabs.replaceChildren(...DETAIL_TABS.map(([k, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(k === app.detailsTab),
      onclick: () => { app.detailsTab = k; draw(); },
    }, label)));
  };
  draw();
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, `Calculation details · ${app.state}`)),
    tabs, body);
}

function futuresCard(r) {
  const body = h('div', { class: 'card-body' });
  const draw = () => {
    const peak = app.priceView === 'peak';
    const rows = (peak ? r.updated : app.fetched).map((row) =>
      [fy(row.year), ...STATE_ORDER.map((s) => num(peak ? row[s] : pyRound(row[s] / 10, 2), 2))]);
    const col = STATE_ORDER.indexOf(app.state) + 1;
    body.replaceChildren(
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px' },
        h('span', { class: 'sub', style: 'color:var(--text-2);font-size:13px' },
          peak ? 'Settle price with load and retail escalation, c/kWh' : 'Settle price without escalation, c/kWh'),
        segmented('Price type', [['peak', 'Peak'], ['base', 'Base']], app.priceView, (v) => { app.priceView = v; draw(); })),
      dataTable(['Contract', ...STATE_ORDER], rows, { avgCol: col }));
  };
  draw();
  return card('ASX futures used', `Settlement ${longDate(app.latestDate)}`, body);
}

function exportExcel(r) {
  const X = window.XLSX;
  const summary = (t) => X.utils.aoa_to_sheet([
    [t.labelHeader, 'Year 1', 'Year 2', 'Year 3', 'Average'],
    ...t.rows.map((row) => [row.label, ...row.values, row.average]),
  ]);
  const priceCols = ['Quote Date', 'Year', ...STATES];
  const peakRows = r.updated.map((u) => [u.quoteDate, String(u.year), ...STATES.map((s) => u[s])]);
  const baseRows = app.fetched.map((f) => [f.quoteDate, String(f.year), ...STATES.map((s) => pyRound(f[s] / 10, 2))]);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, summary(r.rates), 'Bulk Prices');
  X.utils.book_append_sheet(wb, summary(r.consumption), 'Consumption');
  X.utils.book_append_sheet(wb, summary(r.costs), 'Yearly Costs');
  X.utils.book_append_sheet(wb, summary(r.energyRates), 'Energy Rates');
  X.utils.book_append_sheet(wb, summary(r.charges), 'Charges');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([priceCols, ...peakRows]), 'Peak Prices');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([priceCols, ...baseRows]), 'Off-Peak Prices');
  X.writeFile(wb, `bulk-electricity-pricing-${app.state}-${app.latestDate}.xlsx`);
}

let resultsEl = null;

function renderResults() {
  if (!resultsEl) return;
  const r = calculateBulkPrices(app.fetched, app.inputs, app.state);
  const scrollY = window.scrollY;
  resultsEl.replaceChildren(
    h('div', { class: 'filter-row', style: 'margin-bottom:0' },
      segmented('State', STATE_ORDER.map((s) => [s]), app.state, (s) => { app.state = s; renderResults(); }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => exportExcel(r) }, icon('download'), 'Export to Excel')),
    heroCard(r),
    breakdownCard(r),
    detailsCard(r),
    futuresCard(r),
  );
  window.scrollTo(0, scrollY);
}

function quotePage() {
  resultsEl = h('div', { class: 'stack' });
  const page = [
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Bulk electricity quote'),
        h('p', {}, 'Estimate a three-year bulk price for a large contract from the latest ASX futures.'))),
    h('div', { class: 'quote-layout' }, inputsPanel(), resultsEl),
  ];
  queueMicrotask(renderResults);
  return page;
}

// ── Bulk price index page ─────────────────────────────────────────────────────

function bulkPage() {
  const index = bulkPriceIndex(app.records);
  const last = index[index.length - 1];
  const monthAgo = parseDate(last.quoteDate);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const tiles = h('div', { class: 'tiles' }, STATE_ORDER.map((s, i) => {
    const before = valueOnOrBefore(index, isoDate(monthAgo), s);
    return h('div', { class: 'card tile' },
      h('div', { class: 'label' }, h('span', { class: 'key', style: `background:${seriesColor(i)}` }), s),
      h('div', { class: 'value' }, money(last[s], 4), h('span', { class: 'unit' }, '/kWh')),
      h('div', { class: 'delta' }, before === undefined ? '—' : `${signed(last[s] - before, 4)} vs 30 days ago`));
  }));

  const chart = h('div', { class: 'chart', role: 'img', 'aria-label': 'Line chart of the bulk price index by state over time' });
  const tableBox = h('div', { class: 'scroll-table' });

  const draw = () => {
    const cutoff = cutoffFor(app.bulkRange);
    const rows = cutoff ? index.filter((d) => d.quoteDate >= cutoff) : index;
    plot(chart, STATE_ORDER.map((s, i) => ({
      type: 'scatter', mode: 'lines', name: s,
      x: rows.map((d) => d.quoteDate), y: rows.map((d) => d[s]),
      line: { color: seriesColor(i), width: 2, shape: 'linear' },
      hovertemplate: `${s}: $%{y:.4f}/kWh<extra></extra>`,
    })), {
      height: 420,
      margin: { l: 10, r: 16, t: 10, b: 30 },
      hovermode: 'x unified',
      xaxis: { showgrid: false, showspikes: true, spikemode: 'across', spikethickness: 1, spikecolor: cssVar('--axis'), spikedash: 'solid' },
      yaxis: { tickprefix: '$', tickformat: '.2f' },
    });
    const cols = ['NSW', 'QLD', 'SA', 'VIC'];
    tableBox.replaceChildren(dataTable(['Quote date', ...cols],
      [...rows].reverse().map((d) => [shortDate(d.quoteDate), ...cols.map((c) => money(d[c], 4))])));
  };

  const rangeCtl = h('div', {});
  const drawRange = () => rangeCtl.replaceChildren(segmented('Date range', RANGES.map(([k]) => [k]), app.bulkRange,
    (k) => { app.bulkRange = k; drawRange(); draw(); }));
  drawRange();
  queueMicrotask(draw);

  // pandas pivot orders state columns alphabetically; keep the CSV identical.
  const csvCols = ['NSW', 'QLD', 'SA', 'VIC'];
  const desc = [...index].reverse();

  return [
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Bulk price index'),
        h('p', {}, 'Indicative bulk price for a reference 400,000 kWh contract, recalculated for every ASX settlement date.'))),
    h('div', { class: 'filter-row' },
      rangeCtl,
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => csvDownload('historical_bulk_price_index.csv', ['Quote Date', ...csvCols],
          desc.map((d) => [d.quoteDate, ...csvCols.map((c) => pyStr(d[c]))])),
      }, icon('download'), 'Download CSV')),
    tiles,
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Index by state'), h('span', { class: 'sub' }, '$/kWh')),
      h('div', { class: 'card-body' }, legend(STATE_ORDER.map((s, i) => ({ label: s, color: seriesColor(i), line: true }))), chart),
      h('details', { class: 'disclosure' }, h('summary', {}, 'Show data table'), tableBox)),
  ];
}

// ── Futures page ──────────────────────────────────────────────────────────────

function futuresPage() {
  const activeYears = app.fetched.map((r) => r.year);
  const years = [...new Set(app.records.map((r) => r.year))].sort((a, b) => a - b);
  const expiredYears = years.filter((y) => !activeYears.includes(y));
  const tiles = h('div', { class: 'tiles' });
  const chart = h('div', { class: 'chart', role: 'img', 'aria-label': 'Line chart of futures settlement prices by contract year' });
  const legendBox = h('div', {});
  const tableBox = h('div', { class: 'scroll-table' });

  const draw = () => {
    const s = app.futuresState;
    const cutoff = cutoffFor(app.futuresRange);
    const inRange = (r) => !cutoff || r.quoteDate >= cutoff;
    const monthAgo = parseDate(app.latestDate);
    monthAgo.setDate(monthAgo.getDate() - 30);

    tiles.replaceChildren(...activeYears.map((y, i) => {
      const series = app.records.filter((r) => r.year === y).sort((a, b) => (a.quoteDate < b.quoteDate ? -1 : 1));
      const latest = series[series.length - 1][s];
      const before = valueOnOrBefore(series, isoDate(monthAgo), s);
      return h('div', { class: 'card tile' },
        h('div', { class: 'label' }, h('span', { class: 'key', style: `background:${seriesColor(i)}` }), `${fy(y)} · ${s}`),
        h('div', { class: 'value' }, money(latest, 2), h('span', { class: 'unit' }, '/MWh')),
        h('div', { class: 'delta' }, before === undefined ? 'New contract' : `${signed(latest - before, 2)} vs 30 days ago`));
    }));

    const trace = (y, color, width, active) => {
      const rows = app.records.filter((r) => r.year === y && inRange(r)).sort((a, b) => (a.quoteDate < b.quoteDate ? -1 : 1));
      return {
        type: 'scatter', mode: 'lines', name: fy(y),
        x: rows.map((r) => r.quoteDate), y: rows.map((r) => r[s]),
        line: { color, width, shape: 'linear' },
        hovertemplate: `${fy(y)}: $%{y:.2f}/MWh<extra></extra>`,
        opacity: active ? 1 : 0.9,
      };
    };
    const expiredColor = cssVar('--series-expired');
    const traces = [
      ...expiredYears.map((y) => trace(y, expiredColor, 1.5, false)),
      ...activeYears.map((y, i) => trace(y, seriesColor(i), 2, true)),
    ].filter((t) => t.x.length);

    plot(chart, traces, {
      height: 440,
      margin: { l: 10, r: 16, t: 10, b: 30 },
      hovermode: 'x unified',
      xaxis: { showgrid: false, showspikes: true, spikemode: 'across', spikethickness: 1, spikecolor: cssVar('--axis'), spikedash: 'solid' },
      yaxis: { tickprefix: '$', tickformat: ',.0f' },
    });

    legendBox.replaceChildren(legend([
      ...activeYears.map((y, i) => ({ label: `${fy(y)} (trading)`, color: seriesColor(i), line: true })),
      ...(traces.length > activeYears.length ? [{ label: 'Expired contracts', color: expiredColor, line: true }] : []),
    ]));

    const rows = app.records.filter(inRange);
    tableBox.replaceChildren(dataTable(['Quote date', 'Contract', ...STATE_ORDER],
      rows.map((r) => [shortDate(r.quoteDate), fy(r.year), ...STATE_ORDER.map((k) => num(r[k], 2))])));
  };

  const controls = h('div', { style: 'display:contents' });
  const drawControls = () => controls.replaceChildren(
    segmented('State', STATE_ORDER.map((s) => [s]), app.futuresState, (s) => { app.futuresState = s; drawControls(); draw(); }),
    segmented('Date range', RANGES.map(([k]) => [k]), app.futuresRange, (k) => { app.futuresRange = k; drawControls(); draw(); }),
  );
  drawControls();
  queueMicrotask(draw);

  return [
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'ASX futures'),
        h('p', {}, 'Financial-year base strip settlement prices by contract year.'))),
    h('div', { class: 'filter-row' },
      controls,
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => csvDownload('historical-futures-data.csv', ['Quote Date', 'Year', ...STATES],
          app.records.map((r) => [r.quoteDate, r.year, ...STATES.map((k) => pyStr(r[k]))])),
      }, icon('download'), 'Download CSV')),
    tiles,
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Settlement prices'), h('span', { class: 'sub' }, '$/MWh')),
      h('div', { class: 'card-body' }, legendBox, chart),
      h('details', { class: 'disclosure' }, h('summary', {}, 'Show data table'), tableBox)),
  ];
}

// ── Routing ───────────────────────────────────────────────────────────────────

const PAGES = {
  quote: { render: quotePage, title: 'HUMQuote · Quote' },
  bulk: { render: bulkPage, title: 'HUMQuote · Bulk price index' },
  futures: { render: futuresPage, title: 'HUMQuote · ASX futures' },
};

function currentPage() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash === 'bulk-price-index') return 'bulk';
  if (hash === 'futures') return 'futures';
  return 'quote';
}

function render() {
  const page = currentPage();
  document.title = PAGES[page].title;
  document.querySelectorAll('.tabs a').forEach((a) => {
    const active = a.dataset.page === page;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const main = document.getElementById('page');
  resultsEl = null;
  if (app.error) {
    main.replaceChildren(h('div', { class: 'notice error' }, app.error));
    return;
  }
  if (!app.fetched.length) {
    main.replaceChildren(h('div', { class: 'notice' }, 'Loading prices…'));
    return;
  }
  main.replaceChildren(...PAGES[page].render());
}

async function init() {
  initTheme();
  app.inputsOpen = !MOBILE.matches;
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  render();

  try {
    // Bust the browser cache roughly hourly so the daily data update shows up promptly.
    const res = await fetch(`${DATA_URL}?v=${Math.floor(Date.now() / 3_600_000)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    app.records = toRecords(json.rows);
    app.fetched = latestFutures(app.records);
    app.latestDate = app.fetched[0]?.quoteDate ?? null;
    if (!app.fetched.length) app.error = 'No futures data found.';
  } catch (e) {
    app.error = `Could not load futures data: ${e.message}`;
  }
  updateDataStatus();
  render();
}

init();

// Exposed for testing in the browser console.
window.humquote = { app, calculateBulkPrices, bulkPriceIndex };
