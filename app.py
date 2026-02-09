"""
Next Level Furniture — Point of Sale System
Flask backend with SQLite (local) or PostgreSQL (cloud) database.
"""

import json
import os
import csv
import io
import uuid
import hashlib
import functools
import atexit
from datetime import datetime, date
from pathlib import Path

from flask import Flask, jsonify, request, render_template, send_from_directory, Response, session, redirect, url_for, g

from database import (
    get_db, close_db, init_db, migrate_from_json, create_backup,
    row_to_dict, rows_to_list, DB_PATH, USE_POSTGRES, export_all_data, import_all_data,
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(32).hex())

# ---------------------------------------------------------------------------
# Production config
# ---------------------------------------------------------------------------
if os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RENDER") or os.environ.get("PRODUCTION"):
    app.config["SESSION_COOKIE_SECURE"] = True
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    # Trust proxy headers from Railway/Render
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# Session lifetime — 8 hours (so store staff stays logged in during a shift)
app.config["PERMANENT_SESSION_LIFETIME"] = 8 * 60 * 60

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"


# ---------------------------------------------------------------------------
# Database lifecycle
# ---------------------------------------------------------------------------

@app.teardown_appcontext
def teardown_db(exception):
    """Close DB connection at end of each request."""
    close_db()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def db():
    """Shortcut to get the thread-local DB connection."""
    return get_db()


def generate_receipt_number():
    now = datetime.now()
    return f"INV-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def login_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    """Only allow admin role users."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            return jsonify({"error": "Unauthorized"}), 401
        if session["user"].get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@app.route("/login")
def login_page():
    if "user" in session:
        return redirect(url_for("index"))
    return render_template("login.html")


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    data = request.get_json()
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    pw_hash = hashlib.sha256(password.encode()).hexdigest()

    row = db().execute(
        "SELECT * FROM users WHERE LOWER(username) = ? AND password = ? AND active = 1",
        (username, pw_hash)
    ).fetchone()

    if not row:
        return jsonify({"error": "Invalid username or password"}), 401

    user = row_to_dict(row)
    session["user"] = {
        "id": user["id"],
        "name": user["name"],
        "username": user["username"],
        "role": user["role"],
    }
    return jsonify({"success": True, "user": session["user"]})


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    session.pop("user", None)
    return jsonify({"success": True})


@app.route("/api/auth/me", methods=["GET"])
def api_me():
    if "user" in session:
        return jsonify(session["user"])
    return jsonify({"error": "Not logged in"}), 401


# ---------------------------------------------------------------------------
# User Management API (admin only)
# ---------------------------------------------------------------------------

@app.route("/api/users", methods=["GET"])
@login_required
@admin_required
def list_users():
    rows = db().execute("SELECT id, name, username, role, phone, active, created FROM users").fetchall()
    users = rows_to_list(rows)
    # Convert SQLite integer 0/1 to boolean for frontend compatibility
    for u in users:
        u["active"] = bool(u.get("active", 1))
    return jsonify(users)


@app.route("/api/users", methods=["POST"])
@login_required
@admin_required
def create_user():
    data = request.get_json()
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    name = data.get("name") or username
    role = data.get("role", "staff")

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    # Check duplicate username
    existing = db().execute("SELECT id FROM users WHERE LOWER(username) = ?", (username,)).fetchone()
    if existing:
        return jsonify({"error": "Username already exists"}), 409

    user_id = uuid.uuid4().hex[:8]
    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    created = datetime.now().isoformat()

    db().execute(
        "INSERT INTO users (id, name, username, password, role, phone, active, created) VALUES (?,?,?,?,?,?,?,?)",
        (user_id, name, username, pw_hash, role, data.get("phone", ""), 1, created)
    )
    db().commit()

    return jsonify({
        "success": True,
        "user": {"id": user_id, "name": name, "username": username, "role": role,
                 "phone": data.get("phone", ""), "active": True, "created": created}
    }), 201


@app.route("/api/users/<user_id>", methods=["PUT"])
@login_required
@admin_required
def update_user(user_id):
    data = request.get_json()
    row = db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return jsonify({"error": "User not found"}), 404

    user = row_to_dict(row)
    name = data.get("name", user["name"])
    role = data.get("role", user["role"])
    phone = data.get("phone", user.get("phone", ""))
    active_val = data.get("active", user["active"])
    # Handle string "true"/"false" from frontend as well as bool/int
    if isinstance(active_val, str):
        active = 1 if active_val.lower() == "true" else 0
    else:
        active = 1 if active_val else 0

    if data.get("password"):
        pw_hash = hashlib.sha256(data["password"].encode()).hexdigest()
        db().execute(
            "UPDATE users SET name=?, role=?, phone=?, active=?, password=? WHERE id=?",
            (name, role, phone, active, pw_hash, user_id)
        )
    else:
        db().execute(
            "UPDATE users SET name=?, role=?, phone=?, active=? WHERE id=?",
            (name, role, phone, active, user_id)
        )
    db().commit()

    return jsonify({
        "success": True,
        "user": {"id": user_id, "name": name, "username": user["username"],
                 "role": role, "phone": phone, "active": bool(active), "created": user["created"]}
    })


