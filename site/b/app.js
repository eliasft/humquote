// HUMQuote, Option B: plain JavaScript build of the Streamlit app.
// Pages: #/ (pricing), #/bulk-price-tracker, #/futures-price-tracker.

import {
  STATES, NETWORK_OPTIONS, DEFAULT_INPUTS,
  toRecords, latestFutures, calculateBulkPrices, bulkPriceIndex, pyRound,
} from './calc.js';

const DATA_URL = '../data/futures.json';
const STALE_AFTER_DAYS = 4;
const MOBILE = window.matchMedia('(max-width: 900px)');
const DARK = window.matchMedia('(prefers-color-scheme: dark)');

const app = {
  records: [],
  fetched: [],
  inputs: { ...DEFAULT_INPUTS },
  selectedState: 'NSW',
  futuresState: 'NSW',
  openSidebar: new Set(),
  openMain: new Set(['Energy Consumption']),
  error: null,
};

// ── DOM helpers ───────────────────────────────────────────────────────────────

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const fmt = (value, decimals, grouping = false) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouping })
    : '—';

// Python's str(float), so CSV exports match the Streamlit app's pandas output.
const pyStr = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

function parseLocalDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function longDate(iso) {
  const d = parseLocalDate(iso);
  const weekday = d.toLocaleDateString('en-AU', { weekday: 'long' });
  const month = d.toLocaleDateString('en-AU', { month: 'short' });
  return `${weekday} ${String(d.getDate()).padStart(2, '0')} ${month} ${d.getFullYear()}`;
}

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function expander(title, key, openSet, body, { bold = false, onOpen } = {}) {
  const el = h('details', { class: 'expander', open: openSet.has(key) },
    h('summary', {}, bold ? h('strong', {}, title) : title),
    h('div', { class: 'expander-body' }, body),
  );
  el.addEventListener('toggle', () => {
    if (el.open) { openSet.add(key); onOpen?.(el.querySelector('.expander-body')); }
    else openSet.delete(key);
  });
  if (el.open) queueMicrotask(() => onOpen?.(el.querySelector('.expander-body')));
  return el;
}

// st.number_input: shows the value with `decimals` places but keeps full precision
// until edited, and the −/+ buttons step it, like Streamlit.
function numberInput(label, key, { step = 0.01, min = -Infinity, max = Infinity, decimals = 2, onChange }) {
  const input = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': label });
  const show = () => { input.value = fmt(app.inputs[key], decimals); };
  const set = (v) => {
    if (!Number.isFinite(v)) return show();
    app.inputs[key] = Math.min(max, Math.max(min, v));
    show();
    onChange();
  };
  input.addEventListener('change', () => set(parseFloat(input.value.replace(/,/g, ''))));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  show();
  return h('div', { class: 'field' },
    h('label', {}, label),
    h('div', { class: 'number-input' },
      input,
      h('button', { type: 'button', 'aria-label': `Decrease ${label}`, onclick: () => set(pyRound(app.inputs[key] - step, 10)) }, '−'),
      h('button', { type: 'button', 'aria-label': `Increase ${label}`, onclick: () => set(pyRound(app.inputs[key] + step, 10)) }, '+'),
    ),
  );
}

function selectBox(label, options, value, onChange) {
  const sel = h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o, selected: o === value }, o)));
  return h('div', { class: 'field' }, h('label', {}, label), sel);
}

// st.table: index column, then numeric columns shown to `decimals` places.
function stTable(columns, rows, { index = 0, decimals = 4 } = {}) {
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'st-table' },
      h('thead', {}, h('tr', {}, columns.map((c, i) => h('th', { class: i < index ? 'index' : null }, c)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((v, i) => {
        const isNum = typeof v === 'number';
        const cls = [i < index ? 'index' : '', isNum ? 'num' : ''].join(' ').trim() || null;
        return h('td', { class: cls }, isNum ? (decimals === null ? String(v) : fmt(v, decimals)) : v);
      })))),
    ),
  );
}

// The blue/yellow summary tables (go.Table in HUM.py).
function humTable(t, decimals) {
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'hum-table' },
      h('thead', {}, h('tr', {}, [t.labelHeader, 'Year 1', 'Year 2', 'Year 3', 'Average'].map((c) => h('th', {}, c)))),
      h('tbody', {}, t.rows.map((r) => h('tr', {},
        h('td', { title: r.label }, r.label),
        [...r.values, r.average].map((v) => h('td', {}, fmt(v, decimals, true))),
      ))),
    ),
  );
}

