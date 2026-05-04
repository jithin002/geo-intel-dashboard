"""
scraper.py
----------
Scrapes commercial property listings from MagicBricks for Bengaluru.

Uses a VISIBLE browser (headless=False) to bypass MagicBricks bot detection.
The browser window will open on your screen — do not close it while scraping.

Outputs raw data to: data/raw_listings.csv

Usage:
    python scraper.py

Requirements:
    pip install playwright pandas
    playwright install chromium
"""

import asyncio
import random
import csv
import os
import sys
import time
import re

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

from playwright.async_api import async_playwright

# ── Config ────────────────────────────────────────────────────────────────────

OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "data", "raw_listings.csv")
MAX_PAGES   = 10  # ~30 listings per page

# MagicBricks commercial rent URL (confirmed working by user)
TARGET_URL = (
    "https://www.magicbricks.com/property-for-rent/commercial-real-estate"
    "?bedroom=&proptype=Commercial-Shop,Commercial-Showroom&cityName=Bangalore"
)

FIELDNAMES = [
    "listing_id", "title", "locality", "city", "property_type",
    "monthly_rent", "area_sqft", "floor", "listing_url", "image_url",
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def ensure_output_dir():
    os.makedirs(os.path.join(os.path.dirname(__file__), "data"), exist_ok=True)


async def get_summary_value(card, label_text: str) -> str:
    """
    Extracts the value next to a given label in the MagicBricks summary grid.
    Labels use .mb-srp__card__summary--label
    Values use .mb-srp__card__summary--value
    """
    try:
        labels = await card.query_selector_all(".mb-srp__card__summary--label")
        values = await card.query_selector_all(".mb-srp__card__summary--value")
        for i, label_el in enumerate(labels):
            label_str = (await label_el.inner_text()).strip().upper()
            if label_text.upper() in label_str and i < len(values):
                return (await values[i].inner_text()).strip()
    except Exception:
        pass
    return ""

# ── Scraper ───────────────────────────────────────────────────────────────────

async def scrape_listings():
    ensure_output_dir()
    all_listings = []

    async with async_playwright() as p:
        # headless=False: show browser window to bypass bot detection
        browser = await p.chromium.launch(
            headless=False,
            args=["--start-maximized"]
        )
        context = await browser.new_context(
            viewport={"width": 1366, "height": 768},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        print("[INFO] Browser opened. Do NOT close it while scraping.")
        print(f"[INFO] Scraping: {TARGET_URL}\n")

        for page_num in range(1, MAX_PAGES + 1):
            url = TARGET_URL if page_num == 1 else f"{TARGET_URL}&page={page_num}"
            print(f"[Page {page_num}] -> {url}")

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=40000)
                await page.wait_for_timeout(5000)  # wait for JS to render cards
            except Exception as e:
                print(f"  [!] Navigation failed: {e}")
                break

            cards = await page.query_selector_all(".mb-srp__card")
            print(f"  Cards found: {len(cards)}")
            if not cards:
                print("  [!] No cards found on this page. Stopping.")
                break

            for i, card in enumerate(cards):
                try:
                    # Title  (confirmed selector: H2.mb-srp__card--title)
                    title_el = await card.query_selector(".mb-srp__card--title")
                    title = (await title_el.inner_text()).strip() if title_el else ""

                    # Locality (extract from title if no dedicated element)
                    # Title format: "Shop for Rent in HAL Old Airport Road Bangalore"
                    locality = ""
                    loc_el = await card.query_selector(".mb-srp__card--locality, .mb-srp__card-desc--locality")
                    if loc_el:
                        locality = (await loc_el.inner_text()).strip()
                    elif title:
                        # Parse "... in <Locality> Bangalore" from title
                        match = re.search(r"\bin\s+(.+?)\s+Bangalore", title, re.IGNORECASE)
                        if match:
                            locality = match.group(1).strip()

                    # Price (confirmed selector: .mb-srp__card__price--amount)
                    price_el = await card.query_selector(".mb-srp__card__price--amount")
                    monthly_rent = (await price_el.inner_text()).strip() if price_el else ""

                    # Area — label/value pair (confirmed structure)
                    area_sqft = await get_summary_value(card, "AREA")

                    # Floor — label/value pair
                    floor = await get_summary_value(card, "FLOOR")

                    # Property type — parse from title or card badge
                    prop_type = ""
                    badge_el = await card.query_selector(".mb-srp__card--type, .mb-srp__card__badge")
                    if badge_el:
                        prop_type = (await badge_el.inner_text()).strip()
                    elif title:
                        for ptype in ["Shop", "Showroom", "Office", "Retail"]:
                            if ptype.lower() in title.lower():
                                prop_type = ptype
                                break

                    # Listing URL
                    link_el = await card.query_selector("a.mb-srp__card--anchor, a[href*='property']")
                    href = (await link_el.get_attribute("href") or "") if link_el else ""
                    listing_url = f"https://www.magicbricks.com{href}" if href.startswith("/") else href

                    # Image
                    img_el = await card.query_selector("img.mb-srp__card--photo, img[src*='magicbricks']")
                    image_url = (await img_el.get_attribute("src") or "") if img_el else ""

                    listing = {
                        "listing_id":    f"mb_p{page_num}_i{i}",
                        "title":         title,
                        "locality":      locality,
                        "city":          "Bengaluru",
                        "property_type": prop_type,
                        "monthly_rent":  monthly_rent,
                        "area_sqft":     area_sqft,
                        "floor":         floor,
                        "listing_url":   listing_url,
                        "image_url":     image_url,
                    }

                    # Accept listing if it has a price (even if other fields are partial)
                    if monthly_rent:
                        all_listings.append(listing)

                except Exception as e:
                    print(f"  [!] Error on card {i}: {e}")
                    continue

            print(f"  Running total: {len(all_listings)} listings collected.")
            time.sleep(random.uniform(2.5, 4.0))

        await browser.close()

    # ── Write CSV ─────────────────────────────────────────────────────────────
    print(f"\n[Done] Total: {len(all_listings)} listings scraped.")
    print(f"[Saving] -> {OUTPUT_FILE}")

    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for row in all_listings:
            writer.writerow({k: row.get(k, "") for k in FIELDNAMES})

    print(f"[OK] CSV saved: {OUTPUT_FILE}")
    return all_listings


if __name__ == "__main__":
    asyncio.run(scrape_listings())
