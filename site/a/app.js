// HUMQuote version A: the HUM-branded calculator, with futures organised by
// contract type (financial years, calendar years, quarters) and a forward curve.
// Calculations, contract periods and the tariff catalogue come from core.js,
// built from app-b/src/core, so versions A and B give identical results.
// Pages: #/ (quote), #/bulk-price-index, #/futures, #/tariffs.

import {
  STATES, STATE_ORDER, DEFAULT_INPUTS, VOLTAGES, TARIFF_YEAR, DEFAULT_CARRY_FORWARD_RATE,
  toRecords, latestFutures, calculateBulkPrices, legacyBulkPriceIndex, bulkPriceIndex, pyRound,
  buildCurves, quotePeriods, quoteWarnings, compareStates, inputsForState, indexInputs, validateInputs,
  applyTariff, tariffMatches, tariffById, demandKva, demandLineLabels, estimatedDemand, startBill, tariffState, tariffLabel, networkOf,
  networksFor, tariffsOf, defaultNetwork, suggestTariff, fitIssues, tariffOptionLabel,
  TARIFFS, rateHistory, eligibilityText, DEMAND_BASIS,
  monthIndex, monthKey, monthLabel, nextQuarter, periodRange, shortContract, estimateLabel,
  KIND_ORDER, KIND_LABELS, contractKind, groupByKind, contractHistory,
} from './core.js';

const DATA_URL = '../data/futures.json';
const STALE_AFTER_DAYS = 4;
const THEME_KEY = 'humquote.theme';
const MOBILE = window.matchMedia('(max-width: 900px)');
const DARK = window.matchMedia('(prefers-color-scheme: dark)');

const RANGES = [['3M', 3], ['6M', 6], ['1Y', 12], ['2Y', 24], ['All', null]];