function dataBanner() {
  if (!app.fetched.length) return null;
  const quoteDate = app.fetched[0].quoteDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ageDays = Math.round((today - parseLocalDate(quoteDate)) / 86_400_000);
  if (ageDays > STALE_AFTER_DAYS) {
    return h('div', { class: 'alert warning' }, '⚠️ ', h('strong', {}, 'Prices may be out of date.'),
      ' Showing ASX settlement prices from ', h('strong', {}, longDate(quoteDate)),
      '. The daily data update may have failed.');
  }
  return h('div', { class: 'alert info' }, '🗓️ Showing ASX settlement prices as of ',
    h('strong', {}, longDate(quoteDate)), '. Prices update automatically each weekday after market close.');
}

// ── Charts ────────────────────────────────────────────────────────────────────

function chartTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : DARK.matches;
  const text = dark ? '#fafafa' : '#31333f';
  const grid = dark ? 'rgba(250,250,250,0.12)' : 'rgba(49,51,63,0.12)';
  return {
    colorway: dark
      ? ['#83c9ff', '#0068c9', '#ffabab', '#ff2b2b', '#7defa1', '#29b09d', '#ffd16a', '#ff8700', '#6d3fc0', '#d5dae5']
      : ['#0068c9', '#83c9ff', '#ff2b2b', '#ffabab', '#29b09d', '#7defa1', '#ff8700', '#ffd16a', '#6d3fc0', '#d5dae5'],
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: '"Source Sans 3", "Source Sans Pro", sans-serif', color: text, size: 13 },
    xaxis: { gridcolor: grid, zeroline: false, linecolor: grid },
    yaxis: { gridcolor: grid, zeroline: false, linecolor: grid },
    hoverlabel: { font: { family: '"Source Sans 3", sans-serif' } },
  };
}

