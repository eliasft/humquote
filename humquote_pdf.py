"""
One-page PDF quote sheet for the Streamlit app (version B's "Print or save as PDF"
sheet, in HUM's colours): headline price, any warnings, the price by component and
contract year, where each year's price came from, and the inputs.

Uses fpdf2 with its built-in Helvetica, which covers Latin-1 only, so text is
passed through _latin1() first.
"""

import os
from datetime import date, datetime

from fpdf import FPDF
from fpdf.fonts import FontFace

import humquote_core as core

HUM_BLUE = (0, 111, 231)
INK = (31, 41, 55)
MUTED = (107, 114, 128)
RULE = (219, 228, 240)
LOGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logo_hum.png')

INPUT_LABELS = [
    ('total_consumption', 'Annual consumption (kWh)'),
    ('peak_consumption', 'Peak share (%)'),
    ('shoulder_consumption', 'Shoulder share (%)'),
    ('load_factor', 'Load factor'),
    ('tariff_id', 'Network tariff'),
    ('peak_charge', 'Network peak (c/kWh)'),
    ('shoulder_charge', 'Network shoulder (c/kWh)'),
    ('off_peak_charge', 'Network off-peak (c/kWh)'),
    ('nuos_charge', 'NUOS demand ($/kVA/month)'),
    ('service_availability_charge', 'Service availability ($/day)'),
    ('aemo_participant_charge', 'AEMO participant (c/kWh)'),
    ('aemo_ancillary_services_charge', 'AEMO ancillary (c/kWh)'),
    ('srec_charge', 'SREC (c/kWh)'),
    ('lrec_charge', 'LREC (c/kWh)'),
    ('metering_charge', 'Metering ($/month)'),
    ('retail_service_charge', 'Retail service ($/month)'),
    ('admin_charge', 'Admin ($/month)'),
    ('load_escalation', 'Load escalation'),
    ('retail_escalation', 'Retail escalation'),
    ('supply_start', 'Supply start'),
    ('carry_forward_rate', 'Carry-forward escalation (% a year)'),
]

