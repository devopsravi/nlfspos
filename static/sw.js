/* =============================================
   NLF POS — Service Worker
   Cache app shell + network-first for API
   ============================================= */

const SHELL_CACHE = 'nlf-pos-shell-v2';
const API_CACHE   = 'nlf-pos-api-v2';
const ALL_CACHES  = [SHELL_CACHE, API_CACHE];

// --- App shell files to pre-cache on install ---
const SHELL_FILES = [
  '/',
  '/static/css/main.css?v=8',
  '/static/css/pos.css?v=8',
  '/static/css/labels.css?v=8',
  '/static/css/receipt.css?v=8',
  '/static/js/app.js?v=8',
  '/static/js/pos.js?v=8',
  '/static/js/inventory.js?v=8',
  '/static/js/labels.js?v=8',
  '/static/js/sales.js?v=8',
  '/static/js/reports.js?v=8',
  '/static/js/transactions.js?v=8',
  '/static/js/settings.js?v=8',
  '/static/js/suppliers.js?v=8',
  '/static/js/customers.js?v=8',
  '/static/js/orders.js?v=8',
  '/static/js/scanner.js?v=8',
  '/static/js/offline-store.js?v=8',
  '/static/img/logo.svg',
  '/static/img/favicon.svg',
  '/static/img/icon-192.png',
  '/static/img/icon-512.png',
  '/static/manifest.json',
];

// CDN libraries to cache on first use (not on install to avoid CORS issues)
const CDN_PATTERNS = [
  'cdn.jsdelivr.net',
  'cdn.tailwindcss.com',
  'unpkg.com',
];

// API paths eligible for network-first caching (GET only)
const CACHEABLE_API = [
  '/api/inventory',
  '/api/inventory/categories',
  '/api/settings',
];

// API paths that should NEVER be cached
const NEVER_CACHE = [
  '/api/auth/',
  '/api/sales',
  '/login',
];

// ---- Install: pre-cache app shell ----
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching app shell');
        return cache.addAll(SHELL_FILES);
      })
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[SW] Some shell files failed to cache:', err);
        return self.skipWaiting();
      })
  );
});

// ---- Activate: clean up old caches ----
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !ALL_CACHES.includes(k))
            .map((k) => { console.log('[SW] Removing old cache:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim())
  );
});

// ---- Fetch: route strategy ----
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests for caching
  if (request.method !== 'GET') return;

  // Skip never-cache routes
  if (NEVER_CACHE.some((p) => url.pathname.startsWith(p))) return;

  // CDN resources: cache-first (once cached, serve from cache)
  if (CDN_PATTERNS.some((p) => url.hostname.includes(p))) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Cacheable API: network-first, fallback to cache
  if (CACHEABLE_API.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Static assets (/static/): cache-first
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // HTML page (/): network-first (so login redirects work)
  if (url.pathname === '/' || url.pathname === '') {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }
});

// ---- Strategies ----

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Offline and not cached — return generic offline fallback
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Network failed — try cache
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ---- Message handler (for sync triggers from client) ----
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