const app = {
  records: [],
  strips: [],
  curves: new Map(),
  curve: [],
  latestFy: [],
  latestDate: null,
  error: null,
  inputs: { ...DEFAULT_INPUTS },
  state: 'NSW',
  detailsTab: 'costs',
  priceView: 'settle',
  openSections: new Set(['contract', 'consumption']),
  inputsOpen: false,
  bulkRange: 'All',
  bulkMethod: 'current',
  bulkState: 'NSW',
  bulkCarryRate: DEFAULT_CARRY_FORWARD_RATE,
  futuresState: 'NSW',
  futuresKind: 'FY',
  futuresRange: '2Y',
  tariffsState: 'All',
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
  for (const c of children.flat(Infinity)) {
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

function segmented(label, options, value, onChange, extraClass) {
  return h('div', { class: `segmented${extraClass ? ` ${extraClass}` : ''}`, role: 'group', 'aria-label': label },
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
  contract: {
    title: 'Contract',
    hint: () => `From ${monthLabel(quotePeriods(app.curve, app.inputs)[0]?.start ?? nextQuarter(app.latestDate))}`,
    fields: [
      'supplyStart',
      ['Carry-forward escalation', 'carryForwardRate', { unit: '% a year', step: 0.5, dp: 2 }],
      'carryHelp',
    ],
  },
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
    hint: () => {
      const t = tariffById(app.inputs.tariffId);
      return t ? `${app.inputs.voltage} · ${networkOf(t).name} ${t.status === 'placeholder' ? '(placeholder)' : t.code}` : '';
    },
    fields: [
      'voltage',
      'network',
      'tariff',
      ['Peak charge', 'peakCharge', { unit: 'c/kWh', step: 0.01, dp: 4 }],
      ['Shoulder charge', 'shoulderCharge', { unit: 'c/kWh', step: 0.01, dp: 4 }],
      ['Off-peak charge', 'offPeakCharge', { unit: 'c/kWh', step: 0.01, dp: 4 }],
      ['Service availability', 'serviceAvailabilityCharge', { unit: '$/day', step: 0.01, dp: 4 }],
      'demandRates',
      'bill',
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
// the value is only replaced when the user edits it. `access` reads and writes a
// value that isn't a plain input (one entry of a list such as demandRates).
function numberField(label, key, { unit, step, min = -Infinity, max = Infinity, dp }, onChange, access) {
  const get = access?.get ?? (() => app.inputs[key]);
  const put = access?.set ?? ((v) => { app.inputs[key] = v; });
  const input = h('input', { type: 'text', inputmode: 'decimal', id: `in-${key}`, autocomplete: 'off' });
  const show = () => {
    input.value = get().toLocaleString('en-AU', { minimumFractionDigits: dp === 2 ? 2 : 0, maximumFractionDigits: dp });
  };
  const set = (v) => {
    if (!Number.isFinite(v)) return show();
    put(Math.min(max, Math.max(min, v)));
    show();
    onChange();
  };
  input.addEventListener('change', () => set(parseFloat(input.value.replace(/[,\s]/g, ''))));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      set(pyRound(get() + (e.key === 'ArrowUp' ? step : -step), 10));
    }
  });
  show();
  return h('div', { class: 'field' },
    h('label', { for: `in-${key}` }, label),
    h('div', { class: 'num' },
      input,
      unit ? h('span', { class: 'unit' }, unit) : null,
      h('button', { type: 'button', tabindex: '-1', 'aria-label': `Decrease ${label}`, onclick: () => set(pyRound(get() - step, 10)) }, '−'),
      h('button', { type: 'button', tabindex: '-1', 'aria-label': `Increase ${label}`, onclick: () => set(pyRound(get() + step, 10)) }, '+'),
    ));
}

function selectField(id, label, groups, value, onChange, help) {
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('select', { class: 'select', id, onchange: (e) => onChange(e.target.value) },
      groups.flatMap(({ label: groupLabel, options }) => {
        const opts = options.map(([v, text]) => h('option', { value: v, selected: v === value }, text));
        return groupLabel ? [h('optgroup', { label: groupLabel }, opts)] : opts;
      })),
    help ? h('p', { class: 'help' }, help) : null);
}

// The network the quote's tariff belongs to (its state's default if the tariff is
// from another state), and the tariff it suggests for this site.
function currentNetwork() {
  const t = tariffById(app.inputs.tariffId);
  return t && tariffState(t.id) === app.state ? networkOf(t) : defaultNetwork(app.state);
}
const siteMWh = () => app.inputs.totalConsumption / 1000;

function networkField(redraw) {
  const options = networksFor(app.state).map((n) => [n.id,
    tariffsOf(n.id).every((t) => t.status === 'placeholder') ? `${n.name} (placeholder tariffs)` : n.name]);
  return selectField('in-network', `Network · ${app.state}`, [{ options }], currentNetwork().id, (id) => {
    app.inputs = applyTariff(app.inputs, suggestTariff(id, siteMWh(), app.inputs.voltage));
    redraw();
  });
}

// The network's tariff codes, as shown on a site's bill; a tariff from another
// state (from an earlier session) stays listed so the field still shows it.
function tariffField(redraw) {
  const tState = tariffState(app.inputs.tariffId);
  const groups = [{
    options: tariffsOf(currentNetwork().id).map((t) => [t.id,
      tariffOptionLabel(t) + (fitIssues(t, siteMWh(), app.inputs.voltage).length ? ' (doesn\'t fit this site)' : '')]),
  }];
  if (tState && tState !== app.state) {
    groups.push({ label: `Other state (${tState})`, options: [[app.inputs.tariffId, tariffLabel(app.inputs.tariffId)]] });
  }
  const edited = !tariffMatches(app.inputs);
  const help = h('span', {}, `As shown on the site's bill. ${TARIFF_YEAR} rates; choosing a tariff fills in its network charges.`,
    edited ? h('span', {}, ' Edited · ', h('button', {
      type: 'button',
      onclick: () => { app.inputs = applyTariff(app.inputs, tariffById(app.inputs.tariffId)); redraw(); },
    }, 'restore tariff rates')) : null);
  return selectField('in-tariff', 'Tariff code', groups, app.inputs.tariffId, (id) => {
    app.inputs = applyTariff(app.inputs, tariffById(id));
    redraw();
  }, help);
}

function tariffCallouts(redraw) {
  const t = tariffById(app.inputs.tariffId);
  const tState = tariffState(app.inputs.tariffId);
  const mismatch = tState && tState !== app.state;
  const issues = t && !mismatch ? fitIssues(t, siteMWh(), app.inputs.voltage) : [];
  const suggestion = suggestTariff(currentNetwork().id, siteMWh(), app.inputs.voltage);
  const use = (tariff, label) => h('button', {
    type: 'button',
    onclick: () => { app.inputs = applyTariff(app.inputs, tariff); redraw(); },
  }, label);
  return [
    mismatch ? h('p', { class: 'callout danger' },
      `This tariff is for ${tState}, but the quote is for ${app.state}. `,
      use(suggestTariff(defaultNetwork(app.state).id, siteMWh(), app.inputs.voltage), `Use ${app.state}'s default network`)) : null,
    issues.length ? h('p', { class: 'callout' }, `${issues.join(' ')} `,
      suggestion.id !== app.inputs.tariffId ? use(suggestion, `Use ${tariffOptionLabel(suggestion)}`) : null) : null,
    t?.status === 'placeholder' ? h('p', { class: 'callout' },
      'Placeholder rates: this tariff hasn\'t been researched yet, so its charges are stand-ins and the quote is indicative only.') : null,
    // The network's time windows, which the consumption shares should follow, and
    // how the published tariff was simplified for the model.
    t && (t.periods || t.notes.length) ? h('div', { class: 'tariff-info' },
      t.periods ? h('p', {}, h('strong', {}, 'Time windows: '), t.periods) : null,
      ...t.notes.map((n) => h('p', {}, n))) : null,
  ];
}

function supplyStartField(changed) {
  const first = nextQuarter(app.latestDate);
  const options = [['auto', `Next quarter (${monthLabel(first)})`],
    // Or any month in the next three years.
    ...Array.from({ length: 36 }, (_, i) => monthIndex(app.latestDate.slice(0, 7)) + 1 + i).filter((m) => m !== first)
      .map((m) => [monthKey(m), monthLabel(m)])];
  return selectField('in-supplyStart', 'Supply start', [{ options }], app.inputs.supplyStart,
    (v) => { app.inputs.supplyStart = v; changed(); }, 'Three 12-month periods from this date. A start part-way through a quarter weights each part quarter by its days.');
}

const BASIS_HINT = {
  month: 'average of the monthly maximums on the last 12 bills',
  '12 months': 'highest in the last 12 months (latest bill)',
  agreed: 'authorised demand',
};

// One rate per demand charge on the tariff's bill (Essential BLND3AO: peak, shoulder
// and off-peak demand).
function demandRateFields(changed) {
  const rates = app.inputs.demandRates;
  if (!rates.length) return h('p', { class: 'footnote', style: 'margin:0' }, 'No demand charge on this tariff.');
  const lines = tariffById(app.inputs.tariffId)?.demand.lines ?? [];
  const labels = demandLineLabels(app.inputs);
  const fields = rates.map((_, i) => numberField(labels[i], `demandRates-${i}`, { unit: '$/kVA/mo', step: 1, dp: 4 }, changed, {
    get: () => app.inputs.demandRates[i],
    set: (v) => { app.inputs.demandRates = app.inputs.demandRates.map((r, j) => (j === i ? v : r)); },
  }));
  const windows = lines.length === rates.length
    ? h('p', { class: 'footnote', style: 'margin:0' }, lines.map((l) => `${l.label}: ${l.window}`).join(' · ')) : null;
  return [...fields, windows];
}

// Network charges from the client's bill: each demand line's kVA and the kWh in the
// network's windows. Off: the estimated demand on every line and the consumption shares.
function billFields(redraw, changed) {
  const inputs = app.inputs;
  const toggle = h('div', { class: 'field' },
    h('label', {}, 'Demand and network energy'),
    segmented('Demand and network energy', [['estimate', 'Estimate'], ['bill', "Client's bill"]],
      inputs.fromBill ? 'bill' : 'estimate', (v) => {
        app.inputs = v === 'bill' ? startBill(app.inputs) : { ...app.inputs, fromBill: false };
        redraw();
      }, 'full'));
  if (!inputs.fromBill) {
    return h('div', { class: 'bill-box' }, toggle, h('p', { class: 'footnote', style: 'margin:0' },
      `Every demand charge uses the estimated demand, ${num(estimatedDemand(inputs), 1)} kVA (consumption ÷ 8,760 h ÷ load factor), `
      + "and network energy uses the consumption shares in the network's windows. Use the client's bill for its figures."));
  }
  const tariff = tariffById(inputs.tariffId);
  const lines = tariff?.demand.lines ?? [];
  const labels = demandLineLabels(inputs);
  const kva = demandKva(inputs);
  const kvaFields = kva.map((_, i) => numberField(`${labels[i]} (kVA)`, `billKva-${i}`, { unit: 'kVA', step: 1, min: 0, dp: 1 }, changed, {
    get: () => demandKva(app.inputs)[i],
    set: (v) => { app.inputs.billKva = demandKva(app.inputs).map((k, j) => (j === i ? v : k)); },
  }));
  const flat = inputs.peakCharge === inputs.shoulderCharge && inputs.shoulderCharge === inputs.offPeakCharge;
  const windows = tariff?.energyWindows ?? null;
  const kwhFields = flat ? [] : [['Peak', 'peak'], ['Shoulder', 'shoulder'], ['Off-peak', 'offPeak']]
    .map(([label, key], i) => ({ label, key, i, window: windows ? windows[key] : '' }))
    .filter((f) => f.window !== null)
    .map((f) => numberField(`${f.label} kWh`, `billKwh-${f.i}`, { unit: 'kWh', step: 1000, min: 0, dp: 0 }, changed, {
      get: () => app.inputs.billKwh[f.i] ?? 0,
      set: (v) => { app.inputs.billKwh = [0, 1, 2].map((j) => (j === f.i ? v : app.inputs.billKwh[j] ?? 0)); },
    }));
  const notes = [
    lines.length === kva.length && lines.length ? lines.map((l) => `${l.label}: ${BASIS_HINT[l.basis]}`).join(' · ') : null,
    windows && kwhFields.length ? `kWh for the last 12 months in the network's windows: ${[['Peak', 'peak'], ['Shoulder', 'shoulder'], ['Off-peak', 'offPeak']]
      .filter(([, k]) => windows[k]).map(([l, k]) => `${l} ${windows[k]}`).join(' · ')}. Network energy charges use this split of the annual consumption.` : null,
  ].filter(Boolean).map((t) => h('p', { class: 'footnote', style: 'margin:0' }, t));
  return h('div', { class: 'bill-box' }, toggle, ...kvaFields, ...kwhFields, ...notes);
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

  // Re-draws the panel (tariff choices change with state, voltage and size) and the results.
  const redraw = () => { scroll.replaceChildren(...build()); changed(); };

  const build = () => Object.entries(FIELDS).map(([id, section]) => {
    hints[id] = h('span', { class: 'hint' }, section.hint?.() ?? '');
    const body = h('div', { class: 'section-body' }, section.fields.map((f) => {
      if (f === 'offpeak') return offPeak;
      if (f === 'supplyStart') return supplyStartField(changed);
      if (f === 'carryHelp') {
        return h('p', { class: 'footnote', style: 'margin:0' }, 'An assumption, used only for months beyond the last listed ASX contract; those periods are flagged as estimates.');
      }
      if (f === 'voltage') {
        // A tariff is for one voltage, so changing it picks the network's tariff for the site.
        return h('div', { class: 'field' },
          h('label', {}, 'Connection voltage'),
          segmented('Connection voltage', VOLTAGES.map((v) => [v.value, v.label]), app.inputs.voltage, (v) => {
            app.inputs = applyTariff({ ...app.inputs, voltage: v }, suggestTariff(currentNetwork().id, siteMWh(), v));
            redraw();
          }, 'full'));
      }
      if (f === 'network') return networkField(redraw);
      if (f === 'tariff') return [tariffField(redraw), ...tariffCallouts(redraw)];
      if (f === 'demandRates') return demandRateFields(changed);
      if (f === 'bill') return billFields(redraw, changed);
      const [label, key, opts] = f;
      // Consumption decides which tariffs fit, so it redraws the network section too.
      const onChange = key === 'totalConsumption' ? () => { updateOffPeak(); redraw(); }
        : section === FIELDS.consumption ? () => { updateOffPeak(); changed(); } : changed;
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
  scroll.replaceChildren(...build());
  inputsRedraw = redraw;

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
          onclick: () => { app.inputs = inputsForState({ ...DEFAULT_INPUTS }, app.state); updateOffPeak(); redraw(); },
        }, icon('reset'), 'Reset'),
      )),
    scroll,
  );
  return panel;
}

let inputsRedraw = null;

function flag(period) {
  return period.estimates.length ? h('span', { class: 'flag', title: period.note, tabindex: '0' }, '⚠ Estimate') : null;
}

function warningsCard(warnings) {
  if (!warnings.length) return null;
  const title = { invalid: 'Check inputs', mismatch: 'Tariff from another state', eligibility: 'Tariff doesn\'t fit the site', placeholder: 'Placeholder tariff', estimate: 'Estimated price' };
  return h('div', { class: 'warnings', role: 'status' }, warnings.map((w) =>
    h('p', { class: w.kind === 'mismatch' || w.kind === 'invalid' ? 'mismatch' : null }, '⚠ ', h('strong', {}, `${title[w.kind]}.`), ` ${w.message}`)));
}

function heroCard(r, periods) {
  const tiles = periods.map((p, y) => h('div', { class: `year-tile${p.estimates.length ? ' estimate' : ''}` },
    h('div', { class: 'label' }, `Year ${y + 1}`, h('span', { class: 'fy', title: periodRange(p.start) }, p.label)),
    h('div', { class: 'value' }, money(r.rates.rows[4].values[y], 4), h('span', { class: 'unit' }, '/kWh')),
    h('div', { class: 'note' }, flag(p) ?? `${money(r.rates.rows[4].values[y] * 1000, 2)}/MWh`)));
  return h('section', { class: 'card hero' },
    h('div', { class: 'hero-main' },
      h('div', { class: 'hero-label' }, `Bulk electricity price · ${app.state} · 3-year average from ${monthLabel(periods[0].start)}`),
      h('div', { class: 'hero-value' }, money(r.bulkPrice, 4), h('span', { class: 'unit' }, '/kWh')),
      h('div', { class: 'hero-sub' }, `${money(r.bulkPrice * 1000, 2)}/MWh · ${tariffLabel(app.inputs.tariffId)} · ASX settlement ${longDate(app.latestDate)}`)),
    h('div', { class: 'year-tiles' }, tiles));
}

const COMPONENTS = ['Energy', 'Network', 'Other', 'Fixed'];

function breakdownCard(r, periods) {
  const cats = [...periods.map((p, y) => `Year ${y + 1} · ${p.label}${p.estimates.length ? '*' : ''}`), 'Average'];
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
        { totalRow: 4, avgCol: 4, keys: colors }),
      periods.some((p) => p.estimates.length) ? h('p', { class: 'footnote' }, '* Includes estimated months: see Contract periods below.') : null));
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