function lineChart(el, traces, { title, xTitle, yTitle, legendTitle, height }) {
  const theme = chartTheme();
  const layout = {
    ...theme,
    height,
    title: { text: title, font: { size: 16 }, x: 0, xanchor: 'left' },
    margin: { l: 60, r: 20, t: 60, b: 50 },
    xaxis: { ...theme.xaxis, title: { text: xTitle } },
    yaxis: { ...theme.yaxis, title: { text: yTitle } },
    legend: { title: { text: legendTitle } },
    hovermode: 'closest',
  };
  window.Plotly.react(el, traces, layout, { responsive: true, displaylogo: false });
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderSidebar(page) {
  const box = document.getElementById('sidebar-content');
  box.replaceChildren();
  document.querySelectorAll('.page-nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  if (page !== 'home') return;

  const recalc = () => renderPage('home', { keepSidebar: true });
  const num = (label, key, opts = {}) => numberInput(label, key, { ...opts, onChange: recalc });

  box.append(h('h2', {}, 'Latest ASX Futures Data'));
  if (app.fetched.length) {
    box.append(stTable(['Quote Date', ...['Year', ...STATES]],
      app.fetched.map((r) => [r.quoteDate, String(r.year), ...STATES.map((s) => r[s])]),
      { index: 1, decimals: null }));
  }

  const offPeakText = h('p', {});
  const updateOffPeak = () => {
    const off = 100 - app.inputs.peakConsumption - app.inputs.shoulderConsumption;
    offPeakText.textContent = `Off-Peak Consumption: ${pyStr(off)}%`;
  };
  updateOffPeak();
  const recalcConsumption = () => { updateOffPeak(); recalc(); };

  box.append(
    h('div', { style: 'height:16px' }),
    expander('Consumption Data', 'consumption', app.openSidebar, [
      numberInput('Total Consumption (kWh)', 'totalConsumption', { min: 0, step: 10000, onChange: recalc }),
      numberInput('Peak Consumption (%)', 'peakConsumption', { min: 0, max: 100, step: 1, onChange: recalcConsumption }),
      numberInput('Shoulder Consumption (%)', 'shoulderConsumption', { min: 0, max: 100, step: 1, onChange: recalcConsumption }),
      offPeakText,
      num('Load Factor', 'loadFactor'),
    ]),
    expander('Network Charges', 'network', app.openSidebar, networkFields(recalc)),
    expander('System Charges', 'system', app.openSidebar, [
      num('AEMO Participant Charge (c/kWh)', 'aemoParticipantCharge'),
      num('AEMO Ancillary Services Charge (c/kWh)', 'aemoAncillaryServicesCharge'),
      num('SREC Charge (c/kWh)', 'srecCharge'),
      num('LREC Charge (c/kWh)', 'lrecCharge'),
    ]),
    expander('Service Charges', 'service', app.openSidebar, [
      num('Metering Charge ($/month)', 'meteringCharge', { step: 1 }),
      num('Retail Service Charge ($/month)', 'retailServiceCharge', { step: 1 }),
      num('Admin Charge ($/month)', 'adminCharge', { step: 1 }),
    ]),
    expander('Escalation Factors', 'escalation', app.openSidebar, [
      num('Load Escalation Factor', 'loadEscalation'),
      num('Retail Escalation Factor', 'retailEscalation'),
    ]),
  );
}

// Choosing a network resets its five charges to that network's defaults, as in Streamlit.
function networkFields(recalc) {
  const wrap = h('div', {});
  const draw = () => {
    const num = (label, key, opts = {}) => numberInput(label, key, { ...opts, onChange: recalc });
    wrap.replaceChildren(
      selectBox('Select Network', Object.keys(NETWORK_OPTIONS), app.inputs.network, (name) => {
        const preset = NETWORK_OPTIONS[name];
        Object.assign(app.inputs, {
          network: name,
          peakCharge: preset.peak,
          offPeakCharge: preset.offPeak,
          shoulderCharge: preset.shoulder,
          nuosCharge: preset.nuos,
          serviceAvailabilityCharge: preset.service,
        });
        draw();
        recalc();
      }),
      num('Peak Charge (c/kWh)', 'peakCharge'),
      num('Off-Peak Charge (c/kWh)', 'offPeakCharge'),
      num('Shoulder Charge (c/kWh)', 'shoulderCharge'),
      num('NUOS Charge ($/kVA)', 'nuosCharge', { step: 1 }),
      num('Service Availability Charge ($/day)', 'serviceAvailabilityCharge'),
    );
  };
  draw();
  return wrap;
}

// ── Pages ─────────────────────────────────────────────────────────────────────

function homePage() {
  const page = [h('h1', {}, '⚡ Bulk Electricity Pricing for Large Contracts')];
  if (app.error) return [...page, h('div', { class: 'alert error' }, app.error)];
  page.push(dataBanner());
  if (!app.fetched.length) return page;

  const state = app.selectedState;
  const r = calculateBulkPrices(app.fetched, app.inputs, state);

  page.push(
    selectBox('Select State', ['NSW', 'QLD', 'VIC', 'SA'], state, (v) => { app.selectedState = v; renderPage('home', { keepSidebar: true }); }),
    h('div', { class: 'columns' },
      h('div', {},
        h('h3', { class: 'center' }, 'Bulk Electricity Price'),
        h('div', { class: 'big-price' }, h('span', {}, `$/kWh ${fmt(r.bulkPrice, 4)}`)),
      ),
      h('div', {},
        h('h3', { class: 'center' }, 'Bulk Electricity Price Breakdown'),
        stTable(['Rates Summary', 'Year 1', 'Year 2', 'Year 3', 'Average'],
          r.rates.rows.map((row) => [row.label, ...row.values, row.average]), { index: 1 }),
      ),
    ),
    h('h2', { class: 'section' }, `Summary for ${state}`),
    expander('Energy Consumption', 'Energy Consumption', app.openMain, humTable(r.consumption, 2), { bold: true }),
    expander('Bulk Electricity Prices', 'Bulk Electricity Prices', app.openMain, humTable(r.rates, 4), { bold: true }),
    expander('Yearly Costs', 'Yearly Costs', app.openMain, humTable(r.costs, 2), { bold: true }),
    expander('Tariffs & Factors', 'Tariffs & Factors', app.openMain, humTable(r.energyRates, 4), { bold: true }),
    expander('Charges', 'Charges', app.openMain, humTable(r.charges, 4), { bold: true }),
  );

  const priceCols = ['Quote Date', 'Year', ...STATES];
  const peakRows = r.updated.map((u) => [u.quoteDate, String(u.year), ...STATES.map((s) => u[s])]);
  const baseRows = app.fetched.map((f) => [f.quoteDate, String(f.year), ...STATES.map((s) => pyRound(f[s] / 10, 2))]);

  page.push(
    h('div', { class: 'columns' },
      h('div', {}, h('h3', {}, 'Peak Electricity Prices (c/kWh)'), stTable(priceCols, peakRows, { index: 1 })),
      h('div', {}, h('h3', {}, 'Base Electricity Prices (c/kWh)'), stTable(priceCols, baseRows, { index: 1 })),
    ),
    h('h2', { class: 'section' }, 'Export to Excel'),
    h('button', { class: 'btn', type: 'button', onclick: () => exportExcel(r, state, priceCols, peakRows, baseRows) }, '📥 Download Excel'),
  );
  return page;
}

function exportExcel(r, state, priceCols, peakRows, baseRows) {
  const X = window.XLSX;
  const summary = (t) => X.utils.aoa_to_sheet([
    [t.labelHeader, 'Year 1', 'Year 2', 'Year 3', 'Average'],
    ...t.rows.map((row) => [row.label, ...row.values, row.average]),
  ]);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, summary(r.rates), 'Bulk Prices');
  X.utils.book_append_sheet(wb, summary(r.consumption), 'Consumption');
  X.utils.book_append_sheet(wb, summary(r.costs), 'Yearly Costs');
  X.utils.book_append_sheet(wb, summary(r.energyRates), 'Energy Rates');
  X.utils.book_append_sheet(wb, summary(r.charges), 'Charges');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([priceCols, ...peakRows]), 'Peak Prices');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([priceCols, ...baseRows]), 'Off-Peak Prices');
  X.writeFile(wb, `bulk-electricity-pricing-${state}-${app.fetched[0].quoteDate}.xlsx`);
}