@app.route("/api/users/<user_id>", methods=["DELETE"])
@login_required
@admin_required
def delete_user(user_id):
    if session.get("user", {}).get("id") == user_id:
        return jsonify({"error": "Cannot delete your own account"}), 400

    result = db().execute("DELETE FROM users WHERE id = ?", (user_id,))
    db().commit()
    if result.rowcount == 0:
        return jsonify({"error": "User not found"}), 404
    return jsonify({"success": True})


# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------

@app.route("/")
@login_required
def index():
    return render_template("index.html", user=session["user"])


# ---------------------------------------------------------------------------
# Settings API
# ---------------------------------------------------------------------------

def get_all_settings():
    """Load all settings from DB as a dict."""
    rows = db().execute("SELECT key, value FROM settings").fetchall()
    settings = {}
    for r in rows:
        val = r["value"]
        # Try to parse numeric/boolean values
        try:
            parsed = json.loads(val)
            settings[r["key"]] = parsed
        except (json.JSONDecodeError, TypeError):
            settings[r["key"]] = val
    return settings


@app.route("/api/settings", methods=["GET"])
@login_required
def get_settings():
    return jsonify(get_all_settings())


@app.route("/api/settings", methods=["PUT"])
@login_required
def update_settings():
    data = request.get_json()
    conn = db()
    for key, value in data.items():
        str_value = json.dumps(value) if not isinstance(value, str) else value
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, str_value)
        )
    conn.commit()
    return jsonify({"success": True, "data": data})


# ---------------------------------------------------------------------------
# Inventory API
# ---------------------------------------------------------------------------

@app.route("/api/inventory", methods=["GET"])
@login_required
def get_inventory():
    q = request.args.get("q", "").lower()
    category = request.args.get("category", "")
    low_stock = request.args.get("low_stock", "")

    sql = "SELECT * FROM inventory WHERE 1=1"
    params = []

    if q:
        sql += " AND (LOWER(name) LIKE ? OR LOWER(sku) LIKE ? OR LOWER(brand) LIKE ? OR LOWER(description) LIKE ?)"
        like = f"%{q}%"
        params.extend([like, like, like, like])

    if category:
        sql += " AND category = ?"
        params.append(category)

    if low_stock == "true":
        sql += " AND quantity <= reorder_level"

    sql += " ORDER BY name"
    rows = db().execute(sql, params).fetchall()
    return jsonify(rows_to_list(rows))