// Which ASX contracts priced each year; periods built from quarters list them beneath.
function periodsCard(r, periods) {
  const body = h('div', { class: 'card-body' });
  const draw = () => {
    const view = app.priceView;
    const value = (row, s) => (view === 'settle' ? money(row[s], 2) : num(pyRound(row[s] / 10, 2), 2));
    const rows = [];
    const subRows = new Set();
    periods.forEach((p, i) => {
      rows.push([`Year ${i + 1} · ${p.label}`, periodRange(p.start),
        h('span', {}, p.sources.map((c) => h('span', { class: 'kind-tag', title: KIND_LABELS[contractKind({ contract: c })] }, shortContract(c))), ' ', flag(p)),
        ...STATE_ORDER.map((s) => (view === 'peak' ? num(r.updated[i][s], 2) : value(p, s)))]);
      for (const q of p.quarters ?? []) {
        subRows.add(rows.length);
        rows.push([q.months < 3 ? `${periodRange(q.from, q.months)} (part, ${q.days} days)` : periodRange(q.from, 3), '',
          `${shortContract(q.source)}${q.estimate ? ` ${estimateLabel(q.estimate).toLowerCase()}` : ''}`,
          ...STATE_ORDER.map((s) => (view === 'peak' ? '' : value(q, s)))]);
      }
    });
    const table = dataTable(['Period', 'Months', 'Priced from', ...STATE_ORDER], rows, { avgCol: STATE_ORDER.indexOf(app.state) + 3 });
    table.querySelectorAll('tbody tr').forEach((tr, i) => { if (subRows.has(i)) tr.classList.add('sub'); });
    const caption = {
      settle: 'ASX base settle price for each contract period, $/MWh. A period without a matching annual strip averages its four quarters.',
      peak: 'Settle price with load and retail escalation, c/kWh (peak and shoulder energy rate).',
      base: 'Settle price without escalation, c/kWh (off-peak energy rate).',
    }[view];
    body.replaceChildren(...[
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px' },
        h('span', { class: 'sub', style: 'color:var(--text-2);font-size:13px;max-width:560px' }, caption),
        segmented('Price type', [['settle', 'Settle'], ['peak', 'Peak'], ['base', 'Base']], view, (v) => { app.priceView = v; draw(); })),
      table,
      periods.some((p) => p.estimates.length) ? h('p', { class: 'footnote warn' },
        'Carried forward: beyond the last listed ASX contract, its price escalated by the carry-forward rate for each year beyond it. Back-filled: before the first listed contract, the earliest listed price, unescalated.') : null,
    ].filter(Boolean));
  };
  draw();
  return card('Contract periods', `ASX settlement ${longDate(app.latestDate)}`, body);
}