_REPLACEMENTS = {'–': '-', '—': '-', '−': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', '⚠': '!', ' ': ' '}


def _latin1(text):
    text = str(text)
    for a, b in _REPLACEMENTS.items():
        text = text.replace(a, b)
    return text.encode('latin-1', 'replace').decode('latin-1')


def _input_value(key, inputs, periods):
    if key == 'tariff_id':
        return core.tariff_label(inputs['tariff_id'])
    if key == 'supply_start':
        start = core.month_label(periods[0]['start'])
        return f'{start} (next quarter)' if inputs['supply_start'] == 'auto' else start
    if key == 'total_consumption':
        return f"{inputs[key]:,.0f}"
    return f"{inputs[key]:,.4f}".rstrip('0').rstrip('.')


def build_quote_pdf(result, periods, inputs, state, latest_date, warnings):
    """The quote sheet as PDF bytes."""
    settled = datetime.strptime(latest_date, '%Y-%m-%d').strftime('%d %b %Y').lstrip('0')
    pdf = FPDF(format='A4', unit='mm')
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_margins(16, 14, 16)
    pdf.add_page()
    width = pdf.w - pdf.l_margin - pdf.r_margin

    def text(size, style='', colour=INK):
        pdf.set_font('Helvetica', style, size)
        pdf.set_text_color(*colour)

    # Header: logo, title, settlement date and preparation date.
    if os.path.exists(LOGO):
        pdf.image(LOGO, x=pdf.l_margin, y=pdf.t_margin, h=11)
    text(18, 'B', HUM_BLUE)
    pdf.set_xy(pdf.l_margin + 32, pdf.t_margin)
    pdf.cell(0, 7, 'Bulk electricity quote')
    text(10, '', MUTED)
    pdf.set_xy(pdf.l_margin + 32, pdf.t_margin + 7)
    pdf.cell(width - 32 - 55, 5, _latin1(f'{state} · ASX settlement {settled}'))
    pdf.cell(55, 5, _latin1(f"Prepared {date.today().strftime('%d %B %Y').lstrip('0')}"), align='R')
    pdf.set_y(pdf.t_margin + 15)
    pdf.set_draw_color(*HUM_BLUE)
    pdf.set_line_width(0.6)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + width, pdf.get_y())

    # Headline price.
    pdf.ln(5)
    text(30, 'B')
    price = f"${result['bulk_price']:.4f}"
    pdf.cell(pdf.get_string_width(price) + 1, 13, price)
    text(14, '', MUTED)
    pdf.cell(20, 13, '/kWh')
    pdf.ln(12)
    text(10, '', MUTED)
    pdf.cell(0, 5, _latin1(f"${result['bulk_price'] * 1000:,.2f}/MWh · three-year average, "
                           f"{core.period_range(periods[0]['start'], 36)}"))
    pdf.ln(8)

    # Warnings.
    if warnings:
        pdf.set_draw_color(*MUTED)
        pdf.set_line_width(0.3)
        y0 = pdf.get_y()
        pdf.set_x(pdf.l_margin + 3)
        text(10, 'B')
        pdf.cell(0, 6, 'Please note')
        pdf.ln(6)
        text(9)
        for _, message in warnings:
            pdf.set_x(pdf.l_margin + 3)
            pdf.multi_cell(width - 6, 4.6, _latin1(f'- {message}'))
        pdf.ln(2)
        pdf.rect(pdf.l_margin, y0, width, pdf.get_y() - y0)
        pdf.ln(5)

    # Price by component and contract year.
    rates = result['tables']['rates']['rows']
    headings = ['Component ($/kWh)'] + [f"Year {i + 1}\n{p['label']}{'*' if p['estimates'] else ''}"
                                          for i, p in enumerate(periods)] + ['Average']
    pdf.set_draw_color(*RULE)
    pdf.set_line_width(0.2)
    text(9, 'B')
    with pdf.table(col_widths=(34, 24, 24, 24, 20), text_align=('LEFT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT'),
                   headings_style=FontFace(emphasis='BOLD', color=HUM_BLUE), line_height=6.5,
                   borders_layout='HORIZONTAL_LINES') as table:
        row = table.row()
        for h in headings:
            row.cell(_latin1(h))
        for i, (label, values, avg) in enumerate(rates):
            text(9, 'B' if i == 4 else '')
            row = table.row()
            row.cell(label.replace(' ($/kWh)', ''))
            for v in [*values, avg]:
                row.cell(f'{v:.4f}')
    text(8, '', MUTED)
    pdf.ln(1)
    sources = ' · '.join(f"Year {i + 1}: {', '.join(core.short_contract(s) for s in p['sources'])}{'*' if p['estimates'] else ''}"
                         for i, p in enumerate(periods))
    pdf.multi_cell(width, 4, _latin1(f'Priced from ASX contracts. {sources}'
                                     + ('. * Includes estimated months (see note above).' if any(p['estimates'] for p in periods) else '')))
    pdf.ln(5)

    # Inputs, in two columns.
    text(10, 'B', HUM_BLUE)
    pdf.cell(0, 6, 'Inputs')
    pdf.ln(7)
    items = [(label, _input_value(key, inputs, periods)) for key, label in INPUT_LABELS]
    half = (len(items) + 1) // 2
    text(8.5)
    with pdf.table(col_widths=(52, 36, 6, 52, 36), text_align=('LEFT', 'RIGHT', 'LEFT', 'LEFT', 'RIGHT'),
                   first_row_as_headings=False, line_height=5.2, borders_layout='HORIZONTAL_LINES') as table:
        for i in range(half):
            row = table.row()
            left = items[i]
            right = items[half + i] if half + i < len(items) else ('', '')
            for cell in (left[0], left[1], '', right[0], right[1]):
                row.cell(_latin1(cell))

    # Footer.
    pdf.ln(6)
    text(7.5, '', MUTED)
    pdf.multi_cell(width, 3.8, _latin1(
        f'Indicative estimate based on ASX Energy base settlement prices for {state} on {settled} and '
        f'{core.TARIFF_YEAR} network tariffs. Not an offer of supply.'))
    return bytes(pdf.output())
