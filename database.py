"""
database.py — Database layer for NLF POS
Supports both SQLite (local/offline) and PostgreSQL (cloud/online).
Auto-detects based on DATABASE_URL environment variable.

When DATABASE_URL is set and starts with "postgres", uses PostgreSQL.
Otherwise, falls back to local SQLite file.
"""

import json
import os
import random
import re
import sqlite3
import threading
from datetime import datetime, date
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "nlf_pos.db"
BACKUP_DIR = DATA_DIR / "backups"

# ---------------------------------------------------------------------------
# Engine detection
# ---------------------------------------------------------------------------

DATABASE_URL = os.environ.get("DATABASE_URL", "")
USE_POSTGRES = DATABASE_URL.startswith("postgres")

if USE_POSTGRES:
    import psycopg2
    import psycopg2.extras

# Thread-local storage for connections
_local = threading.local()


# ---------------------------------------------------------------------------
# PostgreSQL wrapper — makes psycopg2 behave like sqlite3 for app.py
# ---------------------------------------------------------------------------

class PgCursorWrapper:
    """Wraps a psycopg2 RealDictCursor to behave like sqlite3.Cursor."""

    def __init__(self, real_cursor):
        self._cur = real_cursor
        self._lastrowid = None

    @property
    def lastrowid(self):
        return self._lastrowid

    @property
    def rowcount(self):
        return self._cur.rowcount

    @property
    def description(self):
        return self._cur.description

    def fetchone(self):
        row = self._cur.fetchone()
        if row is None:
            return None
        return DictRow(row)

    def fetchall(self):
        rows = self._cur.fetchall()
        return [DictRow(r) for r in rows]

    def __iter__(self):
        return iter(self.fetchall())


class DictRow(dict):
    """A dict that also supports integer index access like sqlite3.Row."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class PgConnectionWrapper:
    """
    Wraps a psycopg2 connection to behave like sqlite3 connection.
    Translates: ? → %s, INSERT OR REPLACE, INSERT OR IGNORE, PRAGMA, etc.
    """

    def __init__(self, real_conn):
        self._conn = real_conn

    def _translate_sql(self, sql):
        """Convert SQLite SQL dialect to PostgreSQL."""
        # Skip PRAGMA statements
        if sql.strip().upper().startswith("PRAGMA"):
            return None

        # ? → %s (but not inside strings)
        sql = sql.replace("?", "%s")

        # INSERT OR REPLACE INTO ... → INSERT INTO ... ON CONFLICT ... DO UPDATE
        m = re.match(
            r"INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)",
            sql, re.IGNORECASE | re.DOTALL
        )
        if m:
            table = m.group(1)
            cols = m.group(2)
            vals = m.group(3)
            first_col = cols.split(",")[0].strip()
            # Build ON CONFLICT DO UPDATE for all columns except the primary key
            col_list = [c.strip() for c in cols.split(",")]
            updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in col_list if c != first_col)
            sql = f"INSERT INTO {table} ({cols}) VALUES ({vals}) ON CONFLICT ({first_col}) DO UPDATE SET {updates}"

        # INSERT OR IGNORE INTO ... → INSERT INTO ... ON CONFLICT DO NOTHING
        sql = re.sub(
            r"INSERT\s+OR\s+IGNORE\s+INTO",
            "INSERT INTO",
            sql, flags=re.IGNORECASE
        )
        if "INSERT INTO" in sql.upper() and "ON CONFLICT" not in sql.upper() and "DO NOTHING" not in sql.upper():
            # Check if original had OR IGNORE
            pass
        # For INSERT OR IGNORE, we add ON CONFLICT DO NOTHING before VALUES or at end
        # Actually the regex above removed OR IGNORE but didn't add ON CONFLICT.
        # Let me handle this differently with a flag

        # SQLite scalar MAX(a, b) → PostgreSQL GREATEST(a, b)
        # Only replace when MAX has two arguments (scalar), not single-arg aggregate
        sql = re.sub(r'\bMAX\s*\(([^,)]+),', r'GREATEST(\1,', sql, flags=re.IGNORECASE)

        return sql

    # Tables with SERIAL id columns (for RETURNING id)
    # Only tables where id is auto-generated — NOT inventory (sku PK), users (text PK), settings (key PK)
    _SERIAL_TABLES = {"suppliers", "customers", "sales", "sale_items", "inventory_log", "purchases", "purchase_orders", "purchase_order_items"}

    def execute(self, sql, params=None):
        """Execute SQL with automatic dialect translation."""
        original_sql = sql

        # Handle INSERT OR IGNORE specifically
        is_ignore = bool(re.search(r"INSERT\s+OR\s+IGNORE", sql, re.IGNORECASE))

        translated = self._translate_sql(sql)
        if translated is None:
            # PRAGMA or other no-op for PostgreSQL
            return PgCursorWrapper(self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor))

        sql = translated

        # For INSERT OR IGNORE, append ON CONFLICT DO NOTHING
        if is_ignore and "ON CONFLICT" not in sql.upper():
            sql = sql.rstrip().rstrip(";") + " ON CONFLICT DO NOTHING"

        # Handle RETURNING id for INSERT statements to support lastrowid
        # Only add RETURNING id for tables with SERIAL id columns
        needs_lastrowid = False
        if sql.strip().upper().startswith("INSERT") and "RETURNING" not in sql.upper():
            # Extract table name from INSERT INTO <table>
            table_match = re.search(r"INSERT\s+INTO\s+(\w+)", sql, re.IGNORECASE)
            table_name = table_match.group(1).lower() if table_match else ""
            if table_name in self._SERIAL_TABLES:
                needs_lastrowid = True
                sql = sql.rstrip().rstrip(";") + " RETURNING id"

        try:
            cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            if params:
                cur.execute(sql, params)
            else:
                cur.execute(sql)

            wrapper = PgCursorWrapper(cur)

            if needs_lastrowid:
                try:
                    row = cur.fetchone()
                    if row:
                        wrapper._lastrowid = row.get("id")
                except Exception:
                    pass

            return wrapper

        except Exception as e:
            # Use savepoint rollback (not full transaction rollback) to preserve prior inserts
            try:
                self._conn.rollback()
            except Exception:
                pass
            raise

    def executescript(self, sql):
        """Execute multiple SQL statements."""
        cur = self._conn.cursor()
        cur.execute(sql)
        return cur

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    def cursor(self):
        return PgCursorWrapper(self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor))


# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------

def get_db():
    """Get a thread-local database connection."""
    if not hasattr(_local, "conn") or _local.conn is None:
        if USE_POSTGRES:
            url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
            raw_conn = psycopg2.connect(url)
            raw_conn.autocommit = False
            _local.conn = PgConnectionWrapper(raw_conn)
        else:
            DATA_DIR.mkdir(exist_ok=True)
            _local.conn = sqlite3.connect(str(DB_PATH), timeout=10)
            _local.conn.row_factory = sqlite3.Row
            _local.conn.execute("PRAGMA journal_mode=WAL")
            _local.conn.execute("PRAGMA foreign_keys=ON")
            _local.conn.execute("PRAGMA busy_timeout=5000")
    return _local.conn


def close_db():
    """Close the thread-local connection."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
        _local.conn = None