// The Streamlit app's seven sheets plus Inputs and Contract Periods, so the file
// records how the quote was built and flags any estimates.
function exportExcel(r, periods, warnings) {
  const X = window.XLSX;
  const summary = (t) => X.utils.aoa_to_sheet([
    [t.labelHeader, 'Year 1', 'Year 2', 'Year 3', 'Average'],
    ...t.rows.map((row) => [row.label, ...row.values, row.average]),
  ]);
  const priceCols = ['Quote Date', 'Period', ...STATES];
  const peakRows = r.updated.map((u, i) => [u.quoteDate, periods[i].label, ...STATES.map((s) => u[s])]);
  const baseRows = periods.map((f) => [f.quoteDate, f.label, ...STATES.map((s) => pyRound(f[s] / 10, 2))]);
  const tariff = tariffById(app.inputs.tariffId);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, summary(r.rates), 'Bulk Prices');
  X.utils.book_append_sheet(wb, summary(r.consumption), 'Consumption');
  X.utils.book_append_sheet(wb, summary(r.costs), 'Yearly Costs');
  X.utils.book_append_sheet(wb, summary(r.energyRates), 'Energy Rates');
  X.utils.book_append_sheet(wb, summary(r.charges), 'Charges');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([priceCols, ...peakRows]), 'Peak Prices');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([priceCols, ...baseRows]), 'Off-Peak Prices');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
    ['Input', 'Value'],
    ['State', app.state],
    ['ASX settlement date', app.latestDate],
    ['Supply start', monthLabel(periods[0].start)],
    ['Network tariff', tariffLabel(app.inputs.tariffId)],
    ['Tariff status', tariff ? `${tariff.status}: ${tariff.source}` : 'unknown'],
    ...Object.entries(app.inputs).filter(([k]) => !['tariffId', 'supplyStart'].includes(k)),
    [],
    ['Warnings', warnings.length ? '' : 'None'],
    ...warnings.map((w) => ['', w.message]),
  ]), 'Inputs');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
    ['Year', 'Period', 'Months', 'Priced from', 'Estimate', ...STATES.map((s) => `${s} ($/MWh)`)],
    ...periods.map((p, i) => [`Year ${i + 1}`, p.label, periodRange(p.start), p.sources.join(', '),
      p.note ?? 'No', ...STATES.map((s) => p[s])]),
  ]), 'Contract Periods');
  X.writeFile(wb, `bulk-electricity-pricing-${app.state}-${app.latestDate}.xlsx`);
}

let resultsEl = null;

function setState(s) {
  app.state = s;
  // A tariff only applies in its own state: switch to the new state's default.
  app.inputs = inputsForState(app.inputs, s);
  if (inputsRedraw) inputsRedraw(); else renderResults();
}

function renderResults() {
  if (!resultsEl) return;
  const periods = quotePeriods(app.curve, app.inputs);
  const r = calculateBulkPrices(periods, app.inputs, app.state);
  const warnings = [
    ...validateInputs(app.inputs).map((i) => ({ kind: 'invalid', message: i.message })),
    ...quoteWarnings(app.inputs, app.state, periods),
  ];
  const others = compareStates(periods, app.inputs);
  const scrollY = window.scrollY;
  resultsEl.replaceChildren(...[
    h('div', { class: 'filter-row', style: 'margin-bottom:0' },
      segmented('State', STATE_ORDER.map((s) => [s, h('span', {}, s, h('span', { style: 'opacity:.6;font-weight:400;margin-left:6px;font-size:12px' }, money(others.find((o) => o.state === s).result.bulkPrice, 4)))]), app.state, setState),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => exportExcel(r, periods, warnings) }, icon('download'), 'Export to Excel')),
    warningsCard(warnings),
    heroCard(r, periods),
    breakdownCard(r, periods),
    detailsCard(r),
    periodsCard(r, periods),
  ].filter(Boolean));
  window.scrollTo(0, scrollY);
}

function quotePage() {
  resultsEl = h('div', { class: 'stack' });
  inputsRedraw = null;
  const page = [
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Bulk electricity quote'),
        h('p', {}, 'Estimate a three-year bulk price for a large contract from the latest ASX futures and network tariffs. The state buttons show each state\'s price on its own default tariff.'))),
    h('div', { class: 'quote-layout' }, inputsPanel(), resultsEl),
  ];
  queueMicrotask(renderResults);
  return page;
}

// ── Bulk price index page ─────────────────────────────────────────────────────

// Current method (core.js bulkPriceIndex): the reference customer's price for a
// three-year contract starting the next quarter, on the tariff each state's default
// network suggests for it. Original method: the Streamlit Bulk Price Tracker.
let originalRows = null;
const currentByRate = new Map();
function indexData() {
  originalRows ??= legacyBulkPriceIndex(app.records).map((d) => ({ ...d, estimated: false }));
  const rate = app.bulkCarryRate;
  if (!currentByRate.has(rate)) {
    const current = bulkPriceIndex(app.curves, rate);
    currentByRate.set(rate, {
      current,
      currentRows: current.map((d) => ({ quoteDate: d.quoteDate, ...d.prices, estimated: d.estimates.length > 0 })),
    });
  }
  return { ...currentByRate.get(rate), originalRows };
}

