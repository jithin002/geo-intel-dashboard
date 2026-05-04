"""
cleaner.py
----------
Reads raw_listings.csv, cleans and normalises the data,
computes price_per_sqft, and outputs data/cleaned_listings.csv

Usage:
    python cleaner.py

Requirements:
    pip install pandas
"""
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

import re
import os
import pandas as pd

# ─── Paths ────────────────────────────────────────────────────────────────────

BASE_DIR   = os.path.dirname(__file__)
RAW_FILE   = os.path.join(BASE_DIR, "data", "raw_listings.csv")
CLEAN_FILE = os.path.join(BASE_DIR, "data", "cleaned_listings.csv")

# ─── Domain Classification ────────────────────────────────────────────────────

RETAIL_KEYWORDS    = ["shop", "showroom", "retail", "kiosk", "commercial space"]
RESTAURANT_KEYWORDS = ["restaurant", "cafe", "food court", "canteen", "cloud kitchen"]
OFFICE_KEYWORDS    = ["office", "co-working", "coworking", "bpo", "workspace", "it park"]
GYM_KEYWORDS       = ["gym", "fitness", "sports complex", "studio"]
BANK_KEYWORDS      = ["bank", "atm", "financial", "nbfc"]

def classify_domain(title: str, prop_type: str) -> str:
    text = (title + " " + prop_type).lower()
    if any(k in text for k in RESTAURANT_KEYWORDS):
        return "Restaurant"
    if any(k in text for k in GYM_KEYWORDS):
        return "Gym"
    if any(k in text for k in BANK_KEYWORDS):
        return "Bank"
    if any(k in text for k in OFFICE_KEYWORDS):
        return "Office"
    if any(k in text for k in RETAIL_KEYWORDS):
        return "Retail"
    return "Commercial"  # generic fallback

# ─── Parsing Helpers ──────────────────────────────────────────────────────────

def parse_rent(raw: str) -> float | None:
    """
    Converts Indian rent strings to a float (monthly rent in INR).
    Examples:
        '₹1,20,000/month'  → 120000.0
        '₹ 1.2 Lac/month'  → 120000.0
        '₹45,000'           → 45000.0
        '₹2 Cr'             → 20000000.0
    """
    if not raw or not isinstance(raw, str):
        return None
    s = raw.replace("₹", "").replace(",", "").strip().lower()
    s = re.sub(r"/month.*", "", s).strip()

    try:
        if "cr" in s:
            num = float(re.findall(r"[\d.]+", s)[0])
            return num * 1_00_00_000
        if "lac" in s or "lakh" in s:
            num = float(re.findall(r"[\d.]+", s)[0])
            return num * 1_00_000
        if "k" in s:
            num = float(re.findall(r"[\d.]+", s)[0])
            return num * 1_000
        nums = re.findall(r"[\d.]+", s)
        return float(nums[0]) if nums else None
    except (IndexError, ValueError):
        return None


def parse_area(raw: str) -> float | None:
    """
    Extracts numeric sqft value from area strings.
    Examples:
        '1200 sq.ft'   → 1200.0
        '1,500 Sq. Ft' → 1500.0
    """
    if not raw or not isinstance(raw, str):
        return None
    s = raw.replace(",", "").lower()
    nums = re.findall(r"[\d.]+", s)
    return float(nums[0]) if nums else None


def clean_locality(raw: str) -> str:
    """Strips trailing city names and whitespace from locality strings."""
    if not raw or not isinstance(raw, str):
        return ""
    # e.g. "Indiranagar, Bengaluru" → "Indiranagar"
    parts = raw.split(",")
    return parts[0].strip()

# ─── Main Cleaner ─────────────────────────────────────────────────────────────

def clean():
    print(f"[Reading] {RAW_FILE}")
    if not os.path.exists(RAW_FILE):
        print("[Error] raw_listings.csv not found. Run scraper.py first.")
        return

    df = pd.read_csv(RAW_FILE)
    print(f"  -> {len(df)} raw rows loaded")

    # Parse numeric columns
    df["monthly_rent_inr"] = df["monthly_rent"].apply(parse_rent)
    df["area_sqft_num"]    = df["area_sqft"].apply(parse_area)
    df["locality_clean"]   = df["locality"].apply(clean_locality)

    # Drop rows without usable rent or area data
    before = len(df)
    df = df.dropna(subset=["monthly_rent_inr", "area_sqft_num"])
    df = df[df["monthly_rent_inr"] > 0]
    df = df[df["area_sqft_num"] > 0]
    print(f"  -> Dropped {before - len(df)} rows with missing/zero rent or area")

    # Compute price per sqft per month
    df["price_per_sqft"] = (df["monthly_rent_inr"] / df["area_sqft_num"]).round(2)

    # Remove extreme outliers (beyond 3 standard deviations)
    mean, std = df["price_per_sqft"].mean(), df["price_per_sqft"].std()
    before = len(df)
    df = df[(df["price_per_sqft"] > mean - 3 * std) & (df["price_per_sqft"] < mean + 3 * std)]
    print(f"  -> Removed {before - len(df)} outlier rows (3-sigma outliers)")

    # Classify domain
    df["domain_type"] = df.apply(
        lambda r: classify_domain(str(r["title"]), str(r["property_type"])), axis=1
    )

    # Final column selection
    final_cols = [
        "listing_id", "title", "locality_clean", "city", "domain_type",
        "monthly_rent_inr", "area_sqft_num", "price_per_sqft",
        "listing_url", "image_url"
    ]
    df = df[final_cols].rename(columns={
        "locality_clean": "locality",
        "monthly_rent_inr": "monthly_rent",
        "area_sqft_num": "area_sqft"
    })

    # Save
    df.to_csv(CLEAN_FILE, index=False, encoding="utf-8")
    print(f"\n[Done] {len(df)} clean listings -> {CLEAN_FILE}")

    # Print summary stats
    print("\n── Locality Summary ──────────────────────────────────────────────")
    summary = (
        df.groupby("locality")["price_per_sqft"]
        .agg(count="count", avg="mean", min="min", max="max")
        .round(2)
        .sort_values("count", ascending=False)
        .head(15)
    )
    print(summary.to_string())

    print("\n── Domain Summary ────────────────────────────────────────────────")
    print(df.groupby("domain_type")["price_per_sqft"].agg(count="count", avg="mean").round(2))


if __name__ == "__main__":
    clean()