@app.route("/api/inventory", methods=["POST"])
@login_required
def add_product():
    product = request.get_json()
    today = date.today().isoformat()
    product["date_added"] = today
    product["last_updated"] = today

    if not product.get("sku"):
        cat_prefix = product.get("category", "GEN")[:3].upper()
        product["sku"] = f"NLF-{cat_prefix}-{uuid.uuid4().hex[:4].upper()}"

    # Check duplicate SKU
    existing = db().execute("SELECT sku FROM inventory WHERE sku = ?", (product["sku"],)).fetchone()
    if existing:
        return jsonify({"error": "SKU already exists"}), 409

    db().execute(
        """INSERT INTO inventory
        (sku, name, category, brand, description, cost_price, selling_price,
         quantity, reorder_level, dimensions, weight, color, image_path,
         supplier, date_added, last_updated)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (product["sku"], product.get("name", ""), product.get("category", ""),
         product.get("brand", ""), product.get("description", ""),
         float(product.get("cost_price", 0)), float(product.get("selling_price", 0)),
         int(product.get("quantity", 0)), int(product.get("reorder_level", 3)),
         product.get("dimensions", ""), float(product.get("weight", 0)),
         product.get("color", ""), product.get("image_path", ""),
         product.get("supplier", ""), today, today)
    )
    db().commit()
    return jsonify({"success": True, "product": product}), 201


@app.route("/api/inventory/<sku>", methods=["GET"])
@login_required
def get_product(sku):
    row = db().execute("SELECT * FROM inventory WHERE sku = ?", (sku,)).fetchone()
    if not row:
        return jsonify({"error": "Product not found"}), 404
    return jsonify(row_to_dict(row))


@app.route("/api/inventory/<sku>", methods=["PUT"])
@login_required
def update_product(sku):
    row = db().execute("SELECT * FROM inventory WHERE sku = ?", (sku,)).fetchone()
    if not row:
        return jsonify({"error": "Product not found"}), 404

    data = request.get_json()
    today = date.today().isoformat()
    original = row_to_dict(row)

    db().execute(
        """UPDATE inventory SET
        name=?, category=?, brand=?, description=?, cost_price=?, selling_price=?,
        quantity=?, reorder_level=?, dimensions=?, weight=?, color=?, image_path=?,
        supplier=?, last_updated=?
        WHERE sku=?""",
        (data.get("name", original["name"]),
         data.get("category", original["category"]),
         data.get("brand", original["brand"]),
         data.get("description", original["description"]),
         float(data.get("cost_price", original["cost_price"])),
         float(data.get("selling_price", original["selling_price"])),
         int(data.get("quantity", original["quantity"])),
         int(data.get("reorder_level", original["reorder_level"])),
         data.get("dimensions", original["dimensions"]),
         float(data.get("weight", original["weight"])),
         data.get("color", original["color"]),
         data.get("image_path", original["image_path"]),
         data.get("supplier", original["supplier"]),
         today, sku)
    )
    db().commit()

    updated = db().execute("SELECT * FROM inventory WHERE sku = ?", (sku,)).fetchone()
    return jsonify({"success": True, "product": row_to_dict(updated)})


@app.route("/api/inventory/<sku>", methods=["DELETE"])
@login_required
def delete_product(sku):
    result = db().execute("DELETE FROM inventory WHERE sku = ?", (sku,))
    db().commit()
    if result.rowcount == 0:
        return jsonify({"error": "Product not found"}), 404
    return jsonify({"success": True})


@app.route("/api/inventory/export", methods=["GET"])
@login_required
def export_inventory_csv():
    rows = db().execute("SELECT * FROM inventory ORDER BY name").fetchall()
    if not rows:
        return Response("No data", mimetype="text/plain")

    inventory = rows_to_list(rows)
    output = io.StringIO()
    fieldnames = list(inventory[0].keys())
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(inventory)

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=inventory.csv"},
    )


@app.route("/api/inventory/import", methods=["POST"])
@login_required
def import_inventory_csv():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    stream = io.StringIO(file.stream.read().decode("utf-8"))
    reader = csv.DictReader(stream)

    conn = db()
    added = 0
    today = date.today().isoformat()

    for row in reader:
        # Coerce numeric fields
        for field in ["cost_price", "selling_price", "weight"]:
            if field in row:
                try:
                    row[field] = float(row[field])
                except (ValueError, TypeError):
                    row[field] = 0
        for field in ["quantity", "reorder_level"]:
            if field in row:
                try:
                    row[field] = int(row[field])
                except (ValueError, TypeError):
                    row[field] = 0

        sku = row.get("sku", "").strip()
        if not sku:
            continue

        # Check if SKU already exists
        existing = conn.execute("SELECT sku FROM inventory WHERE sku = ?", (sku,)).fetchone()
        if existing:
            continue

        try:
            conn.execute(
                """INSERT INTO inventory
                (sku, name, category, brand, description, cost_price, selling_price,
                 quantity, reorder_level, dimensions, weight, color, image_path,
                 supplier, date_added, last_updated)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (sku, row.get("name", ""), row.get("category", ""),
                 row.get("brand", ""), row.get("description", ""),
                 float(row.get("cost_price", 0)),
                 float(row.get("selling_price", 0)),
                 int(row.get("quantity", 0)),
                 int(row.get("reorder_level", 3)),
                 row.get("dimensions", ""),
                 float(row.get("weight", 0)),
                 row.get("color", ""), row.get("image_path", ""),
                 row.get("supplier", ""),
                 row.get("date_added", today), today)
            )
            added += 1
        except Exception:
            continue

    conn.commit()
    return jsonify({"success": True, "added": added})


@app.route("/api/inventory/categories", methods=["GET"])
@login_required
def get_categories():
    rows = db().execute(
        "SELECT DISTINCT category FROM inventory WHERE category != '' ORDER BY category"
    ).fetchall()
    return jsonify([r["category"] for r in rows])


# ---------------------------------------------------------------------------
# Sales / Transactions API
# ---------------------------------------------------------------------------