function csvButton(label, filename, header, rows) {
  return h('button', {
    class: 'btn',
    type: 'button',
    onclick: () => {
      const csv = [header, ...rows].map((r) => r.join(',')).join('\n') + '\n';
      download(filename, new Blob([csv], { type: 'text/csv' }));
    },
  }, label);
}

function bulkPage() {
  const page = [h('h1', {}, '💲 Bulk Price Tracker')];
  if (app.error) return [...page, h('div', { class: 'alert error' }, app.error)];

  const index = bulkPriceIndex(app.records);
  const chart = h('div', { class: 'chart' });
  queueMicrotask(() => lineChart(chart,
    ['NSW', 'QLD', 'VIC', 'SA'].map((s) => ({
      type: 'scatter', mode: 'lines', name: s,
      x: index.map((d) => d.quoteDate), y: index.map((d) => d[s]),
    })),
    { title: 'Bulk Price Index Over Time', xTitle: 'Quote Date', yTitle: 'AUD$/kWh', legendTitle: 'State', height: 600 }));

  // pandas pivot orders the state columns alphabetically.
  const cols = ['NSW', 'QLD', 'SA', 'VIC'];
  const desc = [...index].reverse();

  page.push(
    chart,
    expander('Historical Bulk Price Index', 'bulk-index', new Set(), null, {
      bold: true,
      onOpen: (body) => {
        if (body.childElementCount) return;
        body.append(stTable(['Quote Date', ...cols], desc.map((d) => [d.quoteDate, ...cols.map((c) => d[c])]), { index: 1 }));
      },
    }),
    csvButton('Download as CSV', 'historical_bulk_price_index.csv', ['Quote Date', ...cols],
      desc.map((d) => [d.quoteDate, ...cols.map((c) => pyStr(d[c]))])),
  );
  return page;
}

function futuresPage() {
  const page = [h('h1', {}, '📈 Futures Price Tracker')];
  if (app.error) return [...page, h('div', { class: 'alert error' }, app.error)];

  const chart = h('div', { class: 'chart' });
  const draw = () => {
    const state = app.futuresState;
    // One line per Year, in order of first appearance (as plotly express does).
    const years = [...new Set(app.records.map((r) => r.year))];
    lineChart(chart, years.map((y) => {
      const rows = app.records.filter((r) => r.year === y);
      return { type: 'scatter', mode: 'lines', name: String(y), x: rows.map((r) => r.quoteDate), y: rows.map((r) => r[state]) };
    }), { title: `${state} Futures Prices Over Time`, xTitle: 'Quote Date', yTitle: '$AUD/MWh', legendTitle: 'Year', height: 500 });
  };
  queueMicrotask(draw);

  page.push(
    selectBox('Select State to plot:', STATES, app.futuresState, (v) => { app.futuresState = v; draw(); }),
    chart,
    expander('Historical Futures Data', 'futures-data', new Set(), null, {
      bold: true,
      onOpen: (body) => {
        if (body.childElementCount) return;
        body.append(stTable(['Quote Date', 'Year', ...STATES],
          app.records.map((r) => [r.quoteDate, String(r.year), ...STATES.map((s) => r[s])]), { index: 1, decimals: null }));
      },
    }),
    csvButton('Download as CSV', 'historical-futures-data.csv', ['Quote Date', 'Year', ...STATES],
      app.records.map((r) => [r.quoteDate, r.year, ...STATES.map((s) => pyStr(r[s]))])),
  );
  return page;
}

