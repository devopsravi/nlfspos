# Next Level Furniture (NLF) — Point of Sale System

A complete POS system for Next Level Furniture. Runs **locally** (SQLite) or **online** (PostgreSQL on Railway/Render). Configured for India (INR, GST).

![POS](https://img.shields.io/badge/Status-Ready-brightgreen) ![Python](https://img.shields.io/badge/Python-3.9+-blue) ![Flask](https://img.shields.io/badge/Flask-3.0-orange) ![Deploy](https://img.shields.io/badge/Deploy-Railway%20%7C%20Render-purple)

---

## Features

| Feature | Details |
|---|---|
| **Point of Sale** | Touch-friendly checkout, cart, barcode scanner, multi-payment (Cash/UPI/Card) |
| **Inventory** | Full CRUD, search, filter, low-stock alerts, CSV import/export |
| **Void/Refund** | Void sales with inventory auto-restore, permission-controlled |
| **Customers** | Auto-capture during sales, POS lookup, full management |
| **Suppliers** | Complete supplier directory with inventory linkage |
| **Label Printing** | Barcode labels in 3 sizes, batch printing |
| **Receipt Printing** | Thermal (80mm) + A4, WhatsApp share |
| **Dashboard** | Today/week/month sales, bar charts, top products, margin % |
| **Reports** | Transaction history, CSV export, date/cashier/method filters |
| **Multi-User** | Role-based access: Admin, Manager, Staff |
| **Dark Mode** | Toggle between light and dark themes |
| **Online/Offline** | Works locally (SQLite) or cloud (PostgreSQL) — same codebase |

---

## Quick Start (Local / Offline)

### 1. Install

```bash
cd furniture-pos
pip install -r requirements.txt
```

### 2. Run

```bash
python3 app.py
```

### 3. Open

Go to **[http://localhost:8000](http://localhost:8000)**

Default login: whatever admin account you've set up. All data stored locally in `data/nlf_pos.db`.

---

## Deploy Online (Cloud)

### Option A: Railway (Recommended)

Railway is the fastest way to get online — free tier available, PostgreSQL included.

#### Step 1: Push to GitHub

```bash
cd furniture-pos
git init
git add .
git commit -m "NLF POS — ready for cloud deployment"
git remote add origin https://github.com/YOUR_USERNAME/nlf-pos.git
git push -u origin main
```

#### Step 2: Deploy on Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project" → "Deploy from GitHub repo"**
3. Select your `nlf-pos` repository
4. Railway auto-detects Python and installs dependencies

#### Step 3: Add PostgreSQL Database

1. In your Railway project, click **"+ New" → "Database" → "PostgreSQL"**
2. Go to your web service → **Variables** tab
3. Add these environment variables:
   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   SECRET_KEY   = (click "Generate" — any random 32+ char string)
   PRODUCTION   = true
   ```
4. Redeploy — your app now runs on PostgreSQL!

#### Step 4: Migrate Your Local Data to Cloud

```bash
# One command — exports from local SQLite and uploads to cloud
python3 migrate_to_cloud.py migrate https://your-app.up.railway.app
```

This transfers all your inventory, sales history, customers, suppliers, and user accounts to the cloud database. **Zero data loss.**

### Option B: Render

1. Go to [render.com](https://render.com) and connect your GitHub repo
2. Click **"New → Blueprint Instance"** and select the repo (uses `render.yaml`)
3. Render auto-provisions the web service + PostgreSQL database
4. After deployment, run: `python3 migrate_to_cloud.py migrate https://your-app.onrender.com`

---

## How It Works: Local vs Cloud

| | Local (default) | Cloud |
|---|---|---|
| **Database** | SQLite file (`data/nlf_pos.db`) | PostgreSQL (managed) |
| **Detection** | No `DATABASE_URL` env var | `DATABASE_URL` is set |
| **Backups** | Auto-backup on startup (10 rotating) | Platform-managed |
| **Access** | `localhost:8000` only | Public URL (HTTPS) |
| **Users** | Single device | Multi-device, anywhere |

The app auto-detects — same codebase, zero code changes needed.

---

## Architecture (Online)

```
                  ┌─────────────────────────┐
                  │  Railway / Render Cloud  │
                  │                          │
  India (Store)   │  ┌──────────────────┐   │   US (Investor)
  ─────────────── │  │  Flask App       │   │ ─────────────────
  POS Register    │  │  (gunicorn)      │   │  Dashboard
  Inventory Mgmt  │  │                  │   │  Reports
  Sales           │  └────────┬─────────┘   │  Inventory View
                  │           │              │
                  │  ┌────────▼─────────┐   │
                  │  │  PostgreSQL DB   │   │
                  │  │  (managed)       │   │
                  │  │  Auto-backups    │   │
                  │  └──────────────────┘   │
                  └─────────────────────────┘
```

Both you (US) and the store (India) access the **same URL** — real-time data, no sync needed.

---

## Data Migration

### Export Local Data
```bash
python3 migrate_to_cloud.py export
# Creates data/export_for_cloud.json
```

### Upload to Cloud
```bash
python3 migrate_to_cloud.py upload https://your-app.railway.app
```

### Both at Once
```bash
python3 migrate_to_cloud.py migrate https://your-app.railway.app
```

---

## API Health Check

```bash
curl https://your-app.railway.app/api/health
```

Returns:
```json
{
  "status": "healthy",
  "engine": "PostgreSQL",
  "users": 3,
  "timestamp": "2026-02-08T10:30:00"
}
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Cloud only | (none — uses SQLite) | PostgreSQL connection string |
| `SECRET_KEY` | Recommended | `nlf-pos-secret-key-...` | Flask session secret |
| `PORT` | Cloud only | `8000` | Server port (set by platform) |
| `PRODUCTION` | Cloud only | (none) | Enables secure cookies, proxy trust |

---

## Project Structure

```
furniture-pos/
├── app.py                  # Flask backend (all API routes)
├── database.py             # Database layer (SQLite + PostgreSQL)
├── migrate_to_cloud.py     # Data migration tool
├── requirements.txt        # Python dependencies
├── Procfile                # gunicorn start command
├── railway.json            # Railway deployment config
├── render.yaml             # Render blueprint config
├── runtime.txt             # Python version
├── .gitignore              # Excludes local data files
├── data/
│   ├── nlf_pos.db          # Local SQLite database (not deployed)
│   └── backups/            # Auto-backups (local only)
├── static/
│   ├── css/                # Stylesheets
│   ├── js/                 # Frontend modules
│   └── img/                # Logo / images
└── templates/
    ├── index.html          # Main SPA
    └── login.html          # Login page
```

---

## License

MIT — use it however you like.
