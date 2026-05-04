"""
uploader.py
-----------
Reads cleaned_listings.csv, geocodes each locality to lat/lng using
Google Maps Geocoding API, then uploads everything to BigQuery.

Usage:
    python uploader.py

Requirements:
    pip install google-cloud-bigquery pandas pyarrow requests
    Run setup_bigquery.py first to create the dataset/table.
    GOOGLE_APPLICATION_CREDENTIALS must be set, or use gcloud ADC.
    GOOGLE_MAPS_API_KEY must be set (for geocoding).
"""

import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

import os
import time
import argparse
import pandas as pd
import requests
from datetime import datetime, timezone
from google.cloud import bigquery

# ── Config ────────────────────────────────────────────────────────────────────

PROJECT_ID = "testing-jithin"
DATASET_ID = "geo_intel"
TABLE_ID   = "commercial_rent_listings"
TABLE_REF  = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}"

BASE_DIR    = os.path.dirname(__file__)
CLEAN_FILE  = os.path.join(BASE_DIR, "data", "cleaned_listings.csv")
GEOCODE_CACHE_FILE = os.path.join(BASE_DIR, "data", "geocode_cache.json")

# Google Maps API key for geocoding (read from env var or paste directly)
MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")

# Bengaluru bounding box — used to validate geocoded results
BENGALURU_BOUNDS = {
    "min_lat": 12.7342, "max_lat": 13.1734,
    "min_lng": 77.3791, "max_lng": 77.7826,
}

# ── Geocoding ─────────────────────────────────────────────────────────────────