function bulkPage() {
  let data = indexData();
  const tiles = h('div', { class: 'tiles' });
  const chart = h('div', { class: 'chart', role: 'img', 'aria-label': 'Line chart of the bulk price index by state over time' });
  const chartNote = h('div', {});
  const compChart = h('div', { class: 'chart', role: 'img' });
  const compHead = h('div', { class: 'card-head' });
  const compCard = h('section', { class: 'card' }, compHead, h('div', { class: 'card-body' },
    legend(COMPONENTS.map((c, i) => ({ label: c, color: seriesColor(i) }))), compChart));
  const tableBox = h('div', { class: 'scroll-table' });
  const head = h('div', { class: 'card-head' });
  const carryBox = h('div', { style: 'display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 16px;margin-top:12px' });

  const draw = () => {
    const current = app.bulkMethod === 'current';
    const index = current ? data.currentRows : data.originalRows;
    const last = index[index.length - 1];
    const monthAgo = parseDate(last.quoteDate);
    monthAgo.setDate(monthAgo.getDate() - 30);
    tiles.replaceChildren(...STATE_ORDER.map((s, i) => {
      const before = valueOnOrBefore(index, isoDate(monthAgo), s);
      return h('div', { class: 'card tile' },
        h('div', { class: 'label' }, h('span', { class: 'key', style: `background:${seriesColor(i)}` }), s),
        h('div', { class: 'value' }, money(last[s], 4), h('span', { class: 'unit' }, '/kWh')),
        h('div', { class: 'delta' }, before === undefined ? '—' : `${signed(last[s] - before, 4)} vs 30 days ago`));
    }));

    head.replaceChildren(h('h2', {}, current ? 'Index by state' : 'Index by state · original method'),
      h('span', { class: 'sub' }, '$/kWh'));

    const cutoff = cutoffFor(app.bulkRange);
    const rows = cutoff ? index.filter((d) => d.quoteDate >= cutoff) : index;
    const estimated = rows.filter((d) => d.estimated).length;
    plot(chart, STATE_ORDER.map((s, i) => ({
      type: 'scatter', mode: 'lines', name: s,
      x: rows.map((d) => d.quoteDate), y: rows.map((d) => d[s]),
      customdata: rows.map((d) => (d.estimated ? '  ⚠ includes estimated months' : '')),
      line: { color: seriesColor(i), width: 2, shape: 'linear' },
      hovertemplate: `${s}: $%{y:.4f}/kWh%{customdata}<extra></extra>`,
    })), {
      height: 420,
      margin: { l: 10, r: 16, t: 10, b: 30 },
      hovermode: 'x unified',
      xaxis: { showgrid: false, showspikes: true, spikemode: 'across', spikethickness: 1, spikecolor: cssVar('--axis'), spikedash: 'solid' },
      yaxis: { tickprefix: '$', tickformat: '.2f' },
    });
    chartNote.replaceChildren(...(current ? [
      h('p', { class: 'footnote' }, `Reference customer: 400,000 kWh a year, 50% peak, load factor 0.55, low voltage, on the tariff each state's default network suggests for it; network charges at the rates in force on each date: Essential BLND3AO and Energex 7200 from each financial year's price list, FY22 onwards; VIC and SA are placeholders at ${TARIFF_YEAR} rates. Each date prices a three-year contract starting the next quarter.`),
      estimated ? h('p', { class: 'footnote warn' }, `⚠ ${num(estimated, 0)} of ${num(rows.length, 0)} dates include estimated months: ASX didn't list a contract for part of the three years, so those months were carried forward (at ${num(app.bulkCarryRate, 2)}% a year, set below) or back-filled.`) : null,
    ] : [h('p', { class: 'footnote' }, 'The Streamlit app\'s method: 400,000 kWh, 50% peak, fixed network and system charges, and the average of whichever FY strips ASX listed that day.')]).filter(Boolean));

    compCard.hidden = !current;
    carryBox.hidden = !current;
    if (current) {
      const s = app.bulkState;
      const comp = cutoff ? data.current.filter((d) => d.quoteDate >= cutoff) : data.current;
      compHead.replaceChildren(h('h2', {}, `What makes up the ${s} index`),
        h('span', { class: 'sub' }, `$/kWh · network: ${tariffLabel(indexInputs(s).tariffId)}`));
      compChart.setAttribute('aria-label', `Stacked area chart of the parts of the ${s} bulk price index over time`);
      plot(compChart, COMPONENTS.map((name, i) => ({
        type: 'scatter', mode: 'lines', name, stackgroup: 'one',
        x: comp.map((d) => d.quoteDate), y: comp.map((d) => d.components[s][i]),
        line: { color: cssVar('--chart-surface'), width: 1 },
        fillcolor: seriesColor(i),
        hovertemplate: `${name}: $%{y:.4f}/kWh<extra></extra>`,
      })), {
        height: 320,
        margin: { l: 10, r: 16, t: 10, b: 30 },
        hovermode: 'x unified',
        xaxis: { showgrid: false },
        yaxis: { tickprefix: '$', tickformat: '.2f' },
      });
    }

    const cols = ['NSW', 'QLD', 'SA', 'VIC'];
    tableBox.replaceChildren(dataTable(['Quote date', ...cols, ...(current ? ['Estimate'] : [])],
      [...rows].reverse().map((d) => [shortDate(d.quoteDate), ...cols.map((c) => money(d[c], 4)), ...(current ? [d.estimated ? 'Yes' : ''] : [])])));
  };

  // Carry-forward escalation for months beyond the last listed contract (current method).
  const carryInput = h('input', {
    type: 'text', inputmode: 'decimal', id: 'index-carry', autocomplete: 'off',
    value: app.bulkCarryRate.toLocaleString('en-AU', { maximumFractionDigits: 2 }),
  });
  carryInput.addEventListener('change', () => {
    const v = parseFloat(carryInput.value.replace(/[,\s]/g, ''));
    if (Number.isFinite(v) && v > -100) {
      app.bulkCarryRate = v;
      data = indexData();
      draw();
    }
    carryInput.value = app.bulkCarryRate.toLocaleString('en-AU', { maximumFractionDigits: 2 });
  });
  carryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') carryInput.blur(); });
  const carryField = h('div', { class: 'field', style: 'min-width:220px' },
    h('label', { for: 'index-carry' }, 'Carry-forward escalation'),
    h('div', { class: 'num' }, carryInput, h('span', { class: 'unit' }, '% a year')));

  const controls = h('div', { style: 'display:contents' });
  const drawControls = () => controls.replaceChildren(
    segmented('Index method', [['current', 'Current method'], ['original', 'Original']], app.bulkMethod,
      (k) => { app.bulkMethod = k; drawControls(); draw(); }),
    app.bulkMethod === 'current'
      ? segmented('State', STATE_ORDER.map((s) => [s]), app.bulkState, (s) => { app.bulkState = s; drawControls(); draw(); })
      : null,
    segmented('Date range', RANGES.map(([k]) => [k]), app.bulkRange, (k) => { app.bulkRange = k; drawControls(); draw(); }),
  );
  drawControls();
  carryBox.append(carryField, h('p', { class: 'footnote', style: 'margin:0 0 8px;max-width:520px' },
    'Applied to months beyond the last ASX contract listed on each date. Changing it only affects dates flagged as estimates.'));
  queueMicrotask(draw);

  const downloadIndex = () => {
    // Original method: identical to the Streamlit download (state columns alphabetical).
    const cols = ['NSW', 'QLD', 'SA', 'VIC'];
    if (app.bulkMethod === 'original') {
      csvDownload('historical_bulk_price_index.csv', ['Quote Date', ...cols],
        [...data.originalRows].reverse().map((d) => [d.quoteDate, ...cols.map((c) => pyStr(d[c]))]));
      return;
    }
    const parts = ['energy', 'network', 'other', 'fixed'];
    csvDownload('bulk_price_index.csv',
      ['Quote Date', ...cols, ...cols.flatMap((c) => parts.map((p) => `${c} ${p}`)), 'Estimated periods'],
      [...data.current].reverse().map((d) => [d.quoteDate, ...cols.map((c) => pyStr(d.prices[c])),
        ...cols.flatMap((c) => d.components[c].map(pyStr)), d.estimates.map(estimateLabel).join(' + ')]));
  };

  return [
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Bulk price index'),
        h('p', {}, 'Indicative bulk price for a reference 400,000 kWh contract, recalculated for every ASX settlement date.'))),
    h('div', { class: 'filter-row' },
      controls,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', type: 'button', onclick: downloadIndex }, icon('download'), 'Download CSV')),
    tiles,
    h('section', { class: 'card' },
      head,
      h('div', { class: 'card-body' }, legend(STATE_ORDER.map((s, i) => ({ label: s, color: seriesColor(i), line: true }))), chart, chartNote, carryBox),
      h('details', { class: 'disclosure' }, h('summary', {}, 'Show data table'), tableBox)),
    compCard,
  ];
}