@app.route("/api/sales", methods=["GET"])
@login_required
def get_sales():
    sql = "SELECT * FROM sales WHERE 1=1"
    params = []

    start = request.args.get("start")
    end = request.args.get("end")
    method = request.args.get("method")
    cashier = request.args.get("cashier")

    if start:
        sql += " AND date >= ?"
        params.append(start)
    if end:
        sql += " AND date <= ?"
        params.append(end)
    if method:
        sql += " AND LOWER(payment_method) = ?"
        params.append(method.lower())
    if cashier:
        sql += " AND LOWER(cashier) LIKE ?"
        params.append(f"%{cashier.lower()}%")

    sql += " ORDER BY timestamp DESC"
    sales_rows = db().execute(sql, params).fetchall()

    # Build response with nested items (matching original JSON format)
    result = []
    for s in sales_rows:
        sale = row_to_dict(s)
        items = db().execute(
            "SELECT * FROM sale_items WHERE sale_id = ?", (sale["id"],)
        ).fetchall()
        sale["items"] = rows_to_list(items)
        # Remove internal sale_id from items
        for item in sale["items"]:
            item.pop("id", None)
            item.pop("sale_id", None)
        result.append(sale)

    return jsonify(result)


@app.route("/api/sales", methods=["POST"])
@login_required
def create_sale():
    sale = request.get_json()
    conn = db()

    # ---- STOCK VALIDATION ----
    # Check that we have enough stock for every item BEFORE proceeding
    stock_errors = []
    for line in sale.get("items", []):
        sku = line.get("sku")
        qty = line.get("quantity", 1)
        if not sku:
            continue
        row = conn.execute("SELECT name, quantity FROM inventory WHERE sku = ?", (sku,)).fetchone()
        if not row:
            stock_errors.append(f"Product {sku} not found in inventory")
        elif row["quantity"] < qty:
            stock_errors.append(
                f"{row['name']} — only {row['quantity']} in stock, requested {qty}"
            )

    if stock_errors:
        return jsonify({
            "error": "Insufficient stock",
            "details": stock_errors
        }), 400

    # ---- GENERATE RECEIPT ----
    receipt_number = generate_receipt_number()
    timestamp = datetime.now().isoformat()
    sale_date = date.today().isoformat()

    # ---- INSERT SALE ----
    cursor = conn.execute(
        """INSERT INTO sales
        (receipt_number, timestamp, date, subtotal, discount_amount,
         tax_amount, grand_total, payment_method, cashier,
         customer_name, customer_phone, customer_email)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (receipt_number, timestamp, sale_date,
         float(sale.get("subtotal", 0)),
         float(sale.get("discount_amount", 0)),
         float(sale.get("tax_amount", 0)),
         float(sale.get("grand_total", 0)),
         sale.get("payment_method", ""),
         sale.get("cashier", ""),
         sale.get("customer_name", ""),
         sale.get("customer_phone", ""),
         sale.get("customer_email", ""))
    )
    sale_id = cursor.lastrowid

    # ---- INSERT ITEMS + DECREMENT STOCK ----
    today = date.today().isoformat()
    for line in sale.get("items", []):
        sku = line.get("sku")
        qty = line.get("quantity", 1)

        conn.execute(
            """INSERT INTO sale_items
            (sale_id, sku, name, quantity, unit_price, line_total,
             discount_type, discount_value, discount_amount, final_total)
            VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (sale_id, sku, line.get("name", ""),
             qty, float(line.get("unit_price", 0)),
             float(line.get("line_total", 0)),
             line.get("discount_type", "none"),
             float(line.get("discount_value", 0)),
             float(line.get("discount_amount", 0)),
             float(line.get("final_total", line.get("line_total", 0))))
        )

        # Atomic stock decrement
        if sku:
            conn.execute(
                "UPDATE inventory SET quantity = MAX(0, quantity - ?), last_updated = ? WHERE sku = ?",
                (qty, today, sku)
            )

    # ---- AUTO-CREATE CUSTOMER ----
    cust_phone = sale.get("customer_phone", "").strip()
    cust_name = sale.get("customer_name", "").strip()
    cust_email = sale.get("customer_email", "").strip()
    if cust_phone:
        existing_cust = conn.execute(
            "SELECT id FROM customers WHERE phone = ?", (cust_phone,)
        ).fetchone()
        if existing_cust:
            # Update name/email if they were empty before
            conn.execute(
                "UPDATE customers SET name = CASE WHEN name = '' THEN ? ELSE name END, "
                "email = CASE WHEN email = '' THEN ? ELSE email END, "
                "last_updated = ? WHERE phone = ?",
                (cust_name, cust_email, datetime.now().isoformat(), cust_phone)
            )
        else:
            now_str = datetime.now().isoformat()
            conn.execute(
                "INSERT INTO customers (phone, name, email, created, last_updated) VALUES (?, ?, ?, ?, ?)",
                (cust_phone, cust_name, cust_email, now_str, now_str)
            )

    conn.commit()

    # Build response matching original format
    sale_response = {
        "receipt_number": receipt_number,
        "timestamp": timestamp,
        "date": sale_date,
        "subtotal": sale.get("subtotal", 0),
        "discount_amount": sale.get("discount_amount", 0),
        "tax_amount": sale.get("tax_amount", 0),
        "grand_total": sale.get("grand_total", 0),
        "payment_method": sale.get("payment_method", ""),
        "cashier": sale.get("cashier", ""),
        "customer_name": sale.get("customer_name", ""),
        "customer_phone": sale.get("customer_phone", ""),
        "customer_email": sale.get("customer_email", ""),
        "items": sale.get("items", []),
    }

    return jsonify({"success": True, "sale": sale_response}), 201