// ── Routing ───────────────────────────────────────────────────────────────────

const PAGES = {
  home: { render: homePage, title: 'HUMQuote - Bulk Electricity Pricing' },
  bulk: { render: bulkPage, title: 'HUMQuote - Bulk Price Tracker' },
  futures: { render: futuresPage, title: 'HUMQuote - Futures Price Tracker' },
};

function currentPage() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash === 'bulk-price-tracker') return 'bulk';
  if (hash === 'futures-price-tracker') return 'futures';
  return 'home';
}

function renderPage(page = currentPage(), { keepSidebar = false } = {}) {
  document.title = PAGES[page].title;
  if (!keepSidebar) renderSidebar(page);
  const scrollY = window.scrollY;
  document.getElementById('page').replaceChildren(...PAGES[page].render().filter(Boolean));
  if (keepSidebar) window.scrollTo(0, scrollY);
}

// Plotly only follows window resizes, so redraw charts when the sidebar changes size.
function resizeCharts() {
  document.querySelectorAll('.chart').forEach((el) => {
    if (el.data) window.Plotly.Plots.resize(el);
  });
}

function setSidebar(open) {
  document.body.classList.toggle('sidebar-collapsed', !open);
}

// ── Resizable sidebar ─────────────────────────────────────────────────────────

const SIDEBAR_DEFAULT = 360;
const SIDEBAR_MIN = 240;
const SIDEBAR_KEY = 'humquote.sidebarWidth';

// On desktop leave room for the page; on phones the sidebar overlays it (CSS caps it there).
function sidebarMax() {
  if (MOBILE.matches) return 700;
  return Math.max(SIDEBAR_MIN, Math.min(700, window.innerWidth - 400));
}

function setSidebarWidth(px, { save = false } = {}) {
  const w = Math.round(Math.min(sidebarMax(), Math.max(SIDEBAR_MIN, px)));
  document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
  if (save) {
    try { localStorage.setItem(SIDEBAR_KEY, String(w)); } catch { /* storage unavailable */ }
  }
  return w;
}

function initSidebarResizer() {
  try {
    const saved = Number(localStorage.getItem(SIDEBAR_KEY));
    if (saved) setSidebarWidth(saved);
  } catch { /* storage unavailable */ }

  // Width and open/close changes slide the main area; redraw charts once it settles.
  document.getElementById('main').addEventListener('transitionend', (e) => {
    if (e.target.id === 'main' && e.propertyName === 'margin-left') resizeCharts();
  });

  const handle = document.getElementById('sidebar-resizer');
  let width = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || SIDEBAR_DEFAULT;

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  handle.addEventListener('pointermove', (e) => {
    if (handle.hasPointerCapture(e.pointerId)) width = setSidebarWidth(e.clientX);
  });
  const finish = (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    handle.releasePointerCapture(e.pointerId);
    document.body.classList.remove('resizing');
    width = setSidebarWidth(width, { save: true });
    resizeCharts();
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);

  handle.addEventListener('dblclick', () => {
    width = setSidebarWidth(SIDEBAR_DEFAULT, { save: true });
  });
  handle.addEventListener('keydown', (e) => {
    const delta = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
    if (!delta) return;
    e.preventDefault();
    width = setSidebarWidth(width + delta, { save: true });
  });
}

async function init() {
  setSidebar(!MOBILE.matches);
  initSidebarResizer();
  document.getElementById('sidebar-open').addEventListener('click', () => setSidebar(true));
  document.getElementById('sidebar-close').addEventListener('click', () => setSidebar(false));
  document.querySelectorAll('.page-nav a').forEach((a) => a.addEventListener('click', () => {
    if (MOBILE.matches) setSidebar(false);
  }));
  window.addEventListener('hashchange', () => { renderPage(); window.scrollTo(0, 0); });
  DARK.addEventListener('change', () => { if (currentPage() !== 'home') renderPage(); });

  try {
    // Bust the browser cache roughly hourly so the daily data update shows up promptly.
    const res = await fetch(`${DATA_URL}?v=${Math.floor(Date.now() / 3_600_000)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    app.records = toRecords(json.rows);
    app.fetched = latestFutures(app.records);
    if (!app.fetched.length) app.error = 'No futures data found in the database.';
  } catch (e) {
    app.error = `Could not load futures data: ${e.message}`;
  }
  renderPage();
}

init();

// Exposed for testing in the browser console.
window.humquote = { app, calculateBulkPrices, bulkPriceIndex, pyRound };