def load_geocode_cache() -> dict:
    """Load previously geocoded localities from disk to avoid redundant API calls."""
    import json
    if os.path.exists(GEOCODE_CACHE_FILE):
        with open(GEOCODE_CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_geocode_cache(cache: dict):
    import json
    with open(GEOCODE_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)


def geocode_locality(locality: str, cache: dict) -> tuple[float | None, float | None]:
    """
    Converts a locality name to (lat, lng) using Google Maps Geocoding API.
    Uses cache to avoid duplicate calls.
    """
    if not locality or not locality.strip():
        return None, None

    key = locality.strip().lower()
    if key in cache:
        return cache[key].get("lat"), cache[key].get("lng")

    query = f"{locality}, Bangalore, Karnataka, India"
    url = (
        f"https://maps.googleapis.com/maps/api/geocode/json"
        f"?address={requests.utils.quote(query)}&key={MAPS_API_KEY}"
    )
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        if data.get("status") == "OK" and data.get("results"):
            loc = data["results"][0]["geometry"]["location"]
            lat, lng = loc["lat"], loc["lng"]
            # Validate it's actually inside Bengaluru bounds
            b = BENGALURU_BOUNDS
            if b["min_lat"] <= lat <= b["max_lat"] and b["min_lng"] <= lng <= b["max_lng"]:
                cache[key] = {"lat": lat, "lng": lng}
                return lat, lng
            else:
                print(f"  [Skip] '{locality}' geocoded outside Bengaluru: ({lat}, {lng})")
                cache[key] = {"lat": None, "lng": None}
        else:
            print(f"  [Skip] Geocoding failed for '{locality}': {data.get('status')}")
            cache[key] = {"lat": None, "lng": None}
    except Exception as e:
        print(f"  [Error] Geocoding '{locality}': {e}")

    time.sleep(0.05)  # 50ms delay to stay under quota
    return None, None


# ── Upload ────────────────────────────────────────────────────────────────────

def upload(key_path: str | None = None):
    if key_path:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.abspath(key_path)
        print(f"[Auth] Using service account key: {key_path}")

    if not os.path.exists(CLEAN_FILE):
        print(f"[Error] {CLEAN_FILE} not found. Run cleaner.py first.")
        return

    print(f"[Reading] {CLEAN_FILE}")
    df = pd.read_csv(CLEAN_FILE)
    print(f"  -> {len(df)} rows loaded")

    # ── Step 1: Geocode all unique localities ─────────────────────────────
    print("\n[Geocoding] Resolving locality names to coordinates...")
    cache = load_geocode_cache()
    unique_localities = df["locality"].dropna().unique()
    print(f"  -> {len(unique_localities)} unique localities to resolve")

    lats, lngs = [], []
    for _, row in df.iterrows():
        lat, lng = geocode_locality(str(row["locality"]), cache)
        lats.append(lat)
        lngs.append(lng)

    save_geocode_cache(cache)
    df["latitude"]  = lats
    df["longitude"] = lngs

    # Build WKT geo_point for BigQuery GEOGRAPHY column
    def make_geo_point(row):
        if pd.notna(row["latitude"]) and pd.notna(row["longitude"]):
            return f"POINT({row['longitude']} {row['latitude']})"
        return None

    df["geo_point"]  = df.apply(make_geo_point, axis=1)
    df["scraped_at"] = pd.to_datetime("now", utc=True)

    # Rename columns to match BigQuery schema
    df = df.rename(columns={
        "monthly_rent": "monthly_rent",
        "area_sqft":    "area_sqft",
    })

    # Ensure correct dtypes
    df["monthly_rent"]   = pd.to_numeric(df["monthly_rent"],   errors="coerce")
    df["area_sqft"]      = pd.to_numeric(df["area_sqft"],      errors="coerce")
    df["price_per_sqft"] = pd.to_numeric(df["price_per_sqft"], errors="coerce")

    # Add property_type and floor if not present
    if "property_type" not in df.columns:
        df["property_type"] = ""
    if "floor" not in df.columns:
        df["floor"] = ""

    # Final column order matching BigQuery schema
    bq_columns = [
        "listing_id", "title", "locality", "city", "domain_type",
        "property_type", "monthly_rent", "area_sqft", "price_per_sqft",
        "floor", "listing_url", "image_url",
        "geo_point", "latitude", "longitude", "scraped_at",
    ]
    # Only keep columns that exist in df
    bq_columns = [c for c in bq_columns if c in df.columns]
    df = df[bq_columns]

    geocoded_count = df["latitude"].notna().sum()
    print(f"  -> {geocoded_count}/{len(df)} rows successfully geocoded")

    # ── Step 2: Upload to BigQuery ────────────────────────────────────────
    print(f"\n[Uploading] -> BigQuery: {TABLE_REF}")
    client = bigquery.Client(project=PROJECT_ID)

    job_config = bigquery.LoadJobConfig(
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,  # Replace all rows
        schema=[
            bigquery.SchemaField("listing_id",    "STRING"),
            bigquery.SchemaField("title",         "STRING"),
            bigquery.SchemaField("locality",      "STRING"),
            bigquery.SchemaField("city",          "STRING"),
            bigquery.SchemaField("domain_type",   "STRING"),
            bigquery.SchemaField("property_type", "STRING"),
            bigquery.SchemaField("monthly_rent",  "FLOAT64"),
            bigquery.SchemaField("area_sqft",     "FLOAT64"),
            bigquery.SchemaField("price_per_sqft","FLOAT64"),
            bigquery.SchemaField("floor",         "STRING"),
            bigquery.SchemaField("listing_url",   "STRING"),
            bigquery.SchemaField("image_url",     "STRING"),
            bigquery.SchemaField("geo_point",     "GEOGRAPHY"),
            bigquery.SchemaField("latitude",      "FLOAT64"),
            bigquery.SchemaField("longitude",     "FLOAT64"),
            bigquery.SchemaField("scraped_at",    "TIMESTAMP"),
        ],
    )

    job = client.load_table_from_dataframe(df, TABLE_REF, job_config=job_config)
    job.result()  # Wait for job to complete

    table = client.get_table(TABLE_REF)
    print(f"[OK] Upload complete. Table now has {table.num_rows} rows.")
    print(f"\n[Summary]")
    print(f"  Rows uploaded   : {len(df)}")
    print(f"  Geocoded rows   : {geocoded_count}")
    print(f"  BigQuery table  : {TABLE_REF}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--key", default=None, help="Path to service account JSON key")
    args = parser.parse_args()
    upload(key_path=args.key)
