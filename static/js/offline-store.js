/* =============================================
   OfflineStore — IndexedDB cache for PWA
   Stores products locally + queues offline sales
   ============================================= */

const OfflineStore = {
  DB_NAME: 'nlf-pos-offline',
  DB_VERSION: 1,
  _db: null,

  // ---- Open / Upgrade ----
  async init() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Products store — keyed by sku
        if (!db.objectStoreNames.contains('products')) {
          const prodStore = db.createObjectStore('products', { keyPath: 'sku' });
          prodStore.createIndex('barcode', 'barcode', { unique: false });
          prodStore.createIndex('category', 'category', { unique: false });
          prodStore.createIndex('name', 'name', { unique: false });
        }

        // Pending sales queue — auto-increment key
        if (!db.objectStoreNames.contains('pendingSales')) {
          db.createObjectStore('pendingSales', { keyPath: 'localId', autoIncrement: true });
        }

        // Categories cache
        if (!db.objectStoreNames.contains('categories')) {
          db.createObjectStore('categories', { keyPath: 'name' });
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        console.log('[OfflineStore] IndexedDB opened');
        resolve(this._db);
      };

      request.onerror = (event) => {
        console.error('[OfflineStore] IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  // ---- Helper: get a transaction + object store ----
  _getStore(storeName, mode = 'readonly') {
    if (!this._db) throw new Error('OfflineStore not initialized');
    const tx = this._db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  },

  // ---- Products ----

  /** Bulk-save products (replaces all) */
  async saveProducts(products) {
    if (!this._db || !products || products.length === 0) return;

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('products', 'readwrite');
      const store = tx.objectStore('products');

      // Clear old data, then add fresh
      store.clear();
      for (const p of products) {
        store.put(p);
      }

      tx.oncomplete = () => {
        console.log(`[OfflineStore] Cached ${products.length} products`);
        resolve();
      };
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  /** Get all cached products, with optional text query filter */
  async getProducts(query) {
    if (!this._db) return [];

    return new Promise((resolve, reject) => {
      const store = this._getStore('products');
      const request = store.getAll();

      request.onsuccess = () => {
        let results = request.result || [];

        if (query) {
          const q = query.toLowerCase();
          results = results.filter((p) =>
            (p.name || '').toLowerCase().includes(q) ||
            (p.sku || '').toLowerCase().includes(q) ||
            (p.barcode || '').toLowerCase().includes(q) ||
            (p.brand || '').toLowerCase().includes(q) ||
            (p.category || '').toLowerCase().includes(q)
          );
        }

        // Sort by name
        results.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        resolve(results);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  /** Get products filtered by category */
  async getProductsByCategory(category) {
    if (!this._db) return [];

    return new Promise((resolve, reject) => {
      const store = this._getStore('products');
      const index = store.index('category');
      const request = index.getAll(category);

      request.onsuccess = () => {
        const results = (request.result || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        resolve(results);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  /** Get a single product by SKU or barcode */
  async getProduct(skuOrBarcode) {
    if (!this._db || !skuOrBarcode) return null;

    return new Promise((resolve, reject) => {
      const store = this._getStore('products');

      // Try by SKU first
      const skuReq = store.get(skuOrBarcode);
      skuReq.onsuccess = () => {
        if (skuReq.result) {
          resolve(skuReq.result);
          return;
        }
        // Try by barcode index
        const barcodeIdx = store.index('barcode');
        const bcReq = barcodeIdx.get(skuOrBarcode);
        bcReq.onsuccess = () => resolve(bcReq.result || null);
        bcReq.onerror = (e) => reject(e.target.error);
      };
      skuReq.onerror = (e) => reject(e.target.error);
    });
  },

  // ---- Categories ----

  /** Save categories list */
  async saveCategories(categories) {
    if (!this._db || !categories) return;

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('categories', 'readwrite');
      const store = tx.objectStore('categories');
      store.clear();
      for (const name of categories) {
        store.put({ name });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  /** Get cached categories */
  async getCategories() {
    if (!this._db) return [];

    return new Promise((resolve, reject) => {
      const store = this._getStore('categories');
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []).map((c) => c.name));
      request.onerror = (e) => reject(e.target.error);
    });
  },

  // ---- Pending Sales Queue ----

  /** Queue a sale for later sync */
  async queueSale(saleData) {
    if (!this._db) return null;

    return new Promise((resolve, reject) => {
      const store = this._getStore('pendingSales', 'readwrite');
      const record = {
        ...saleData,
        queuedAt: new Date().toISOString(),
        syncStatus: 'pending',
      };
      const request = store.add(record);
      request.onsuccess = () => {
        console.log('[OfflineStore] Sale queued:', request.result);
        resolve(request.result); // returns localId
      };
      request.onerror = (e) => reject(e.target.error);
    });
  },

  /** Get all pending (unsynced) sales */
  async getPendingSales() {
    if (!this._db) return [];

    return new Promise((resolve, reject) => {
      const store = this._getStore('pendingSales');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  /** Remove a successfully synced sale */
  async removePendingSale(localId) {
    if (!this._db) return;

    return new Promise((resolve, reject) => {
      const store = this._getStore('pendingSales', 'readwrite');
      const request = store.delete(localId);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  },

  /** Count pending sales (for badge) */
  async getPendingCount() {
    if (!this._db) return 0;

    return new Promise((resolve, reject) => {
      const store = this._getStore('pendingSales');
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });
  },

  // ---- Sync ----

  /** Sync all pending sales to the server via /api/sales/batch */
  async syncPendingSales() {
    const pending = await this.getPendingSales();
    if (pending.length === 0) return { synced: 0, failed: 0 };

    console.log(`[OfflineStore] Syncing ${pending.length} pending sale(s)...`);

    try {
      const res = await fetch('/api/sales/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales: pending }),
      });

      if (!res.ok) {
        console.error('[OfflineStore] Batch sync HTTP error:', res.status);
        return { synced: 0, failed: pending.length };
      }

      const data = await res.json();
      let synced = 0;
      let failed = 0;

      for (const result of (data.results || [])) {
        if (result.status === 'ok') {
          await this.removePendingSale(result.localId);
          synced++;
        } else {
          console.warn('[OfflineStore] Sale sync failed:', result.localId, result.error);
          failed++;
        }
      }

      console.log(`[OfflineStore] Sync complete: ${synced} synced, ${failed} failed`);
      return { synced, failed };

    } catch (err) {
      console.error('[OfflineStore] Sync network error:', err);
      return { synced: 0, failed: pending.length };
    }
  },

  // ---- Decrement stock locally (for offline sales) ----

  async decrementStock(sku, qty) {
    if (!this._db) return;

    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('products', 'readwrite');
      const store = tx.objectStore('products');
      const getReq = store.get(sku);

      getReq.onsuccess = () => {
        const product = getReq.result;
        if (product) {
          product.quantity = Math.max(0, (product.quantity || 0) - qty);
          store.put(product);
        }
        resolve();
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  },
};
