"""Keep the HUMQuote Streamlit app awake.

Streamlit Community Cloud hibernates apps after 12 hours without traffic, and its
activity signal is the websocket a real browser opens after the page loads - a plain
HTTP GET returns 200 without ever counting as a visit. So this opens the app in
headless Chromium, and clicks the "Yes, get this app back up!" button if the app has
already gone to sleep.

Run from GitHub Actions (see .github/workflows/keep-awake.yml) or locally with:

    pip install playwright && playwright install chromium
    python scripts/keep_awake.py
"""

import os
import sys

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

APP_URL = os.environ.get("APP_URL", "https://humquote.streamlit.app")

# The app root only appears once Streamlit has booted and the websocket is connected.
APP_ROOT = '[data-testid="stApp"]'
WAKE_BUTTON = "button:has-text('get this app back up')"

# A cold boot reinstalls requirements.txt, which can take a couple of minutes.
BOOT_TIMEOUT_MS = 240_000
FAILURE_SCREENSHOT = "keep_awake_failure.png"
FAILURE_HTML = "keep_awake_failure.html"


def main() -> int:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page()

        try:
            print(f"Opening {APP_URL}")
            page.goto(APP_URL, wait_until="domcontentloaded", timeout=60_000)

            # Give the hibernation screen (or the app itself) a moment to render.
            page.wait_for_timeout(5_000)

            wake_button = page.locator(WAKE_BUTTON).first
            if wake_button.count() > 0 and wake_button.is_visible():
                print("App was asleep - clicking the wake button")
                wake_button.click()
            else:
                print("No wake button found - app appears to be awake already")

            page.wait_for_selector(APP_ROOT, state="visible", timeout=BOOT_TIMEOUT_MS)
            print(f"App is up: {page.title()!r}")
            return 0

        except PlaywrightTimeoutError as exc:
            print(f"Timed out waiting for the app: {exc}", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001 - surface anything as a red build
            print(f"Failed to wake the app: {exc}", file=sys.stderr)

        # Save whatever we ended up looking at, so the Actions run is debuggable.
        try:
            page.screenshot(path=FAILURE_SCREENSHOT, full_page=True)
            with open(FAILURE_HTML, "w", encoding="utf-8") as handle:
                handle.write(page.content())
            print(f"Wrote {FAILURE_SCREENSHOT} and {FAILURE_HTML}", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            print(f"Could not capture failure state: {exc}", file=sys.stderr)

        return 1


if __name__ == "__main__":
    sys.exit(main())
