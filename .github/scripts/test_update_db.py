"""
Tests for update_db's page reading (needs the project's packages): uv run python .github/scripts/test_update_db.py

The pages here are cut-down copies of the ASX page's structure: a contract-btn per
product and state, inside a shadow-md card whose data-table-container holds a table
with Period | Bid | Ask | Last | +/- | Vol | Settle.
"""

import os
import sys
from datetime import date

from bs4 import BeautifulSoup

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
import update_db  # noqa: E402

DAY = date(2026, 11, 16)
QUARTERS = {'NSW': 123.0, 'VIC': 67.75, 'QLD': 94.0, 'SA': 70.0}
STRIPS = {'NSW': 96.34, 'VIC': 74.23, 'QLD': 79.39, 'SA': 87.45}


def card(code, rows):
    trs = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in (label, '-', '-', '-', '-', '-', settle)) + '</tr>'
                  for label, settle in rows)
    return (f'<div class="rounded shadow-md"><button class="contract-btn" data-code="{code}">{code}</button>'
            f'<div class="data-table-container"><table><tbody>{trs}</tbody></table></div></div>')


def page(settles=True, codes=None):
    cards = []
    for code, state in {**update_db.BASE_QUARTER_CODES, **update_db.BASE_STRIP_CODES}.items():
        if codes is not None and code not in codes:
            continue
        if code in update_db.BASE_QUARTER_CODES:
            rows = [('Q426', QUARTERS[state] if settles else '-')]
        else:
            rows = [('FY28', STRIPS[state] if settles else '-')]
        cards.append(card(code, rows))
    return BeautifulSoup('<html><body>' + ''.join(cards) + '</body></html>', 'html.parser')


def raises(exc, fn, *args):
    try:
        fn(*args)
    except exc:
        return True
    return False


def test_reads_settlement_prices():
    rows = update_db.parse_page(page(), DAY)
    by_name = {r[1]: r for r in rows}
    assert by_name['FY2028'] == ('2026-11-16', 'FY2028', '2027-07', 12, 96.34, 74.23, 79.39, 87.45)
    assert by_name['Q4 2026'][4:] == (123.0, 67.75, 94.0, 70.0)


def test_blank_page_before_the_open_is_not_a_failure():
    # 17 Nov 2026, 8:02 am Sydney: every table there, every Settle cell blank.
    assert raises(update_db.NoPricesYet, update_db.parse_page, page(settles=False), DAY)


def test_missing_tables_are_still_a_layout_failure():
    assert raises(update_db.UpdateError, update_db.parse_page, BeautifulSoup('<html></html>', 'html.parser'), DAY)
    # Blank prices AND a missing table: not the known pre-open page, so fail.
    blank_partial = page(settles=False, codes=set(update_db.BASE_STRIP_CODES) | {'BN', 'BV', 'BQ'})
    assert raises(update_db.UpdateError, update_db.parse_page, blank_partial, DAY)


def test_prices_without_fy_strips_are_a_layout_failure():
    only_quarters = page(codes=set(update_db.BASE_QUARTER_CODES))
    assert raises(update_db.UpdateError, update_db.parse_page, only_quarters, DAY)


if __name__ == '__main__':
    tests = [v for k, v in sorted(globals().items()) if k.startswith('test_')]
    for t in tests:
        t()
        print('ok', t.__name__)
    print(f'{len(tests)} tests passed')