// ── Futures page ──────────────────────────────────────────────────────────────

// Contract types, in the order they're shown everywhere: FY, CY, then quarters.
const KIND_TABS = KIND_ORDER.map((k) => [k, k === 'Q' ? 'Quarters' : k]);
const STRIPS_FROM = '13 Nov 2026';
const firstOfMonth = (i) => `${monthKey(i)}-01`;

// A day's contracts as one table, in sections (financial years, calendar years,
// quarters). The section rows get the 'group' class.
function groupedContractsTable(curve, highlightState) {
  const rows = [];
  const groupRows = new Set();
  for (const g of groupByKind(curve)) {
    groupRows.add(rows.length);
    rows.push([g.label, '', ...STATE_ORDER.map(() => '')]);
    for (const c of g.contracts) {
      rows.push([shortContract(c.contract), periodRange(c.start, c.months), ...STATE_ORDER.map((k) => num(c[k], 2))]);
    }
  }
  const table = dataTable(['Contract', 'Months', ...STATE_ORDER], rows, { avgCol: STATE_ORDER.indexOf(highlightState) + 2 });
  table.querySelectorAll('tbody tr').forEach((tr, i) => { if (groupRows.has(i)) tr.classList.add('group'); });
  return table;
}

// Forward curve: what the market prices each delivery period at, for one state.
// Quarters are steps; CY and FY strips are level lines across their 12 months.
function forwardCurve(el, curve, state) {
  const styles = {
    Q: { color: seriesColor(0), width: 3, dash: 'solid' },
    CY: { color: seriesColor(1), width: 2, dash: 'dash' },
    FY: { color: seriesColor(2), width: 2, dash: 'solid' },
  };
  const traces = groupByKind(curve).map((g) => {
    const x = [];
    const y = [];
    const names = [];
    for (const c of g.contracts) {
      x.push(firstOfMonth(c.start), firstOfMonth(c.start + c.months), null);
      y.push(c[state], c[state], null);
      names.push(shortContract(c.contract), shortContract(c.contract), null);
    }
    return {
      type: 'scatter', mode: 'lines', name: g.label, x, y, customdata: names,
      line: { ...styles[g.kind], shape: 'linear' },
      hovertemplate: `%{customdata}: $%{y:.2f}/MWh<extra>${g.label}</extra>`,
      connectgaps: false,
    };
  });
  plot(el, traces, {
    height: 340,
    margin: { l: 10, r: 16, t: 10, b: 30 },
    hovermode: 'closest',
    xaxis: { type: 'date', showgrid: false, tickformat: '%b %Y' },
    yaxis: { tickprefix: '$', tickformat: ',.0f' },
  });
  return groupByKind(curve).map((g) => ({ label: g.label, color: styles[g.kind].color, line: true }));
}

function allContractsCsv() {
  const rows = [];
  for (const [date, curve] of [...app.curves].reverse()) {
    for (const g of groupByKind(curve)) {
      for (const c of g.contracts) {
        rows.push([date, c.contract, g.kind, monthKey(c.start), c.months, ...STATES.map((k) => pyStr(c[k]))]);
      }
    }
  }
  csvDownload('all-futures-contracts.csv', ['Quote Date', 'Contract', 'Type', 'Start', 'Months', ...STATES], rows);
}

