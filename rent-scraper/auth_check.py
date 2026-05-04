"""
auth_check.py
-------------
Checks which Google Cloud credentials are available and tests BigQuery access.

Run this BEFORE setup_bigquery.py or uploader.py to confirm your setup is working.

Usage:
    python auth_check.py
    python auth_check.py --key path/to/service-account.json

If you don't have a service account key:
    1. Go to: https://console.cloud.google.com/iam-admin/serviceaccounts
    2. Select your project (noted-edge-455317-p6)
    3. Create a service account with "BigQuery Data Editor" + "BigQuery Job User" roles
    4. Create a JSON key and download it
    5. Run: python auth_check.py --key path/to/downloaded-key.json
"""

import sys
import os
import argparse

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

PROJECT_ID = "testing-jithin"


def check_credentials(key_path: str | None):
    try:
        from google.cloud import bigquery
        import google.auth

        if key_path:
            # Use explicit service account key
            if not os.path.exists(key_path):
                print(f"[ERROR] Key file not found: {key_path}")
                return
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.abspath(key_path)
            print(f"[OK] Using service account key: {key_path}")
        else:
            print("[INFO] No key file provided. Trying Application Default Credentials (ADC)...")

        # Try to create a BigQuery client
        client = bigquery.Client(project=PROJECT_ID)
        print(f"[OK] BigQuery client created for project: {PROJECT_ID}")

        # Run a simple test query
        query = "SELECT 1 as test"
        result = list(client.query(query).result())
        print(f"[OK] Test query succeeded: {result[0]['test']}")
        print("\n[READY] You can now run:")
        print("         python setup_bigquery.py")
        print("         python uploader.py")

    except Exception as e:
        print(f"\n[ERROR] Authentication failed: {e}")
        print("\n[FIX] To authenticate, do ONE of the following:")
        print()
        print("  Option A (Service Account Key):")
        print("    1. Visit: https://console.cloud.google.com/iam-admin/serviceaccounts")
        print("    2. Select project: noted-edge-455317-p6")
        print("    3. Create service account -> grant 'BigQuery Data Editor' + 'BigQuery Job User'")
        print("    4. Create JSON key -> download")
        print("    5. Run: python auth_check.py --key <path-to-key.json>")
        print()
        print("  Option B (gcloud ADC, if gcloud is installed):")
        print("    gcloud auth application-default login")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--key", default=None, help="Path to service account JSON key file")
    args = parser.parse_args()
    check_credentials(args.key)
