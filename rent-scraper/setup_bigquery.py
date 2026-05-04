"""
setup_bigquery.py
-----------------
One-time script to create the BigQuery dataset and table.
Run this ONCE before running uploader.py.

Usage:
    python setup_bigquery.py

Requirements:
    pip install google-cloud-bigquery
    GOOGLE_APPLICATION_CREDENTIALS env var must point to your service account JSON.
    Or: run `gcloud auth application-default login` to use your user credentials.
"""

import sys
import os
import argparse
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

from google.cloud import bigquery

# ── Config ────────────────────────────────────────────────────────────────────

PROJECT_ID  = "testing-jithin"        # Your project where jithin.m@econz.net is Owner
DATASET_ID  = "geo_intel"
TABLE_ID    = "commercial_rent_listings"
LOCATION    = "asia-south1"            # Mumbai — closest to Bengaluru

# ── Schema ────────────────────────────────────────────────────────────────────

SCHEMA = [
    bigquery.SchemaField("listing_id",    "STRING",  mode="REQUIRED"),
    bigquery.SchemaField("title",         "STRING",  mode="NULLABLE"),
    bigquery.SchemaField("locality",      "STRING",  mode="NULLABLE"),
    bigquery.SchemaField("city",          "STRING",  mode="NULLABLE"),
    bigquery.SchemaField("domain_type",   "STRING",  mode="NULLABLE"),  # Retail, Office, etc.
    bigquery.SchemaField("property_type", "STRING",  mode="NULLABLE"),  # Shop, Showroom
    bigquery.SchemaField("monthly_rent",  "FLOAT64", mode="NULLABLE"),  # INR
    bigquery.SchemaField("area_sqft",     "FLOAT64", mode="NULLABLE"),
    bigquery.SchemaField("price_per_sqft","FLOAT64", mode="NULLABLE"),
    bigquery.SchemaField("floor",         "STRING",  mode="NULLABLE"),
    bigquery.SchemaField("listing_url",   "STRING",  mode="NULLABLE"),
    bigquery.SchemaField("image_url",     "STRING",  mode="NULLABLE"),
    # GEOGRAPHY column for spatial queries (ST_DWithin, ST_GEOGPOINT)
    # Populated by uploader.py after geocoding localities
    bigquery.SchemaField("geo_point",     "GEOGRAPHY", mode="NULLABLE"),
    bigquery.SchemaField("latitude",      "FLOAT64", mode="NULLABLE"),
    bigquery.SchemaField("longitude",     "FLOAT64", mode="NULLABLE"),
    bigquery.SchemaField("scraped_at",    "TIMESTAMP", mode="NULLABLE"),
]

# ── Main ──────────────────────────────────────────────────────────────────────

def main(key_path: str | None = None):
    if key_path:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.abspath(key_path)
        print(f"[Auth] Using service account key: {key_path}")

    client = bigquery.Client(project=PROJECT_ID)
    print(f"[OK] Connected to BigQuery project: {PROJECT_ID}")

    # 1. Create dataset (skip if exists)
    dataset_ref = bigquery.Dataset(f"{PROJECT_ID}.{DATASET_ID}")
    dataset_ref.location = LOCATION
    dataset_ref.description = "Geo-Intel Dashboard: Commercial rent intelligence data for Bengaluru"
    try:
        dataset = client.create_dataset(dataset_ref, exists_ok=True)
        print(f"[OK] Dataset ready: {PROJECT_ID}.{DATASET_ID} (location: {LOCATION})")
    except Exception as e:
        print(f"[ERROR] Could not create dataset: {e}")
        return

    # 2. Create table (skip if exists)
    table_ref = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}"
    table = bigquery.Table(table_ref, schema=SCHEMA)
    try:
        table = client.create_table(table, exists_ok=True)
        print(f"[OK] Table ready: {table_ref}")
        print(f"     Rows currently: {client.get_table(table_ref).num_rows}")
    except Exception as e:
        print(f"[ERROR] Could not create table: {e}")
        return

    print("\n[Done] BigQuery setup complete. Run uploader.py to push data.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--key", default=None, help="Path to service account JSON key")
    args = parser.parse_args()
    main(key_path=args.key)