function futuresPage() {
  const tiles = h('div', { class: 'tiles' });
  const chart = h('div', { class: 'chart', role: 'img' });
  const legendBox = h('div', {});
  const historyNote = h('div', {});
  const historyHead = h('div', { class: 'card-head' });
  const tableBox = h('div', { class: 'scroll-table' });
  const curveChart = h('div', { class: 'chart', role: 'img' });
  const curveLegend = h('div', {});
  const contractsBox = h('div', {});

  const draw = () => {
    const s = app.futuresState;
    const kind = app.futuresKind;
    const cutoff = cutoffFor(app.futuresRange);
    const inRange = (r) => !cutoff || r.quoteDate >= cutoff;
    const monthAgo = parseDate(app.latestDate);
    monthAgo.setDate(monthAgo.getDate() - 30);

    const history = contractHistory(app.curves, kind);
    const active = history.filter((c) => c.active);
    const colour = (c) => (c.active ? seriesColor(active.indexOf(c)) : cssVar('--series-expired'));

    tiles.replaceChildren(...active.map((c) => {
      const latest = c.points[c.points.length - 1][s];
      const before = valueOnOrBefore(c.points, isoDate(monthAgo), s);
      return h('div', { class: 'card tile' },
        h('div', { class: 'label' }, h('span', { class: 'key', style: `background:${colour(c)}` }), `${shortContract(c.contract)} · ${s}`),
        h('div', { class: 'value' }, money(latest, 2), h('span', { class: 'unit' }, '/MWh')),
        h('div', { class: 'delta' }, before === undefined ? `New since ${shortDate(c.points[0].quoteDate)}` : `${signed(latest - before, 2)} vs 30 days ago`));
    }));

    historyHead.replaceChildren(h('h2', {}, `${KIND_LABELS[kind]} · settlement prices`), h('span', { class: 'sub' }, `${s} · $/MWh`));
    chart.setAttribute('aria-label', `Line chart of ${s} ${KIND_LABELS[kind].toLowerCase()} settlement prices over time`);
    const traces = [...history.filter((c) => !c.active), ...active].map((c) => {
      const points = c.points.filter(inRange);
      return {
        type: 'scatter', mode: points.length > 1 ? 'lines' : 'lines+markers', name: shortContract(c.contract),
        x: points.map((p) => p.quoteDate), y: points.map((p) => p[s]),
        line: { color: colour(c), width: c.active ? 2 : 1.5, shape: 'linear' },
        marker: { size: 8, color: colour(c), line: { color: cssVar('--chart-surface'), width: 2 } },
        hovertemplate: `${shortContract(c.contract)}: $%{y:.2f}/MWh<extra></extra>`,
      };
    }).filter((t) => t.x.length);
    // With only a few days of history (CY and quarters, collected from 13 Nov 2026),
    // show at least a month so the time axis reads in days, not hours.
    const dates = traces.flatMap((t) => t.x).sort();
    const shortHistory = dates.length && (parseDate(dates[dates.length - 1]) - parseDate(dates[0])) < 30 * 86_400_000;
    const pad = (iso, days) => { const d = parseDate(iso); d.setDate(d.getDate() + days); return isoDate(d); };
    plot(chart, traces, {
      height: 420,
      margin: { l: 10, r: 16, t: 10, b: 30 },
      hovermode: 'x unified',
      xaxis: {
        type: 'date', showgrid: false, showspikes: true, spikemode: 'across', spikethickness: 1, spikecolor: cssVar('--axis'), spikedash: 'solid',
        ...(shortHistory ? { range: [pad(dates[0], -7), pad(dates[dates.length - 1], 21)], tickformat: '%d %b %Y' } : {}),
      },
      yaxis: { tickprefix: '$', tickformat: ',.0f' },
    });
    legendBox.replaceChildren(legend([
      ...active.map((c) => ({ label: `${shortContract(c.contract)} (quoted)`, color: colour(c), line: true })),
      ...(history.length > active.length ? [{ label: 'No longer quoted', color: cssVar('--series-expired'), line: true }] : []),
    ]));
    const days = new Set(history.flatMap((c) => c.points.map((p) => p.quoteDate))).size;
    historyNote.replaceChildren(kind === 'FY'
      ? h('p', { class: 'footnote' }, 'Grey strips are no longer quoted: ASX stops listing a financial year once it\'s in delivery (or, since its 2026 site change, once its first quarter has passed).')
      : h('p', { class: 'footnote warn' }, `${KIND_LABELS[kind]} are collected from ${STRIPS_FROM}, so there ${days === 1 ? 'is 1 day' : `are ${days} days`} of history so far. Financial years go back to 2021.`));

    const rows = history.flatMap((c) => c.points.filter(inRange).map((p) => ({ ...p, contract: c.contract })))
      .sort((a, b) => (a.quoteDate === b.quoteDate ? b.start - a.start : a.quoteDate < b.quoteDate ? 1 : -1));
    tableBox.replaceChildren(dataTable(['Quote date', 'Contract', ...STATE_ORDER],
      rows.map((r) => [shortDate(r.quoteDate), shortContract(r.contract), ...STATE_ORDER.map((k) => num(r[k], 2))]),
      { avgCol: STATE_ORDER.indexOf(s) + 2 }));

    curveChart.setAttribute('aria-label', `Forward curve of ${s} base contracts quoted on ${shortDate(app.latestDate)}`);
    curveLegend.replaceChildren(legend(forwardCurve(curveChart, app.curve, s)));
    contractsBox.replaceChildren(groupedContractsTable(app.curve, s));
  };

  const controls = h('div', { style: 'display:contents' });
  const drawControls = () => controls.replaceChildren(
    segmented('Contract type', KIND_TABS, app.futuresKind, (k) => { app.futuresKind = k; drawControls(); draw(); }),
    segmented('State', STATE_ORDER.map((s) => [s]), app.futuresState, (s) => { app.futuresState = s; drawControls(); draw(); }),
    segmented('Date range', RANGES.map(([k]) => [k]), app.futuresRange, (k) => { app.futuresRange = k; drawControls(); draw(); }),
  );
  drawControls();
  queueMicrotask(draw);

  return [
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'ASX futures'),
        h('p', {}, 'Base futures settlement prices by contract type: financial years, calendar years and quarters.'))),
    h('div', { class: 'filter-row' },
      controls,
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn', type: 'button', title: 'Financial-year strips back to 2021, as in the Streamlit app',
        onclick: () => csvDownload('historical-futures-data.csv', ['Quote Date', 'Year', ...STATES],
          app.records.map((r) => [r.quoteDate, r.year, ...STATES.map((k) => pyStr(r[k]))])),
      }, icon('download'), 'FY history CSV'),
      h('button', { class: 'btn', type: 'button', title: 'Every contract on every date, with its type', onclick: allContractsCsv },
        icon('download'), 'All contracts CSV')),
    tiles,
    h('section', { class: 'card' },
      historyHead,
      h('div', { class: 'card-body' }, legendBox, chart, historyNote),
      h('details', { class: 'disclosure' }, h('summary', {}, 'Show data table'), tableBox)),
    card('Forward curve', `Quoted on ${shortDate(app.latestDate)} · $/MWh`,
      h('div', { class: 'card-body' },
        h('p', { class: 'footnote', style: 'margin:0 0 12px' },
          'What the market prices each delivery period at. Quarters are steps; calendar- and financial-year strips span their 12 months. A quote prices each year from a matching strip, or from its quarters.'),
        curveLegend, curveChart)),
    card(`All contracts quoted on ${shortDate(app.latestDate)}`, '$/MWh',
      h('div', { class: 'card-body' }, contractsBox)),
  ];
}

// ── Network tariffs page ─────────────────────────────────────────────────────

// The tariff catalogue, read-only: every network's tariffs with their rates, time
// windows, notes, past years' rates and sources.
const rate4 = (v) => num(v, 4);
const PERIOD_KEYS = [['Peak', 'peak'], ['Shoulder', 'shoulder'], ['Off-peak', 'offPeak']];
const codeOf = (t) => (t.status === 'placeholder' ? 'Placeholder' : t.code);

function statusTag(t) {
  return h('span', { class: `tag${t.status === 'placeholder' ? ' warn' : ''}` }, t.status === 'placeholder' ? 'Placeholder' : 'Researched');
}

function tariffSection(title, ...body) {
  return h('section', { class: 'tariff-section' }, h('h3', {}, title), ...body);
}