def row_to_dict(row):
    """Convert a database row to a plain dict."""
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows):
    """Convert a list of database rows to a list of dicts."""
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    phone TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    contact_person TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created TEXT NOT NULL,
    last_updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT '',
    phone TEXT NOT NULL UNIQUE,
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created TEXT NOT NULL,
    last_updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
    sku TEXT PRIMARY KEY,
    barcode TEXT DEFAULT '',
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    brand TEXT DEFAULT '',
    description TEXT DEFAULT '',
    cost_price REAL DEFAULT 0,
    selling_price REAL DEFAULT 0,
    quantity INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 3,
    dimensions TEXT DEFAULT '',
    weight REAL DEFAULT 0,
    color TEXT DEFAULT '',
    image_path TEXT DEFAULT '',
    supplier TEXT DEFAULT '',
    date_added TEXT NOT NULL,
    last_updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_number TEXT UNIQUE NOT NULL,
    timestamp TEXT NOT NULL,
    date TEXT NOT NULL,
    subtotal REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    grand_total REAL DEFAULT 0,
    payment_method TEXT DEFAULT '',
    cashier TEXT DEFAULT '',
    customer_name TEXT DEFAULT '',
    customer_phone TEXT DEFAULT '',
    customer_email TEXT DEFAULT '',
    status TEXT DEFAULT 'Complete',
    voided_at TEXT DEFAULT '',
    voided_by TEXT DEFAULT '',
    void_reason TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price REAL DEFAULT 0,
    line_total REAL DEFAULT 0,
    discount_type TEXT DEFAULT 'none',
    discount_value REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    final_total REAL DEFAULT 0,
    FOREIGN KEY (sale_id) REFERENCES sales(id)
);

CREATE TABLE IF NOT EXISTS held_transactions (
    hold_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    held_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT DEFAULT '',
    old_value TEXT DEFAULT '',
    new_value TEXT DEFAULT '',
    qty_change REAL DEFAULT 0,
    created TEXT NOT NULL,
    FOREIGN KEY (sku) REFERENCES inventory(sku)
);

CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL,
    date TEXT NOT NULL,
    supplier TEXT DEFAULT '',
    quantity INTEGER DEFAULT 0,
    cost_price REAL DEFAULT 0,
    selling_price REAL DEFAULT 0,
    total_cost REAL DEFAULT 0,
    invoice_number TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created TEXT NOT NULL,
    FOREIGN KEY (sku) REFERENCES inventory(sku)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    invoice_number TEXT DEFAULT '',
    supplier_id INTEGER NOT NULL,
    supplier_name TEXT DEFAULT '',
    order_date TEXT NOT NULL,
    expected_date TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    notes TEXT DEFAULT '',
    total_amount REAL DEFAULT 0,
    received_date TEXT DEFAULT '',
    received_by TEXT DEFAULT '',
    receive_notes TEXT DEFAULT '',
    created TEXT NOT NULL,
    last_updated TEXT NOT NULL,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    product_name TEXT DEFAULT '',
    quantity INTEGER DEFAULT 0,
    received_qty INTEGER DEFAULT 0,
    cost_price REAL DEFAULT 0,
    line_total REAL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES purchase_orders(id),
    FOREIGN KEY (sku) REFERENCES inventory(sku)
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_receipt ON sales(receipt_number);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory(category);
CREATE INDEX IF NOT EXISTS idx_inventory_quantity ON inventory(quantity);
CREATE INDEX IF NOT EXISTS idx_inventory_log_sku ON inventory_log(sku);
CREATE INDEX IF NOT EXISTS idx_purchases_sku ON purchases(sku);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_poi_order ON purchase_order_items(order_id);
"""

PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    phone TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    contact_person TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created TEXT NOT NULL,
    last_updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name TEXT DEFAULT '',
    phone TEXT NOT NULL UNIQUE,
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created TEXT NOT NULL,
    last_updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
    sku TEXT PRIMARY KEY,
    barcode TEXT DEFAULT '',
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    brand TEXT DEFAULT '',
    description TEXT DEFAULT '',
    cost_price DOUBLE PRECISION DEFAULT 0,
    selling_price DOUBLE PRECISION DEFAULT 0,
    quantity INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 3,
    dimensions TEXT DEFAULT '',
    weight DOUBLE PRECISION DEFAULT 0,
    color TEXT DEFAULT '',
    image_path TEXT DEFAULT '',
    supplier TEXT DEFAULT '',
    date_added TEXT NOT NULL,
    last_updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    receipt_number TEXT UNIQUE NOT NULL,
    timestamp TEXT NOT NULL,
    date TEXT NOT NULL,
    subtotal DOUBLE PRECISION DEFAULT 0,
    discount_amount DOUBLE PRECISION DEFAULT 0,
    tax_amount DOUBLE PRECISION DEFAULT 0,
    grand_total DOUBLE PRECISION DEFAULT 0,
    payment_method TEXT DEFAULT '',
    cashier TEXT DEFAULT '',
    customer_name TEXT DEFAULT '',
    customer_phone TEXT DEFAULT '',
    customer_email TEXT DEFAULT '',
    status TEXT DEFAULT 'Complete',
    voided_at TEXT DEFAULT '',
    voided_by TEXT DEFAULT '',
    void_reason TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price DOUBLE PRECISION DEFAULT 0,
    line_total DOUBLE PRECISION DEFAULT 0,
    discount_type TEXT DEFAULT 'none',
    discount_value DOUBLE PRECISION DEFAULT 0,
    discount_amount DOUBLE PRECISION DEFAULT 0,
    final_total DOUBLE PRECISION DEFAULT 0,
    FOREIGN KEY (sale_id) REFERENCES sales(id)
);

CREATE TABLE IF NOT EXISTS held_transactions (
    hold_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    held_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_log (
    id SERIAL PRIMARY KEY,
    sku TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT DEFAULT '',
    old_value TEXT DEFAULT '',
    new_value TEXT DEFAULT '',
    qty_change DOUBLE PRECISION DEFAULT 0,
    created TEXT NOT NULL,
    FOREIGN KEY (sku) REFERENCES inventory(sku)
);

CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    sku TEXT NOT NULL,
    date TEXT NOT NULL,
    supplier TEXT DEFAULT '',
    quantity INTEGER DEFAULT 0,
    cost_price DOUBLE PRECISION DEFAULT 0,
    selling_price DOUBLE PRECISION DEFAULT 0,
    total_cost DOUBLE PRECISION DEFAULT 0,
    invoice_number TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created TEXT NOT NULL,
    FOREIGN KEY (sku) REFERENCES inventory(sku)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id SERIAL PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    invoice_number TEXT DEFAULT '',
    supplier_id INTEGER NOT NULL,
    supplier_name TEXT DEFAULT '',
    order_date TEXT NOT NULL,
    expected_date TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    notes TEXT DEFAULT '',
    total_amount DOUBLE PRECISION DEFAULT 0,
    received_date TEXT DEFAULT '',
    received_by TEXT DEFAULT '',
    receive_notes TEXT DEFAULT '',
    created TEXT NOT NULL,
    last_updated TEXT NOT NULL,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    sku TEXT NOT NULL,
    product_name TEXT DEFAULT '',
    quantity INTEGER DEFAULT 0,
    received_qty INTEGER DEFAULT 0,
    cost_price DOUBLE PRECISION DEFAULT 0,
    line_total DOUBLE PRECISION DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES purchase_orders(id),
    FOREIGN KEY (sku) REFERENCES inventory(sku)
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_receipt ON sales(receipt_number);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory(category);
CREATE INDEX IF NOT EXISTS idx_inventory_quantity ON inventory(quantity);
CREATE INDEX IF NOT EXISTS idx_inventory_log_sku ON inventory_log(sku);
CREATE INDEX IF NOT EXISTS idx_purchases_sku ON purchases(sku);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_poi_order ON purchase_order_items(order_id);
"""


def init_db():
    """Create database tables if they don't exist, then run migrations."""
    if not USE_POSTGRES:
        DATA_DIR.mkdir(exist_ok=True)

    conn = get_db()

    if USE_POSTGRES:
        # For PostgreSQL, execute schema through raw connection
        cur = conn._conn.cursor()
        cur.execute(PG_SCHEMA)
        conn._conn.commit()
        _run_pg_migrations(conn)
        engine = "PostgreSQL"
        db_loc = DATABASE_URL.split("@")[-1].split("/")[0] if "@" in DATABASE_URL else "cloud"
    else:
        conn.executescript(SQLITE_SCHEMA)
        conn.commit()
        _run_sqlite_migrations(conn)
        engine = "SQLite"
        db_loc = str(DB_PATH)

    print(f"[DB] Engine: {engine} | {db_loc}")