@app.route("/api/sales/<receipt_number>", methods=["GET"])
@login_required
def get_sale(receipt_number):
    row = db().execute("SELECT * FROM sales WHERE receipt_number = ?", (receipt_number,)).fetchone()
    if not row:
        return jsonify({"error": "Sale not found"}), 404

    sale = row_to_dict(row)
    items = db().execute("SELECT * FROM sale_items WHERE sale_id = ?", (sale["id"],)).fetchall()
    sale["items"] = rows_to_list(items)
    for item in sale["items"]:
        item.pop("id", None)
        item.pop("sale_id", None)

    return jsonify(sale)


@app.route("/api/sales/<receipt_number>/void", methods=["POST"])
@login_required
def void_sale(receipt_number):
    """Void a sale: mark as Voided and restore inventory quantities."""
    # Only admin or manager can void sales
    user_role = session.get("user", {}).get("role", "staff")
    if user_role not in ("admin", "manager"):
        return jsonify({"error": "Only admin or manager can void sales"}), 403

    conn = db()
    data = request.get_json() or {}
    reason = data.get("reason", "").strip()

    # Find the sale
    row = conn.execute("SELECT * FROM sales WHERE receipt_number = ?", (receipt_number,)).fetchone()
    if not row:
        return jsonify({"error": "Sale not found"}), 404

    sale = row_to_dict(row)
    if sale.get("status") == "Voided":
        return jsonify({"error": "Sale is already voided"}), 400

    # Get sale items to restore stock
    items = conn.execute("SELECT sku, quantity FROM sale_items WHERE sale_id = ?", (sale["id"],)).fetchall()

    # Restore inventory quantities
    today = date.today().isoformat()
    for item in items:
        if item["sku"]:
            conn.execute(
                "UPDATE inventory SET quantity = quantity + ?, last_updated = ? WHERE sku = ?",
                (item["quantity"], today, item["sku"])
            )

    # Mark sale as voided
    voided_by = session.get("user", {}).get("name", "Unknown")
    conn.execute(
        "UPDATE sales SET status = 'Voided', voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?",
        (datetime.now().isoformat(), voided_by, reason, sale["id"])
    )
    conn.commit()

    return jsonify({
        "success": True,
        "message": f"Sale {receipt_number} voided. {len(items)} item(s) restored to inventory.",
        "receipt_number": receipt_number,
    })