function tariffDetails(t) {
  const flat = t.energy.peak === t.energy.shoulder && t.energy.shoulder === t.energy.offPeak;
  const windows = t.energyWindows;
  const energyRows = flat ? [['All times', '', rate4(t.energy.peak)]]
    : PERIOD_KEYS.filter(([, k]) => !windows || windows[k] !== null)
      .map(([label, k]) => [label, h('span', { class: 'wrap' }, windows?.[k] ?? ''), rate4(t.energy[k])]);
  const years = rateHistory(t);
  const indexState = STATES.find((s) => indexInputs(s).tariffId === t.id);
  return h('div', { class: 'tariff-details' },
    t.status === 'placeholder' ? h('p', { class: 'callout wide' },
      `Placeholder: these are stand-in rates until this network's ${TARIFF_YEAR} tariff is researched. Quotes on it are indicative only.`) : null,
    tariffSection('Energy (c/kWh)', dataTable(['Period', 'Network window', 'Rate'], energyRows)),
    tariffSection('Demand ($/kVA/month)',
      t.demand.lines.length
        ? dataTable(['Charge', 'Window · how the kVA is set', 'Rate'], t.demand.lines.map((l) => [l.label,
          h('span', { class: 'wrap' }, l.window, h('br'), h('span', { class: 'subtle' }, DEMAND_BASIS[l.basis])), rate4(l.rate)]))
        : h('p', { class: 'muted' }, 'No demand charge.'),
      h('p', {}, 'Fixed charge: ', h('strong', {}, `$${rate4(t.fixed)}`), ' a day')),
    t.periods || t.notes.length ? tariffSection('Time windows and notes',
      t.periods ? h('p', { class: 'muted' }, t.periods) : null,
      ...t.notes.map((n) => h('p', { class: 'muted' }, n)),
      indexState ? h('p', { class: 'muted' }, `The bulk price index prices ${indexState}'s reference customer on this tariff.`) : null) : null,
    tariffSection('Source', h('p', { class: 'muted' }, t.source),
      t.toConfirm?.length ? h('p', { class: 'warn-text' }, `To confirm: ${t.toConfirm.join(', ')}.`) : null),
    years.length > 1 ? h('div', { class: 'wide' }, tariffSection('Rates by financial year',
      dataTable(['Year', 'Peak c/kWh', 'Shoulder c/kWh', 'Off-peak c/kWh', 'Demand $/kVA/mo', 'Fixed $/day'],
        years.map((r) => [r.year, rate4(r.energy.peak), rate4(r.energy.shoulder), rate4(r.energy.offPeak), rate4(r.demand.rate), rate4(r.fixed)])),
      h('ul', { class: 'footnote sources' }, years.slice(1).map((r) => h('li', {}, `${r.year}: ${r.source}`))),
      h('p', { class: 'footnote', style: 'margin-top:4px' }, "Demand is the sum of the tariff's demand charges."))) : null);
}

function networkCard(n) {
  const tariffs = tariffsOf(n.id);
  const sub = [n.state, defaultNetwork(n.state).id === n.id ? `default network for ${n.state}` : null,
    tariffs.every((t) => t.status === 'placeholder') ? 'placeholder rates until researched' : null].filter(Boolean).join(' · ');
  return card(n.name, sub,
    h('div', { style: 'margin-top:12px;border-top:1px solid var(--border)' },
      dataTable(['Tariff', 'Voltage', 'Peak c/kWh', 'Shoulder', 'Off-peak', 'Demand $/kVA/mo', 'Fixed $/day'],
        tariffs.map((t) => [h('span', { class: 'strong' }, codeOf(t), h('span', { class: 'muted' }, ` · ${t.name}`)),
          t.voltage, rate4(t.energy.peak), rate4(t.energy.shoulder), rate4(t.energy.offPeak), rate4(t.demand.rate), rate4(t.fixed)]))),
    h('div', { class: 'tariff-list' }, tariffs.map((t) => {
      const body = h('div', {});
      const details = h('details', {},
        h('summary', {},
          h('span', { class: 'tariff-name' }, h('strong', {}, codeOf(t)), h('span', { class: 'muted' }, ` · ${t.name}`),
            h('span', { class: 'subtle block' }, `${t.voltage} · ${eligibilityText(t)}`)),
          statusTag(t)),
        body);
      // Draw the details the first time they're opened.
      details.addEventListener('toggle', () => { if (details.open && !body.firstChild) body.replaceChildren(tariffDetails(t)); });
      return details;
    })));
}

function tariffsPage() {
  const list = h('div', { class: 'stack' });
  const controls = h('div', {});
  const draw = () => {
    controls.replaceChildren(segmented('State', ['All', ...STATE_ORDER].map((s) => [s]), app.tariffsState,
      (s) => { app.tariffsState = s; draw(); }));
    list.replaceChildren(...STATE_ORDER.flatMap((s) => networksFor(s))
      .filter((n) => app.tariffsState === 'All' || n.state === app.tariffsState).map(networkCard));
  };
  draw();
  const researched = TARIFFS.filter((t) => t.status !== 'placeholder').length;
  return [
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Network tariffs'),
        h('p', {}, `${TARIFF_YEAR} network tariffs from the networks' published price lists, excluding GST. Choosing one on the Quote page fills in its network charges.`)),
      controls),
    h('p', { class: 'muted', style: 'margin:0 0 16px' },
      `${researched} researched · ${TARIFFS.length - researched} placeholders (stand-in rates, flagged wherever they're used). Open a tariff for its time windows, demand charges, notes and sources.`),
    list,
  ];
}

// ── Routing ───────────────────────────────────────────────────────────────────

const PAGES = {
  quote: { render: quotePage, title: 'HUMQuote · Quote' },
  bulk: { render: bulkPage, title: 'HUMQuote · Bulk price index' },
  futures: { render: futuresPage, title: 'HUMQuote · ASX futures' },
  tariffs: { render: tariffsPage, title: 'HUMQuote · Network tariffs' },
};

function currentPage() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash === 'bulk-price-index') return 'bulk';
  if (hash === 'futures') return 'futures';
  if (hash === 'tariffs') return 'tariffs';
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
  if (!app.curve.length) {
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
    app.strips = json.strips?.rows ?? [];
    app.latestFy = latestFutures(app.records);
    app.curves = buildCurves(app.records, app.strips);
    app.latestDate = [...app.curves.keys()].at(-1) ?? null;
    app.curve = app.latestDate ? app.curves.get(app.latestDate) : [];
    if (!app.curve.length) app.error = 'No futures data found.';
  } catch (e) {
    app.error = `Could not load futures data: ${e.message}`;
  }
  updateDataStatus();
  render();
}

init();

// Exposed for testing in the browser console.
window.humquote = { app, calculateBulkPrices, quotePeriods, bulkPriceIndex, contractHistory };
