/* =============================================
   NLF POS — Service Worker (Enterprise)
   Network-first when online, cache fallback offline
   ============================================= */

const CACHE_NAME = 'nlf-pos-v4';

const CDN_PATTERNS = [
  'cdn.jsdelivr.net',
  'cdn.tailwindcss.com',
  'unpkg.com',
];

const CACHEABLE_API = [
  '/api/inventory',
  '/api/categories',
  '/api/settings',
];

const NEVER_CACHE = [
  '/api/auth/',
  '/api/sales',
  '/api/events',
  '/api/version',
  '/login',
];

// ---- Install: activate immediately (no pre-cache) ----
self.addEventListener('install', () => {
  console.log('[SW] Installing (enterprise)...');
  self.skipWaiting();
});

// ---- Activate: clean old caches, claim clients ----
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Removing old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ---- Fetch: route strategy ----
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Never cache these
  if (NEVER_CACHE.some(p => url.pathname.startsWith(p))) return;

  // CDN: stale-while-revalidate (fast + fresh)
  if (CDN_PATTERNS.some(p => url.hostname.includes(p))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Cacheable API: network-first, cache fallback
  if (CACHEABLE_API.some(p => url.pathname.startsWith(p))) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets: network-first when online, cache fallback offline
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // HTML: network-first (always get fresh HTML with latest asset hashes)
  if (url.pathname === '/' || url.pathname === '') {
    event.respondWith(networkFirst(request));
    return;
  }
});

// ---- Strategies ----

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  if (cached) {
    fetchPromise.catch(() => {});
    return cached;
  }

  const response = await fetchPromise;
  if (response) return response;
  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

// ---- Message handler ----
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHES') {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.matchAll())
      .then(clients => clients.forEach(c => c.postMessage({ type: 'CACHES_CLEARED' })))
      .catch(err => console.warn('[SW] Clear caches error:', err));
  }
});