@app.route("/api/sales/dashboard", methods=["GET"])
@login_required
def sales_dashboard():
    conn = db()
    settings = get_all_settings()
    today_str = date.today().isoformat()
    now = datetime.now()

    # Today (exclude voided)
    row = conn.execute(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(grand_total), 0) as total FROM sales WHERE date = ? AND status != 'Voided'",
        (today_str,)
    ).fetchone()
    today_count = row["cnt"]
    today_total = row["total"]

    # This week (Mon-Sun, exclude voided)
    import datetime as dt_mod
    week_start = (now - dt_mod.timedelta(days=now.weekday())).strftime("%Y-%m-%d")
    row = conn.execute(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(grand_total), 0) as total FROM sales WHERE date >= ? AND status != 'Voided'",
        (week_start,)
    ).fetchone()
    week_count = row["cnt"]
    week_total = row["total"]

    # This month (exclude voided)
    month_start = now.strftime("%Y-%m-01")
    row = conn.execute(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(grand_total), 0) as total FROM sales WHERE date >= ? AND status != 'Voided'",
        (month_start,)
    ).fetchone()
    month_count = row["cnt"]
    month_total = row["total"]

    # Top selling products (all time, exclude voided)
    top_rows = conn.execute(
        """SELECT si.name, SUM(si.quantity) as qty_sold, SUM(si.final_total) as revenue
           FROM sale_items si
           JOIN sales s ON si.sale_id = s.id
           WHERE s.status != 'Voided'
           GROUP BY si.sku, si.name
           ORDER BY qty_sold DESC
           LIMIT 5"""
    ).fetchall()
    top_products = [{"name": r["name"], "qty_sold": r["qty_sold"], "revenue": round(r["revenue"], 2)} for r in top_rows]

    # Low stock
    threshold = settings.get("low_stock_threshold", 3)
    low_rows = conn.execute(
        "SELECT * FROM inventory WHERE quantity <= reorder_level"
    ).fetchall()
    low_stock_items = rows_to_list(low_rows)
    total_inventory = conn.execute("SELECT COUNT(*) as cnt FROM inventory").fetchone()["cnt"]

    # Revenue & Cost (exclude voided)
    total_revenue_row = conn.execute("SELECT COALESCE(SUM(grand_total), 0) as total FROM sales WHERE status != 'Voided'").fetchone()
    total_revenue = total_revenue_row["total"]

    # Calculate cost from sale_items joined with inventory cost_price (exclude voided)
    cost_row = conn.execute(
        """SELECT COALESCE(SUM(si.quantity * COALESCE(inv.cost_price, 0)), 0) as total_cost
           FROM sale_items si
           JOIN sales s ON si.sale_id = s.id
           LEFT JOIN inventory inv ON si.sku = inv.sku
           WHERE s.status != 'Voided'"""
    ).fetchone()
    total_cost = cost_row["total_cost"]

    return jsonify({
        "today_total": round(today_total, 2),
        "today_count": today_count,
        "week_total": round(week_total, 2),
        "week_count": week_count,
        "month_total": round(month_total, 2),
        "month_count": month_count,
        "top_products": top_products,
        "low_stock_count": len(low_stock_items),
        "low_stock_pct": round(len(low_stock_items) / max(total_inventory, 1) * 100, 1),
        "low_stock_items": [
            {"sku": i["sku"], "name": i["name"], "quantity": i["quantity"],
             "reorder_level": i.get("reorder_level", threshold)}
            for i in low_stock_items
        ],
        "total_revenue": round(total_revenue, 2),
        "total_cost": round(total_cost, 2),
        "total_profit": round(total_revenue - total_cost, 2),
    })


@app.route("/api/sales/export", methods=["GET"])
@login_required
def export_sales_csv():
    conn = db()
    sales_rows = conn.execute("SELECT * FROM sales ORDER BY timestamp DESC").fetchall()
    if not sales_rows:
        return Response("No data", mimetype="text/plain")

    output = io.StringIO()
    fieldnames = [
        "receipt_number", "date", "timestamp", "cashier",
        "subtotal", "discount_amount", "tax_amount", "grand_total",
        "payment_method", "customer_name", "customer_phone", "items_summary"
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()

    for s in sales_rows:
        sale = row_to_dict(s)
        items = conn.execute("SELECT name, quantity FROM sale_items WHERE sale_id = ?", (sale["id"],)).fetchall()
        items_str = "; ".join(f"{i['name']} x{i['quantity']}" for i in items)

        writer.writerow({
            "receipt_number": sale.get("receipt_number", ""),
            "date": sale.get("date", ""),
            "timestamp": sale.get("timestamp", ""),
            "cashier": sale.get("cashier", ""),
            "subtotal": sale.get("subtotal", 0),
            "discount_amount": sale.get("discount_amount", 0),
            "tax_amount": sale.get("tax_amount", 0),
            "grand_total": sale.get("grand_total", 0),
            "payment_method": sale.get("payment_method", ""),
            "customer_name": sale.get("customer_name", ""),
            "customer_phone": sale.get("customer_phone", ""),
            "items_summary": items_str,
        })

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=sales.csv"},
    )


# ---------------------------------------------------------------------------
# Held Transactions API — now persistent in SQLite!
# ---------------------------------------------------------------------------

@app.route("/api/held", methods=["GET"])
@login_required
def get_held():
    rows = db().execute("SELECT * FROM held_transactions ORDER BY held_at DESC").fetchall()
    result = []
    for r in rows:
        data = json.loads(r["data"])
        data["hold_id"] = r["hold_id"]
        data["held_at"] = r["held_at"]
        result.append(data)
    return jsonify(result)


@app.route("/api/held", methods=["POST"])
@login_required
def hold_transaction():
    data = request.get_json()
    hold_id = uuid.uuid4().hex[:8]
    held_at = datetime.now().isoformat()

    db().execute(
        "INSERT INTO held_transactions (hold_id, data, held_at) VALUES (?, ?, ?)",
        (hold_id, json.dumps(data), held_at)
    )
    db().commit()
    return jsonify({"success": True, "hold_id": hold_id}), 201


@app.route("/api/held/<hold_id>", methods=["DELETE"])
@login_required
def remove_held(hold_id):
    db().execute("DELETE FROM held_transactions WHERE hold_id = ?", (hold_id,))
    db().commit()
    return jsonify({"success": True})