def _run_sqlite_migrations(conn):
    """SQLite-specific migrations (column additions, seeding)."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(sales)").fetchall()}
    migrations = [
        ("status", "ALTER TABLE sales ADD COLUMN status TEXT DEFAULT 'Complete'"),
        ("voided_at", "ALTER TABLE sales ADD COLUMN voided_at TEXT DEFAULT ''"),
        ("voided_by", "ALTER TABLE sales ADD COLUMN voided_by TEXT DEFAULT ''"),
        ("void_reason", "ALTER TABLE sales ADD COLUMN void_reason TEXT DEFAULT ''"),
    ]
    for col_name, sql in migrations:
        if col_name not in cols:
            conn.execute(sql)
            print(f"[DB] Migration: added column sales.{col_name}")

    # Create new tables if they don't exist (for existing databases)
    conn.execute("""CREATE TABLE IF NOT EXISTS inventory_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT NOT NULL, action TEXT NOT NULL, description TEXT DEFAULT '',
        old_value TEXT DEFAULT '', new_value TEXT DEFAULT '', qty_change REAL DEFAULT 0,
        created TEXT NOT NULL, FOREIGN KEY (sku) REFERENCES inventory(sku))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT NOT NULL, date TEXT NOT NULL, supplier TEXT DEFAULT '',
        quantity INTEGER DEFAULT 0, cost_price REAL DEFAULT 0, selling_price REAL DEFAULT 0,
        total_cost REAL DEFAULT 0, invoice_number TEXT DEFAULT '', notes TEXT DEFAULT '',
        created TEXT NOT NULL, FOREIGN KEY (sku) REFERENCES inventory(sku))""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_inventory_log_sku ON inventory_log(sku)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_purchases_sku ON purchases(sku)")

    # Purchase orders tables
    conn.execute("""CREATE TABLE IF NOT EXISTS purchase_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL, invoice_number TEXT DEFAULT '',
        supplier_id INTEGER NOT NULL,
        supplier_name TEXT DEFAULT '', order_date TEXT NOT NULL, expected_date TEXT DEFAULT '',
        status TEXT DEFAULT 'draft', notes TEXT DEFAULT '', total_amount REAL DEFAULT 0,
        received_date TEXT DEFAULT '', received_by TEXT DEFAULT '', receive_notes TEXT DEFAULT '',
        created TEXT NOT NULL, last_updated TEXT NOT NULL,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id))""")
    # Migration: add invoice_number to existing purchase_orders tables
    try:
        po_cols = {row[1] for row in conn.execute("PRAGMA table_info(purchase_orders)").fetchall()}
        if 'invoice_number' not in po_cols:
            conn.execute("ALTER TABLE purchase_orders ADD COLUMN invoice_number TEXT DEFAULT ''")
            print("[DB] Migration: added column purchase_orders.invoice_number")
    except Exception:
        pass
    conn.execute("""CREATE TABLE IF NOT EXISTS purchase_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL, sku TEXT NOT NULL, product_name TEXT DEFAULT '',
        quantity INTEGER DEFAULT 0, received_qty INTEGER DEFAULT 0,
        cost_price REAL DEFAULT 0, line_total REAL DEFAULT 0,
        FOREIGN KEY (order_id) REFERENCES purchase_orders(id),
        FOREIGN KEY (sku) REFERENCES inventory(sku))""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_poi_order ON purchase_order_items(order_id)")

    # Migration: add barcode column to inventory and auto-generate numeric barcodes
    inv_cols = {row[1] for row in conn.execute("PRAGMA table_info(inventory)").fetchall()}
    if 'barcode' not in inv_cols:
        conn.execute("ALTER TABLE inventory ADD COLUMN barcode TEXT DEFAULT ''")
        print("[DB] Migration: added column inventory.barcode")

    # Collect all existing barcodes to avoid duplicates
    existing_barcodes = {r[0] for r in conn.execute(
        "SELECT barcode FROM inventory WHERE barcode IS NOT NULL AND barcode != ''"
    ).fetchall()}

    def _gen_random_barcode(used):
        """Generate a unique random 6-digit barcode."""
        while True:
            code = str(random.randint(100000, 999999))
            if code not in used:
                used.add(code)
                return code

    # Re-randomize barcodes that aren't 6 digits (from old migrations)
    sequential_rows = conn.execute(
        "SELECT sku, barcode FROM inventory WHERE barcode IS NOT NULL AND barcode != '' AND LENGTH(barcode) != 6"
    ).fetchall()
    if sequential_rows:
        for row in sequential_rows:
            old_bc = row[1]
            new_bc = _gen_random_barcode(existing_barcodes)
            conn.execute("UPDATE inventory SET barcode = ? WHERE sku = ?", (new_bc, row[0]))
            existing_barcodes.discard(old_bc)
        print(f"[DB] Migration: re-randomized {len(sequential_rows)} sequential barcodes")

    # Auto-generate random 6-digit barcodes for products that don't have one
    empty_barcode_rows = conn.execute(
        "SELECT sku FROM inventory WHERE barcode IS NULL OR barcode = '' ORDER BY date_added, sku"
    ).fetchall()
    if empty_barcode_rows:
        for row in empty_barcode_rows:
            new_bc = _gen_random_barcode(existing_barcodes)
            conn.execute("UPDATE inventory SET barcode = ? WHERE sku = ?", (new_bc, row[0]))
        print(f"[DB] Migration: auto-generated barcodes for {len(empty_barcode_rows)} products")

    # Create unique index on barcode (ignore if exists)
    try:
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_barcode ON inventory(barcode)")
    except Exception:
        pass

    # Migration: normalize currency symbol Rs → ₹
    curr_row = conn.execute("SELECT value FROM settings WHERE key='currency_symbol'").fetchone()
    if curr_row and curr_row[0].strip().lower() in ('rs', 'rs.', 'inr'):
        conn.execute("UPDATE settings SET value='₹' WHERE key='currency_symbol'")
        print(f"[DB] Migration: currency_symbol '{curr_row[0]}' → '₹'")

    # Migration: convert old NLF-XXX-XXX SKUs to 6-digit random numbers
    old_sku_rows = conn.execute("SELECT sku FROM inventory WHERE sku LIKE 'NLF-%'").fetchall()
    if old_sku_rows:
        # Temporarily disable FK constraints for the migration
        if not USE_POSTGRES:
            conn.execute("PRAGMA foreign_keys = OFF")
        used_skus = {r[0] for r in conn.execute(
            "SELECT sku FROM inventory WHERE sku IS NOT NULL AND sku != ''"
        ).fetchall()}
        for row in old_sku_rows:
            old_sku = row[0]
            while True:
                new_sku = str(random.randint(100000, 999999))
                if new_sku not in used_skus:
                    break
            used_skus.add(new_sku)
            # Update all referencing tables first, then the parent
            for tbl in ("sale_items", "inventory_log", "purchase_order_items"):
                try:
                    conn.execute(f"UPDATE {tbl} SET sku = ? WHERE sku = ?", (new_sku, old_sku))
                except Exception:
                    pass
            conn.execute("UPDATE inventory SET sku = ? WHERE sku = ?", (new_sku, old_sku))
        if not USE_POSTGRES:
            conn.execute("PRAGMA foreign_keys = ON")
        print(f"[DB] Migration: converted {len(old_sku_rows)} old NLF- SKUs to 6-digit numbers")

    conn.commit()
    print("[DB] Migration: ensured inventory_log, purchases, and purchase_orders tables exist")

    # Seed suppliers from inventory
    now = datetime.now().isoformat()
    supplier_count = conn.execute("SELECT COUNT(*) as cnt FROM suppliers").fetchone()[0]
    if supplier_count == 0:
        existing = conn.execute(
            "SELECT DISTINCT supplier FROM inventory WHERE supplier != '' AND supplier IS NOT NULL"
        ).fetchall()
        for row in existing:
            name = row[0].strip()
            if name:
                try:
                    conn.execute(
                        "INSERT OR IGNORE INTO suppliers (name, created, last_updated) VALUES (?, ?, ?)",
                        (name, now, now)
                    )
                except Exception:
                    pass
        if existing:
            print(f"[DB] Migration: seeded {len(existing)} suppliers from inventory")

    # Seed customers from sales
    customer_count = conn.execute("SELECT COUNT(*) as cnt FROM customers").fetchone()[0]
    if customer_count == 0:
        existing_customers = conn.execute(
            "SELECT DISTINCT customer_phone, customer_name, customer_email FROM sales "
            "WHERE customer_phone != '' AND customer_phone IS NOT NULL"
        ).fetchall()
        seeded = 0
        for row in existing_customers:
            phone = row[0].strip()
            if phone:
                try:
                    conn.execute(
                        "INSERT OR IGNORE INTO customers (phone, name, email, created, last_updated) VALUES (?, ?, ?, ?, ?)",
                        (phone, row[1] or '', row[2] or '', now, now)
                    )
                    seeded += 1
                except Exception:
                    pass
        if seeded:
            print(f"[DB] Migration: seeded {seeded} customers from sales")

    conn.commit()


def _run_pg_migrations(conn):
    """PostgreSQL-specific migrations for existing databases."""
    cur = conn._conn.cursor()

    # Check if barcode column exists in inventory table
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'inventory' AND column_name = 'barcode'
    """)
    if not cur.fetchone():
        cur.execute("ALTER TABLE inventory ADD COLUMN barcode TEXT DEFAULT ''")
        conn._conn.commit()
        print("[DB] PG Migration: added column inventory.barcode")

    # Collect existing barcodes to avoid duplicates
    cur.execute("SELECT barcode FROM inventory WHERE barcode IS NOT NULL AND barcode != ''")
    existing_barcodes = {r[0] for r in cur.fetchall()}

    def _gen_random_barcode(used):
        while True:
            code = str(random.randint(100000, 999999))
            if code not in used:
                used.add(code)
                return code

    # Re-randomize barcodes that aren't 6 digits (from old migrations)
    cur.execute("SELECT sku, barcode FROM inventory WHERE barcode IS NOT NULL AND barcode != '' AND LENGTH(barcode) != 6")
    sequential_rows = cur.fetchall()
    if sequential_rows:
        for row in sequential_rows:
            old_bc = row[1]
            new_bc = _gen_random_barcode(existing_barcodes)
            cur.execute("UPDATE inventory SET barcode = %s WHERE sku = %s", (new_bc, row[0]))
            existing_barcodes.discard(old_bc)
        print(f"[DB] PG Migration: re-randomized {len(sequential_rows)} barcodes")

    # Auto-generate random 6-digit barcodes for products that don't have one
    cur.execute("SELECT sku FROM inventory WHERE barcode IS NULL OR barcode = '' ORDER BY date_added, sku")
    empty_rows = cur.fetchall()
    if empty_rows:
        for row in empty_rows:
            new_bc = _gen_random_barcode(existing_barcodes)
            cur.execute("UPDATE inventory SET barcode = %s WHERE sku = %s", (new_bc, row[0]))
        print(f"[DB] PG Migration: auto-generated barcodes for {len(empty_rows)} products")

    # Create unique index on barcode (if not exists)
    try:
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_barcode ON inventory(barcode)")
    except Exception:
        conn._conn.rollback()

    # Commit barcode migrations before proceeding
    conn._conn.commit()
    print("[DB] PG Migration: barcode column ready")

    # Migration: normalize currency symbol Rs → ₹
    # (committed separately so it's never lost by later errors)
    cur.execute("SELECT value FROM settings WHERE key='currency_symbol'")
    curr_row = cur.fetchone()
    if curr_row:
        raw_val = curr_row[0]
        print(f"[DB] PG Migration: currency_symbol current value = '{raw_val}' (repr={repr(raw_val)})")
        if raw_val.strip() != '₹':
            # Force to ₹ unless it's already correct
            cur.execute("UPDATE settings SET value='₹' WHERE key='currency_symbol'")
            conn._conn.commit()
            print(f"[DB] PG Migration: currency_symbol '{raw_val}' → '₹'")
        else:
            print("[DB] PG Migration: currency_symbol already '₹', no change needed")
    else:
        # No currency_symbol row at all — insert ₹
        cur.execute("INSERT INTO settings (key, value) VALUES ('currency_symbol', '₹')")
        conn._conn.commit()
        print("[DB] PG Migration: inserted currency_symbol = '₹'")

    # Migration: convert old NLF-XXX-XXX SKUs to 6-digit random numbers
    cur.execute("SELECT sku FROM inventory WHERE sku LIKE 'NLF-%%'")
    old_sku_rows = cur.fetchall()
    if old_sku_rows:
        # Temporarily disable FK triggers so we can update parent + child tables
        # Use savepoints so a missing table doesn't abort the transaction
        child_tables = ("inventory_log", "sale_items", "purchase_order_items")
        for tbl in child_tables + ("inventory",):
            cur.execute(f"SAVEPOINT sp_{tbl}")
            try:
                cur.execute(f"ALTER TABLE {tbl} DISABLE TRIGGER ALL")
            except Exception:
                cur.execute(f"ROLLBACK TO SAVEPOINT sp_{tbl}")

        cur.execute("SELECT sku FROM inventory WHERE sku IS NOT NULL AND sku != ''")
        used_skus = {r[0] for r in cur.fetchall()}
        for row in old_sku_rows:
            old_sku = row[0]
            while True:
                new_sku = str(random.randint(100000, 999999))
                if new_sku not in used_skus:
                    break
            used_skus.add(new_sku)
            # Update all tables that reference this SKU
            for tbl in child_tables:
                cur.execute(f"SAVEPOINT sp_upd_{tbl}")
                try:
                    cur.execute(f"UPDATE {tbl} SET sku = %s WHERE sku = %s", (new_sku, old_sku))
                except Exception:
                    cur.execute(f"ROLLBACK TO SAVEPOINT sp_upd_{tbl}")
            cur.execute("UPDATE inventory SET sku = %s WHERE sku = %s", (new_sku, old_sku))

        # Re-enable FK triggers
        for tbl in child_tables + ("inventory",):
            cur.execute(f"SAVEPOINT sp_en_{tbl}")
            try:
                cur.execute(f"ALTER TABLE {tbl} ENABLE TRIGGER ALL")
            except Exception:
                cur.execute(f"ROLLBACK TO SAVEPOINT sp_en_{tbl}")

        conn._conn.commit()
        print(f"[DB] PG Migration: converted {len(old_sku_rows)} old NLF- SKUs to 6-digit numbers")


