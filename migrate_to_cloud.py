#!/usr/bin/env python3
"""
migrate_to_cloud.py — One-time data migration tool
Exports data from local SQLite → uploads to cloud PostgreSQL

Usage:
  1. Run locally to export:
     python3 migrate_to_cloud.py export

  2. Run to upload to cloud:
     python3 migrate_to_cloud.py upload https://your-app.railway.app

  Or do both in one step:
     python3 migrate_to_cloud.py migrate https://your-app.railway.app
"""

import json
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def export_local():
    """Export all data from local SQLite database."""
    # Force local SQLite mode
    os.environ.pop("DATABASE_URL", None)

    from database import init_db, export_all_data

    print("Connecting to local SQLite database...")
    init_db()

    print("Exporting all data...")
    data = export_all_data()

    summary = {
        "users": len(data.get("users", [])),
        "settings": len(data.get("settings", {})),
        "inventory": len(data.get("inventory", [])),
        "suppliers": len(data.get("suppliers", [])),
        "customers": len(data.get("customers", [])),
        "sales": len(data.get("sales", [])),
    }

    print("\n--- Export Summary ---")
    for table, count in summary.items():
        print(f"  {table}: {count} records")

    # Save to file
    export_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "export_for_cloud.json")
    os.makedirs(os.path.dirname(export_file), exist_ok=True)
    with open(export_file, "w") as f:
        json.dump(data, f, indent=2, default=str)

    print(f"\nSaved to: {export_file}")
    print(f"File size: {os.path.getsize(export_file) / 1024:.1f} KB")
    return data


def upload_to_cloud(cloud_url, data=None):
    """Upload exported data to the cloud instance."""
    import urllib.request
    import urllib.error

    if data is None:
        export_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "export_for_cloud.json")
        if not os.path.exists(export_file):
            print("ERROR: No export file found. Run 'export' first.")
            sys.exit(1)
        with open(export_file, "r") as f:
            data = json.load(f)

    cloud_url = cloud_url.rstrip("/")

    # Step 1: Login as admin to get session
    print(f"\nConnecting to cloud: {cloud_url}")
    username = input("Admin username: ").strip()
    password = input("Admin password: ").strip()

    if not username:
        print("\n--- First-time Setup ---")
        print("Your cloud database is empty. The import will create users from your local data.")
        print("After import, you can log in with your existing credentials.")
        print("\nProceeding with direct import (no auth needed for empty database)...")

        # Try health check first
        try:
            req = urllib.request.Request(f"{cloud_url}/api/health")
            resp = urllib.request.urlopen(req, timeout=10)
            health = json.loads(resp.read())
            print(f"Cloud status: {health.get('status')} ({health.get('engine')})")

            if health.get("users", 0) > 0:
                print("ERROR: Cloud database already has users. You must authenticate.")
                sys.exit(1)
        except Exception as e:
            print(f"WARNING: Could not check health: {e}")

        # Direct import for empty database
        payload = json.dumps({"data": data}).encode("utf-8")
        req = urllib.request.Request(
            f"{cloud_url}/api/data/import",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )

    else:
        # Login
        login_payload = json.dumps({"username": username, "password": password}).encode("utf-8")
        req = urllib.request.Request(
            f"{cloud_url}/api/auth/login",
            data=login_payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        try:
            resp = urllib.request.urlopen(req, timeout=10)
            cookies = resp.headers.get_all("Set-Cookie")
            cookie_str = "; ".join(c.split(";")[0] for c in cookies) if cookies else ""
            login_result = json.loads(resp.read())
            if not login_result.get("success"):
                print(f"Login failed: {login_result.get('error')}")
                sys.exit(1)
            print(f"Logged in as: {login_result['user']['name']} ({login_result['user']['role']})")
        except urllib.error.HTTPError as e:
            print(f"Login failed: {e.code} {e.read().decode()}")
            sys.exit(1)

        # Upload
        payload = json.dumps({"data": data}).encode("utf-8")
        req = urllib.request.Request(
            f"{cloud_url}/api/data/import",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Cookie": cookie_str,
            },
            method="POST"
        )

    try:
        print(f"\nUploading data ({len(payload) / 1024:.1f} KB)...")
        resp = urllib.request.urlopen(req, timeout=60)
        result = json.loads(resp.read())

        if result.get("success"):
            print("\n--- Import Summary ---")
            for table, count in result.get("imported", {}).items():
                print(f"  {table}: {count} records")
            print("\nMigration complete! Your cloud POS is ready.")
        else:
            print(f"Import failed: {result.get('error')}")
    except urllib.error.HTTPError as e:
        print(f"Import failed: {e.code} {e.read().decode()}")
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    command = sys.argv[1].lower()

    if command == "export":
        export_local()

    elif command == "upload":
        if len(sys.argv) < 3:
            print("Usage: python3 migrate_to_cloud.py upload https://your-app.railway.app")
            sys.exit(1)
        upload_to_cloud(sys.argv[2])

    elif command == "migrate":
        if len(sys.argv) < 3:
            print("Usage: python3 migrate_to_cloud.py migrate https://your-app.railway.app")
            sys.exit(1)
        data = export_local()
        upload_to_cloud(sys.argv[2], data)

    else:
        print(f"Unknown command: {command}")
        print(__doc__)
        sys.exit(1)