# ---------------------------------------------------------------------------
# Suppliers API
# ---------------------------------------------------------------------------

@app.route("/api/suppliers", methods=["GET"])
@login_required
def list_suppliers():
    conn = db()
    rows = conn.execute("SELECT * FROM suppliers ORDER BY name").fetchall()
    suppliers = rows_to_list(rows)

    # Count inventory items per supplier
    for s in suppliers:
        count = conn.execute(
            "SELECT COUNT(*) as cnt FROM inventory WHERE LOWER(supplier) = LOWER(?)",
            (s["name"],)
        ).fetchone()["cnt"]
        s["item_count"] = count

    return jsonify(suppliers)


@app.route("/api/suppliers", methods=["POST"])
@login_required
@admin_required
def create_supplier():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Supplier name is required"}), 400

    conn = db()
    now = datetime.now().isoformat()

    try:
        conn.execute(
            """INSERT INTO suppliers (name, contact_person, phone, email, address, notes, created, last_updated)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (name, data.get("contact_person", ""), data.get("phone", ""),
             data.get("email", ""), data.get("address", ""), data.get("notes", ""),
             now, now)
        )
        conn.commit()
        return jsonify({"success": True, "message": f"Supplier '{name}' created"})
    except Exception as e:
        if "UNIQUE" in str(e):
            return jsonify({"error": f"Supplier '{name}' already exists"}), 400
        return jsonify({"error": str(e)}), 500


@app.route("/api/suppliers/<int:supplier_id>", methods=["PUT"])
@login_required
@admin_required
def update_supplier(supplier_id):
    data = request.get_json() or {}
    conn = db()

    row = conn.execute("SELECT * FROM suppliers WHERE id = ?", (supplier_id,)).fetchone()
    if not row:
        return jsonify({"error": "Supplier not found"}), 404

    name = data.get("name", row["name"]).strip()
    now = datetime.now().isoformat()

    try:
        conn.execute(
            """UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?,
               address = ?, notes = ?, last_updated = ? WHERE id = ?""",
            (name, data.get("contact_person", row["contact_person"]),
             data.get("phone", row["phone"]),
             data.get("email", row["email"]),
             data.get("address", row["address"]),
             data.get("notes", row["notes"]),
             now, supplier_id)
        )
        conn.commit()
        return jsonify({"success": True, "message": f"Supplier '{name}' updated"})
    except Exception as e:
        if "UNIQUE" in str(e):
            return jsonify({"error": f"Supplier '{name}' already exists"}), 400
        return jsonify({"error": str(e)}), 500


@app.route("/api/suppliers/<int:supplier_id>", methods=["DELETE"])
@login_required
@admin_required
def delete_supplier(supplier_id):
    conn = db()
    row = conn.execute("SELECT * FROM suppliers WHERE id = ?", (supplier_id,)).fetchone()
    if not row:
        return jsonify({"error": "Supplier not found"}), 404

    conn.execute("DELETE FROM suppliers WHERE id = ?", (supplier_id,))
    conn.commit()
    return jsonify({"success": True, "message": f"Supplier '{row['name']}' deleted"})


# ---------------------------------------------------------------------------
# Customers API
# ---------------------------------------------------------------------------

@app.route("/api/customers", methods=["GET"])
@login_required
def list_customers():
    conn = db()
    rows = conn.execute("SELECT * FROM customers ORDER BY name").fetchall()
    customers = rows_to_list(rows)

    # Count sales per customer (by phone, exclude voided)
    for c in customers:
        stats = conn.execute(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(grand_total), 0) as total "
            "FROM sales WHERE customer_phone = ? AND status != 'Voided'",
            (c["phone"],)
        ).fetchone()
        c["order_count"] = stats["cnt"]
        c["total_spent"] = round(stats["total"], 2)

    return jsonify(customers)


@app.route("/api/customers", methods=["POST"])
@login_required
def create_customer():
    data = request.get_json() or {}
    phone = data.get("phone", "").strip()
    if not phone:
        return jsonify({"error": "Phone number is required"}), 400

    conn = db()
    now = datetime.now().isoformat()

    try:
        conn.execute(
            """INSERT INTO customers (phone, name, email, address, notes, created, last_updated)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (phone, data.get("name", "").strip(), data.get("email", "").strip(),
             data.get("address", "").strip(), data.get("notes", "").strip(),
             now, now)
        )
        conn.commit()
        return jsonify({"success": True, "message": f"Customer '{phone}' created"})
    except Exception as e:
        if "UNIQUE" in str(e):
            return jsonify({"error": f"Customer with phone '{phone}' already exists"}), 400
        return jsonify({"error": str(e)}), 500