# ---------------------------------------------------------------------------
# Migration from JSON files (SQLite only, local dev)
# ---------------------------------------------------------------------------

def _read_json(path):
    if not path.exists():
        return [] if "settings" not in path.name else {}
    with open(path, "r") as f:
        return json.load(f)


def migrate_from_json():
    """One-time migration: import data from JSON files into SQLite."""
    if USE_POSTGRES:
        return False

    conn = get_db()
    json_files = {
        "users": DATA_DIR / "users.json",
        "settings": DATA_DIR / "settings.json",
        "inventory": DATA_DIR / "inventory.json",
        "sales": DATA_DIR / "sales.json",
    }

    has_json = any(f.exists() for f in json_files.values())
    if not has_json:
        return False

    print("[DB] Migrating data from JSON files to SQLite...")

    users_file = json_files["users"]
    if users_file.exists():
        users = _read_json(users_file)
        for u in users:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO users (id, name, username, password, role, phone, active, created) VALUES (?,?,?,?,?,?,?,?)",
                    (u["id"], u.get("name", ""), u["username"], u["password"],
                     u.get("role", "staff"), u.get("phone", ""),
                     1 if u.get("active", True) else 0,
                     u.get("created", datetime.now().isoformat()))
                )
            except Exception as e:
                print(f"  [WARN] Skipping user {u.get('username')}: {e}")
        conn.commit()
        users_file.rename(users_file.with_suffix(".json.bak"))
        print(f"  Migrated {len(users)} users")

    settings_file = json_files["settings"]
    if settings_file.exists():
        settings = _read_json(settings_file)
        for key, value in settings.items():
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (key, json.dumps(value) if not isinstance(value, str) else value)
            )
        conn.commit()
        settings_file.rename(settings_file.with_suffix(".json.bak"))
        print(f"  Migrated {len(settings)} settings")

    inv_file = json_files["inventory"]
    if inv_file.exists():
        import random as _rnd
        inventory = _read_json(inv_file)
        _used_skus = {r[0] for r in conn.execute(
            "SELECT sku FROM inventory WHERE sku IS NOT NULL AND sku != ''"
        ).fetchall()}
        for p in inventory:
            sku = (p.get("sku") or "").strip()
            if not sku:
                while True:
                    candidate = str(_rnd.randint(100000, 999999))
                    if candidate not in _used_skus:
                        sku = candidate
                        break
            _used_skus.add(sku)
            try:
                conn.execute(
                    """INSERT OR IGNORE INTO inventory
                    (sku, name, category, brand, description, cost_price, selling_price,
                     quantity, reorder_level, dimensions, weight, color, image_path,
                     supplier, date_added, last_updated)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (sku, p["name"], p.get("category", ""), p.get("brand", ""),
                     p.get("description", ""), float(p.get("cost_price", 0)),
                     float(p.get("selling_price", 0)), int(p.get("quantity", 0)),
                     int(p.get("reorder_level", 3)), p.get("dimensions", ""),
                     float(p.get("weight", 0)), p.get("color", ""),
                     p.get("image_path", ""), p.get("supplier", ""),
                     p.get("date_added", date.today().isoformat()),
                     p.get("last_updated", date.today().isoformat()))
                )
            except Exception as e:
                print(f"  [WARN] Skipping product {p.get('sku')}: {e}")
        conn.commit()
        inv_file.rename(inv_file.with_suffix(".json.bak"))
        print(f"  Migrated {len(inventory)} products")

    sales_file = json_files["sales"]
    if sales_file.exists():
        sales = _read_json(sales_file)
        for s in sales:
            try:
                cursor = conn.execute(
                    """INSERT INTO sales
                    (receipt_number, timestamp, date, subtotal, discount_amount,
                     tax_amount, grand_total, payment_method, cashier,
                     customer_name, customer_phone, customer_email)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (s["receipt_number"], s.get("timestamp", ""),
                     s.get("date", ""), float(s.get("subtotal", 0)),
                     float(s.get("discount_amount", 0)),
                     float(s.get("tax_amount", 0)),
                     float(s.get("grand_total", 0)),
                     s.get("payment_method", ""),
                     s.get("cashier", ""),
                     s.get("customer_name", ""),
                     s.get("customer_phone", ""),
                     s.get("customer_email", ""))
                )
                sale_id = cursor.lastrowid
                for item in s.get("items", []):
                    conn.execute(
                        """INSERT INTO sale_items
                        (sale_id, sku, name, quantity, unit_price, line_total,
                         discount_type, discount_value, discount_amount, final_total)
                        VALUES (?,?,?,?,?,?,?,?,?,?)""",
                        (sale_id, item.get("sku", ""), item.get("name", ""),
                         int(item.get("quantity", 1)),
                         float(item.get("unit_price", 0)),
                         float(item.get("line_total", 0)),
                         item.get("discount_type", "none"),
                         float(item.get("discount_value", 0)),
                         float(item.get("discount_amount", 0)),
                         float(item.get("final_total", item.get("line_total", 0))))
                    )
            except Exception as e:
                print(f"  [WARN] Skipping sale {s.get('receipt_number')}: {e}")
        conn.commit()
        sales_file.rename(sales_file.with_suffix(".json.bak"))
        print(f"  Migrated {len(sales)} sales")

    print("[DB] Migration complete!")
    return True