@app.route("/api/customers/<int:customer_id>", methods=["PUT"])
@login_required
def update_customer(customer_id):
    data = request.get_json() or {}
    conn = db()

    row = conn.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
    if not row:
        return jsonify({"error": "Customer not found"}), 404

    now = datetime.now().isoformat()
    phone = data.get("phone", row["phone"]).strip()

    try:
        conn.execute(
            """UPDATE customers SET phone = ?, name = ?, email = ?,
               address = ?, notes = ?, last_updated = ? WHERE id = ?""",
            (phone, data.get("name", row["name"]).strip(),
             data.get("email", row["email"]).strip(),
             data.get("address", row["address"]).strip(),
             data.get("notes", row["notes"]).strip(),
             now, customer_id)
        )
        conn.commit()

        # Also update customer name/email on future lookups in sales
        # (existing sales keep their original data)
        return jsonify({"success": True, "message": f"Customer updated"})
    except Exception as e:
        if "UNIQUE" in str(e):
            return jsonify({"error": f"Phone '{phone}' already belongs to another customer"}), 400
        return jsonify({"error": str(e)}), 500


@app.route("/api/customers/<int:customer_id>", methods=["DELETE"])
@login_required
@admin_required
def delete_customer(customer_id):
    conn = db()
    row = conn.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
    if not row:
        return jsonify({"error": "Customer not found"}), 404

    conn.execute("DELETE FROM customers WHERE id = ?", (customer_id,))
    conn.commit()
    return jsonify({"success": True, "message": f"Customer '{row['name'] or row['phone']}' deleted"})


# ---------------------------------------------------------------------------
# Backup API
# ---------------------------------------------------------------------------

@app.route("/api/backup", methods=["POST"])
@login_required
@admin_required
def trigger_backup():
    path = create_backup()
    if path:
        return jsonify({"success": True, "path": path})
    if USE_POSTGRES:
        return jsonify({"success": True, "message": "PostgreSQL uses platform-managed backups"})
    return jsonify({"error": "Backup failed"}), 500


# ---------------------------------------------------------------------------
# Data Migration API (export local → import cloud)
# ---------------------------------------------------------------------------

@app.route("/api/data/export", methods=["GET"])
@login_required
@admin_required
def api_export_data():
    """Export all data as JSON (for migrating local SQLite → cloud PostgreSQL)."""
    try:
        data = export_all_data()
        return jsonify({
            "success": True,
            "data": data,
            "summary": {
                "users": len(data.get("users", [])),
                "settings": len(data.get("settings", {})),
                "inventory": len(data.get("inventory", [])),
                "suppliers": len(data.get("suppliers", [])),
                "customers": len(data.get("customers", [])),
                "sales": len(data.get("sales", [])),
            }
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/data/import", methods=["POST"])
def api_import_data():
    """Import JSON data into current database (used to seed cloud PostgreSQL).
    Allows unauthenticated access only if the database has zero users (first-time setup).
    """
    # Check if this is first-time setup (empty database)
    user_count = db().execute("SELECT COUNT(*) as cnt FROM users").fetchone()["cnt"]

    if user_count > 0:
        # Database already has users — require admin auth
        if "user" not in session:
            return jsonify({"error": "Unauthorized — database already has users. Login as admin first."}), 401
        if session["user"].get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403

    data = request.get_json()
    if not data or "data" not in data:
        return jsonify({"error": "No data provided. Send {data: {...}}"}), 400

    try:
        imported = import_all_data(data["data"])
        return jsonify({"success": True, "imported": imported})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/health", methods=["GET"])
def health_check():
    """Health check endpoint for monitoring and platform health checks."""
    engine = "PostgreSQL" if USE_POSTGRES else "SQLite"
    try:
        conn = get_db()
        user_count = conn.execute("SELECT COUNT(*) as cnt FROM users").fetchone()["cnt"]
        return jsonify({
            "status": "healthy",
            "engine": engine,
            "users": user_count,
            "timestamp": datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({"status": "unhealthy", "engine": engine, "error": str(e)}), 500


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

# Initialize database on import (for gunicorn)
init_db()
migrate_from_json()

if __name__ == "__main__":
    if not USE_POSTGRES:
        DATA_DIR.mkdir(exist_ok=True)
        if DB_PATH.exists():
            create_backup()
            print(f"[DB] Database: {DB_PATH}")
            print(f"[DB] Size: {DB_PATH.stat().st_size / 1024:.1f} KB")

    port = int(os.environ.get("PORT", 8000))
    debug = not (os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RENDER") or os.environ.get("PRODUCTION"))
    app.run(debug=debug, host="0.0.0.0", port=port)