# ---------------------------------------------------------------------------
# Backup (SQLite only — PostgreSQL uses platform-managed backups)
# ---------------------------------------------------------------------------

MAX_BACKUPS = 10


def create_backup():
    """Create a timestamped backup of the SQLite database file."""
    if USE_POSTGRES:
        print("[BACKUP] Skipped — PostgreSQL uses platform-managed backups")
        return None

    if not DB_PATH.exists():
        return None

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUP_DIR / f"nlf_pos_{timestamp}.db"

    try:
        src = sqlite3.connect(str(DB_PATH))
        dst = sqlite3.connect(str(backup_path))
        src.backup(dst)
        dst.close()
        src.close()
        print(f"[BACKUP] Created: {backup_path.name}")

        backups = sorted(BACKUP_DIR.glob("nlf_pos_*.db"), key=os.path.getmtime, reverse=True)
        for old in backups[MAX_BACKUPS:]:
            old.unlink()
            print(f"[BACKUP] Pruned old backup: {old.name}")

        return str(backup_path)
    except Exception as e:
        print(f"[BACKUP] Failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Data Export (SQLite → JSON for cloud migration)
# ---------------------------------------------------------------------------

def export_all_data():
    """Export all data from current database to a JSON-serializable dict."""
    conn = get_db()
    data = {}

    rows = conn.execute("SELECT * FROM users").fetchall()
    data["users"] = [dict(r) for r in rows]

    rows = conn.execute("SELECT * FROM settings").fetchall()
    data["settings"] = {}
    for r in rows:
        data["settings"][r["key"]] = r["value"]

    rows = conn.execute("SELECT * FROM inventory").fetchall()
    data["inventory"] = [dict(r) for r in rows]

    rows = conn.execute("SELECT * FROM suppliers").fetchall()
    data["suppliers"] = [dict(r) for r in rows]

    rows = conn.execute("SELECT * FROM customers").fetchall()
    data["customers"] = [dict(r) for r in rows]

    sales_rows = conn.execute("SELECT * FROM sales").fetchall()
    sales_list = []
    for s in sales_rows:
        sale = dict(s)
        items = conn.execute("SELECT * FROM sale_items WHERE sale_id = ?", (sale["id"],)).fetchall()
        sale["items"] = [dict(i) for i in items]
        sales_list.append(sale)
    data["sales"] = sales_list

    rows = conn.execute("SELECT * FROM inventory_log ORDER BY created DESC").fetchall()
    data["inventory_log"] = [dict(r) for r in rows]

    rows = conn.execute("SELECT * FROM purchases ORDER BY date DESC").fetchall()
    data["purchases"] = [dict(r) for r in rows]

    # Purchase orders + items
    po_rows = conn.execute("SELECT * FROM purchase_orders ORDER BY created DESC").fetchall()
    po_list = []
    for po in po_rows:
        order = dict(po)
        items = conn.execute("SELECT * FROM purchase_order_items WHERE order_id = ?", (order["id"],)).fetchall()
        order["items"] = [dict(i) for i in items]
        po_list.append(order)
    data["purchase_orders"] = po_list

    return data


def import_all_data(data):
    """Import a JSON data dict into the current database (works on both engines).
    Commits after each section so a failure in one table doesn't lose others.
    """
    conn = get_db()
    now = datetime.now().isoformat()
    imported = {"users": 0, "settings": 0, "inventory": 0, "suppliers": 0, "customers": 0, "sales": 0}

    # --- Users ---
    for u in data.get("users", []):
        try:
            conn.execute(
                "INSERT OR IGNORE INTO users (id, name, username, password, role, phone, active, created) VALUES (?,?,?,?,?,?,?,?)",
                (u["id"], u.get("name", ""), u["username"], u["password"],
                 u.get("role", "staff"), u.get("phone", ""),
                 1 if u.get("active", True) in (True, 1, "true") else 0,
                 u.get("created", now))
            )
            imported["users"] += 1
        except Exception as e:
            print(f"  [WARN] User {u.get('username')}: {e}")
    conn.commit()
    print(f"  [IMPORT] Users: {imported['users']}")

    # --- Settings ---
    for key, value in data.get("settings", {}).items():
        try:
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)",
                (key, value if isinstance(value, str) else json.dumps(value))
            )
            imported["settings"] += 1
        except Exception as e:
            print(f"  [WARN] Setting {key}: {e}")
    conn.commit()
    print(f"  [IMPORT] Settings: {imported['settings']}")

    # --- Inventory ---
    import random as _rnd
    _used_skus = {r[0] for r in conn.execute(
        "SELECT sku FROM inventory WHERE sku IS NOT NULL AND sku != ''"
    ).fetchall()}
    for p in data.get("inventory", []):
        sku = (p.get("sku") or "").strip()
        if not sku:
            while True:
                candidate = str(_rnd.randint(100000, 999999))
                if candidate not in _used_skus:
                    sku = candidate
                    break
        _used_skus.add(sku)
        try:
            conn.execute(
                "INSERT OR IGNORE INTO inventory (sku, name, category, brand, description, cost_price, selling_price, "
                "quantity, reorder_level, dimensions, weight, color, image_path, supplier, date_added, last_updated) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (sku, p["name"], p.get("category", ""), p.get("brand", ""),
                 p.get("description", ""), float(p.get("cost_price", 0)),
                 float(p.get("selling_price", 0)), int(p.get("quantity", 0)),
                 int(p.get("reorder_level", 3)), p.get("dimensions", ""),
                 float(p.get("weight", 0)), p.get("color", ""),
                 p.get("image_path", ""), p.get("supplier", ""),
                 p.get("date_added", now), p.get("last_updated", now))
            )
            imported["inventory"] += 1
        except Exception as e:
            print(f"  [WARN] Inventory {p.get('sku')}: {e}")
    conn.commit()
    print(f"  [IMPORT] Inventory: {imported['inventory']}")

    # --- Suppliers ---
    for s in data.get("suppliers", []):
        try:
            conn.execute(
                "INSERT OR IGNORE INTO suppliers (name, contact_person, phone, email, address, notes, created, last_updated) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (s["name"], s.get("contact_person", ""), s.get("phone", ""),
                 s.get("email", ""), s.get("address", ""), s.get("notes", ""),
                 s.get("created", now), s.get("last_updated", now))
            )
            imported["suppliers"] += 1
        except Exception as e:
            print(f"  [WARN] Supplier {s.get('name')}: {e}")
    conn.commit()
    print(f"  [IMPORT] Suppliers: {imported['suppliers']}")

    # --- Customers ---
    for c in data.get("customers", []):
        try:
            conn.execute(
                "INSERT OR IGNORE INTO customers (phone, name, email, address, notes, created, last_updated) "
                "VALUES (?,?,?,?,?,?,?)",
                (c["phone"], c.get("name", ""), c.get("email", ""),
                 c.get("address", ""), c.get("notes", ""),
                 c.get("created", now), c.get("last_updated", now))
            )
            imported["customers"] += 1
        except Exception as e:
            print(f"  [WARN] Customer {c.get('phone')}: {e}")
    conn.commit()
    print(f"  [IMPORT] Customers: {imported['customers']}")

    # --- Sales + Items ---
    for s in data.get("sales", []):
        try:
            cursor = conn.execute(
                "INSERT INTO sales (receipt_number, timestamp, date, subtotal, discount_amount, "
                "tax_amount, grand_total, payment_method, cashier, customer_name, customer_phone, "
                "customer_email, status, voided_at, voided_by, void_reason) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (s["receipt_number"], s.get("timestamp", ""), s.get("date", ""),
                 float(s.get("subtotal", 0)), float(s.get("discount_amount", 0)),
                 float(s.get("tax_amount", 0)), float(s.get("grand_total", 0)),
                 s.get("payment_method", ""), s.get("cashier", ""),
                 s.get("customer_name", ""), s.get("customer_phone", ""),
                 s.get("customer_email", ""), s.get("status", "Complete"),
                 s.get("voided_at", ""), s.get("voided_by", ""), s.get("void_reason", ""))
            )
            sale_id = cursor.lastrowid
            if sale_id:
                for item in s.get("items", []):
                    conn.execute(
                        "INSERT INTO sale_items (sale_id, sku, name, quantity, unit_price, line_total, "
                        "discount_type, discount_value, discount_amount, final_total) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (sale_id, item.get("sku", ""), item.get("name", ""),
                         int(item.get("quantity", 1)), float(item.get("unit_price", 0)),
                         float(item.get("line_total", 0)), item.get("discount_type", "none"),
                         float(item.get("discount_value", 0)), float(item.get("discount_amount", 0)),
                         float(item.get("final_total", item.get("line_total", 0))))
                    )
            conn.commit()
            imported["sales"] += 1
        except Exception as e:
            print(f"  [WARN] Sale {s.get('receipt_number')}: {e}")
            try:
                conn.rollback()
            except Exception:
                pass
    print(f"  [IMPORT] Sales: {imported['sales']}")

    # --- Inventory Log ---
    imported["inventory_log"] = 0
    for l in data.get("inventory_log", []):
        try:
            conn.execute(
                "INSERT INTO inventory_log (sku, action, description, old_value, new_value, qty_change, created) "
                "VALUES (?,?,?,?,?,?,?)",
                (l["sku"], l["action"], l.get("description", ""),
                 l.get("old_value", ""), l.get("new_value", ""),
                 float(l.get("qty_change", 0)), l.get("created", now))
            )
            imported["inventory_log"] += 1
        except Exception as e:
            print(f"  [WARN] Inventory log: {e}")
    conn.commit()
    print(f"  [IMPORT] Inventory log: {imported['inventory_log']}")

    # --- Purchases ---
    imported["purchases"] = 0
    for p in data.get("purchases", []):
        try:
            conn.execute(
                "INSERT INTO purchases (sku, date, supplier, quantity, cost_price, selling_price, total_cost, "
                "invoice_number, notes, created) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (p["sku"], p["date"], p.get("supplier", ""), int(p.get("quantity", 0)),
                 float(p.get("cost_price", 0)), float(p.get("selling_price", 0)),
                 float(p.get("total_cost", 0)), p.get("invoice_number", ""),
                 p.get("notes", ""), p.get("created", now))
            )
            imported["purchases"] += 1
        except Exception as e:
            print(f"  [WARN] Purchase: {e}")
    conn.commit()
    print(f"  [IMPORT] Purchases: {imported['purchases']}")

    # --- Purchase Orders + Items ---
    imported["purchase_orders"] = 0
    for po in data.get("purchase_orders", []):
        try:
            cursor = conn.execute(
                "INSERT INTO purchase_orders (order_number, invoice_number, supplier_id, supplier_name, order_date, "
                "expected_date, status, notes, total_amount, received_date, received_by, receive_notes, "
                "created, last_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (po["order_number"], po.get("invoice_number", ""),
                 int(po.get("supplier_id", 0)), po.get("supplier_name", ""),
                 po["order_date"], po.get("expected_date", ""), po.get("status", "draft"),
                 po.get("notes", ""), float(po.get("total_amount", 0)),
                 po.get("received_date", ""), po.get("received_by", ""),
                 po.get("receive_notes", ""), po.get("created", now), po.get("last_updated", now))
            )
            order_id = cursor.lastrowid
            if order_id:
                for item in po.get("items", []):
                    conn.execute(
                        "INSERT INTO purchase_order_items (order_id, sku, product_name, quantity, "
                        "received_qty, cost_price, line_total) VALUES (?,?,?,?,?,?,?)",
                        (order_id, item.get("sku", ""), item.get("product_name", ""),
                         int(item.get("quantity", 0)), int(item.get("received_qty", 0)),
                         float(item.get("cost_price", 0)), float(item.get("line_total", 0)))
                    )
            conn.commit()
            imported["purchase_orders"] += 1
        except Exception as e:
            print(f"  [WARN] Purchase order {po.get('order_number')}: {e}")
            try:
                conn.rollback()
            except Exception:
                pass
    print(f"  [IMPORT] Purchase orders: {imported['purchase_orders']}")

    return imported
