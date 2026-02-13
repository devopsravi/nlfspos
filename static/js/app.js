/* ========================================
   App.js — Core router, state, helpers
   ======================================== */

// --- XSS Protection: HTML entity escaper ---
function esc(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// Global fetch interceptor — redirect to login on 401 Unauthorized
(function() {
  const _origFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await _origFetch.apply(this, args);
    // Only intercept /api calls (not external resources)
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    if (url.startsWith('/api') && res.status === 401 && !url.includes('/api/auth/me') && !url.includes('/api/auth/login')) {
      // Session expired — redirect to login
      window.location.href = '/login';
    }
    return res;
  };
})();

const App = {
  settings: {},
  currentPage: 'pos',
  userRole: 'staff',  // set from server

  async init() {
    // Initialize offline store first (non-blocking)
    if (typeof OfflineStore !== 'undefined') {
      OfflineStore.init().catch((e) => console.warn('[App] OfflineStore init failed:', e));
    }

    await this.loadSettings();
    await this.loadUserRole();
    this.applyPermissions();
    this.setupNavigation();
    this.setupDarkMode();
    this.setupModals();
    this.updateHeader();
    // Initialize barcode scanner
    if (typeof BarcodeScanner !== 'undefined') BarcodeScanner.init();

    // Register Service Worker
    this.registerServiceWorker();

    // Online/offline listeners
    this.setupConnectivityListeners();

    // Update pending sales badge
    this.updatePendingBadge();

    // Check URL hash for initial page, or use role-based default
    const hashPage = this.getPageFromHash();
    if (hashPage) {
      this.navigate(hashPage.page, hashPage.sub, true);
    } else {
      this.navigate(this.userRole === 'admin' ? 'sales' : 'pos');
    }

    // Handle browser back/forward buttons
    window.addEventListener('hashchange', () => {
      const h = this.getPageFromHash();
      if (h && h.page !== this.currentPage) {
        this.navigate(h.page, h.sub, true); // skipHash=true to avoid re-setting hash
      }
    });

    // Periodic session check — every 5 minutes verify we're still authenticated
    this._sessionCheckInterval = setInterval(() => this.checkSession(), 5 * 60 * 1000);
  },

  async checkSession() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        this.isAuthenticated = false;
        clearInterval(this._sessionCheckInterval);
        alert('Your session has expired. Please log in again.');
        window.location.href = '/login';
      }
    } catch (e) {
      // Network error — don't force logout, they may just be offline momentarily
    }
  },

  getPageFromHash() {
    const hash = location.hash.replace('#', '');
    if (!hash) return null;
    const parts = hash.split('/');
    const page = parts[0];
    const sub = parts[1] || null;
    const validPages = ['pos', 'sales', 'inventory', 'labels', 'reports', 'transactions', 'settings', 'orders', 'suppliers', 'customers'];
    if (validPages.includes(page)) return { page, sub };
    return null;
  },

  refresh() {
    // Manager & staff always go to POS on refresh; admin reloads current page
    if (this.userRole === 'admin') {
      location.reload();
    } else {
      // Navigate to POS and re-init it
      this.navigate('pos');
    }
  },

  isAuthenticated: false,

  async loadUserRole() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const user = await res.json();
        this.userRole = user.role || 'staff';
        this.isAuthenticated = true;
        // Cache role for offline use
        try { localStorage.setItem('nlf_user_role', this.userRole); } catch (_) {}
      } else {
        // Not logged in — redirect to login page
        this.isAuthenticated = false;
        window.location.href = '/login';
        return;
      }
    } catch (e) {
      // Network error — if offline, try cached role (don't redirect to login)
      if (!navigator.onLine) {
        const cachedRole = localStorage.getItem('nlf_user_role');
        if (cachedRole) {
          this.userRole = cachedRole;
          this.isAuthenticated = true;
          console.log('[App] Offline — using cached role:', cachedRole);
          return;
        }
      }
      this.isAuthenticated = false;
      window.location.href = '/login';
      return;
    }
  },

  applyPermissions() {
    // Hide sidebar items that this role cannot access
    document.querySelectorAll('#sidebarNav [data-perm]').forEach(el => {
      const perm = el.dataset.perm;
      if (perm === 'all') return; // everyone can see
      if (perm === 'admin' && this.userRole !== 'admin') {
        el.style.display = 'none';
      }
      // manager can view inventory (read-only), so show it but we hide edit buttons in JS
      if (perm === 'admin' && this.userRole === 'manager') {
        // manager can see inventory (read-only), labels, and transactions
        if (el.dataset.page === 'inventory' || el.dataset.page === 'labels' || el.dataset.page === 'transactions') {
          el.style.display = '';
        }
      }
    });
  },

  // --- Settings ---
  async loadSettings() {
    try {
      const res = await fetch('/api/settings');
      this.settings = await res.json();
      // Cache settings for offline
      try { localStorage.setItem('nlf_settings_cache', JSON.stringify(this.settings)); } catch (_) {}
    } catch (e) {
      // Offline — try cached settings
      try {
        const cached = localStorage.getItem('nlf_settings_cache');
        if (cached) {
          this.settings = JSON.parse(cached);
          console.log('[App] Using cached settings (offline)');
          return;
        }
      } catch (_) {}
      console.error('Failed to load settings', e);
      this.settings = {};
    }
  },

  currency(amount) {
    const sym = this.settings.currency_symbol || '₹';
    return `${sym}${parseFloat(amount || 0).toFixed(2)}`;
  },

  taxRate() {
    return parseFloat(this.settings.tax_rate || 0) / 100;
  },

  taxName() {
    return this.settings.tax_name || 'Tax';
  },

  // Pages that belong to the Items menu group
  _itemsPages: ['inventory', 'orders', 'suppliers', 'customers'],

  // --- Navigation ---
  setupNavigation() {
    // Normal nav links
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        const sub = link.dataset.sub;
        if (page) {
          // If it's a settings sub-link, keep sub menu open
          if (page === 'settings' && sub) {
            const subMenu = document.getElementById('settingsSubMenu');
            const chevron = document.getElementById('settingsChevron');
            if (subMenu) subMenu.classList.remove('hidden');
            if (chevron) chevron.classList.add('rotate-180');
          }
          // If it's an Items sub-link, keep items menu open
          if (this._itemsPages.includes(page)) {
            const itemsSub = document.getElementById('itemsSubMenu');
            const itemsChev = document.getElementById('itemsChevron');
            if (itemsSub) itemsSub.classList.remove('hidden');
            if (itemsChev) itemsChev.classList.add('rotate-180');
          }
          this.navigate(page, sub);
        }
      });
    });

    // Items toggle button (expand/collapse sub-menu + navigate)
    const itemsToggle = document.getElementById('itemsToggle');
    const itemsSubMenu = document.getElementById('itemsSubMenu');
    const itemsChevron = document.getElementById('itemsChevron');
    if (itemsToggle) {
      itemsToggle.addEventListener('click', () => {
        const isHidden = itemsSubMenu.classList.contains('hidden');
        itemsSubMenu.classList.toggle('hidden');
        itemsChevron.classList.toggle('rotate-180');
        if (isHidden) {
          this.navigate('inventory');
        }
      });
    }

    // Settings toggle button (expand/collapse sub-menu + navigate)
    const settingsToggle = document.getElementById('settingsToggle');
    const settingsSubMenu = document.getElementById('settingsSubMenu');
    const settingsChevron = document.getElementById('settingsChevron');
    if (settingsToggle) {
      settingsToggle.addEventListener('click', () => {
        const isHidden = settingsSubMenu.classList.contains('hidden');
        settingsSubMenu.classList.toggle('hidden');
        settingsChevron.classList.toggle('rotate-180');
        // If opening, navigate to settings (first sub)
        if (isHidden) {
          this.navigate('settings', 'staff');
        }
      });
    }
  },

  navigate(page, sub, skipHash) {
    // Close mobile sidebar on navigation
    if (window.innerWidth < 768) this.closeSidebar();

    // Auth guard: if not authenticated, redirect to login
    if (!this.isAuthenticated) {
      window.location.href = '/login';
      return;
    }

    // Permission guard: non-admin can't access restricted pages
    const adminOnly = ['sales','inventory','labels','settings','reports','transactions','orders','suppliers','customers'];
    if (adminOnly.includes(page) && this.userRole === 'staff') {
      page = 'pos'; // redirect staff to POS
    }
    // Manager can view inventory read-only but not settings/dashboard/reports
    if (page === 'settings' && this.userRole !== 'admin') { page = 'pos'; }
    if (page === 'sales' && this.userRole !== 'admin') { page = 'pos'; }
    if (page === 'reports' && this.userRole !== 'admin') { page = 'pos'; }

    this.currentPage = page;

    // Update browser URL hash
    if (!skipHash) {
      const hashVal = sub ? `${page}/${sub}` : page;
      if (location.hash !== '#' + hashVal) {
        location.hash = hashVal;
      }
    }

    // Update nav active state
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active','text-white'));
    // For items-group pages, highlight the sub-link inside items menu
    if (this._itemsPages.includes(page)) {
      const itemsLink = document.querySelector(`#itemsSubMenu .nav-link[data-page="${page}"]`);
      if (itemsLink) itemsLink.classList.add('active','text-white');
      // Keep items menu open
      const itemsSub = document.getElementById('itemsSubMenu');
      const itemsChev = document.getElementById('itemsChevron');
      if (itemsSub) itemsSub.classList.remove('hidden');
      if (itemsChev) itemsChev.classList.add('rotate-180');
    } else {
      const activeLink = document.querySelector(`.nav-link[data-page="${page}"]:not(.sub-link)`);
      if (activeLink) activeLink.classList.add('active');
    }

    // Show/hide pages
    document.querySelectorAll('.page').forEach(p => {
      p.classList.add('hidden');
      p.style.display = 'none';
    });
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) {
      pageEl.classList.remove('hidden');
      pageEl.style.display = 'block';
    }

    // POS page: disable outer scroll on desktop so cart stays in viewport; allow scroll on mobile (stacked layout)
    const container = document.getElementById('pageContainer');
    if (container) {
      if (page === 'pos') {
        container.style.overflow = window.innerWidth >= 768 ? 'hidden' : 'auto';
      } else {
        container.style.overflow = 'auto';
      }
    }

    // Update title + breadcrumb subtitle
    const titles = { pos: 'POS Register', inventory: 'Inventory', labels: 'Labels', sales: 'Dashboard', reports: 'Reports', transactions: 'Sales', settings: 'Settings', orders: 'Purchase Orders', suppliers: 'Suppliers', customers: 'Customers' };
    const subtitles = { pos: 'checkout & billing', inventory: 'manage products', labels: 'barcode labels', sales: 'overview & stats', reports: 'sales & analytics', transactions: 'view & search transactions', settings: 'staff & config', orders: 'manage purchase orders', suppliers: 'manage suppliers', customers: 'manage customers' };
    document.getElementById('pageTitle').textContent = titles[page] || page;
    const subEl = document.querySelector('#pageTitle + span');
    if (subEl) subEl.textContent = `\u203A ${subtitles[page] || ''}`;

    // Trigger page init
    switch (page) {
      case 'pos': if (typeof POS !== 'undefined') POS.init(); break;
      case 'inventory': if (typeof Inventory !== 'undefined') Inventory.init(); break;
      case 'labels': if (typeof Labels !== 'undefined') Labels.init(); break;
      case 'sales': if (typeof Sales !== 'undefined') Sales.init(); break;
      case 'reports': if (typeof Reports !== 'undefined') Reports.init(); break;
      case 'transactions': if (typeof Transactions !== 'undefined') Transactions.init(); break;
      case 'settings': if (typeof Settings !== 'undefined') Settings.init(sub || 'staff'); break;
      case 'orders': if (typeof Orders !== 'undefined') Orders.init(); break;
      case 'suppliers': if (typeof Suppliers !== 'undefined') Suppliers.init(); break;
      case 'customers': if (typeof Customers !== 'undefined') Customers.init(); break;
    }
  },

  // --- Mobile Sidebar ---
  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    const isOpen = sidebar.classList.contains('translate-x-0');
    if (isOpen) {
      this.closeSidebar();
    } else {
      sidebar.classList.remove('-translate-x-full');
      sidebar.classList.add('translate-x-0');
      backdrop.classList.remove('hidden');
      document.body.classList.add('sidebar-open');
    }
  },

  closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    sidebar.classList.add('-translate-x-full');
    sidebar.classList.remove('translate-x-0');
    backdrop.classList.add('hidden');
    document.body.classList.remove('sidebar-open');
  },

  // --- Dark Mode ---
  setupDarkMode() {
    const toggle = document.getElementById('darkToggle');
    if (localStorage.getItem('darkMode') === 'true') {
      document.documentElement.classList.add('dark');
    }
    toggle.addEventListener('click', () => {
      document.documentElement.classList.toggle('dark');
      localStorage.setItem('darkMode', document.documentElement.classList.contains('dark'));
    });
  },

  // --- Header ---
  updateHeader() {
    // Username is now rendered server-side via Jinja; just update date
    document.getElementById('headerDate').textContent = new Date().toLocaleDateString('en-IN', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
  },

  // --- Logout ---
  async logout() {
    const ok = await this.confirm('Sign out of the POS system?');
    if (!ok) return;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { /* ignore */ }
    window.location.href = '/login';
  },

  // --- Modals ---
  setupModals() {
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-close')) {
        const modal = e.target.closest('.modal-overlay, [id$="Modal"]');
        if (modal) modal.classList.add('hidden');
      }
    });
    // Close modal on backdrop click
    document.querySelectorAll('.modal-overlay, #heldModal, #receiptModal, #confirmModal').forEach(m => {
      m.addEventListener('click', (e) => {
        if (e.target === m) m.classList.add('hidden');
      });
    });
  },

  // --- Toast ---
  toast(message, duration = 2500) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), duration);
  },

  // --- Confirm Dialog ---
  confirm(message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      document.getElementById('confirmMsg').textContent = message;
      modal.classList.remove('hidden');
      const ok = document.getElementById('confirmOk');
      const cancel = document.getElementById('confirmCancel');
      const cleanup = (val) => {
        modal.classList.add('hidden');
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        resolve(val);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
    });
  },

  // --- PWA: Service Worker Registration ---
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('[App] Service Worker registered, scope:', reg.scope);

          // Listen for new SW version
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                  this.toast('App updated — refresh for latest version', 4000);
                }
              });
            }
          });
        })
        .catch((err) => console.warn('[App] SW registration failed:', err));
    }
  },

  // --- PWA: Online/Offline Connectivity ---
  setupConnectivityListeners() {
    const indicator = document.getElementById('onlineStatus');

    const updateStatus = (online) => {
      if (indicator) {
        if (online) {
          indicator.classList.add('hidden');
        } else {
          indicator.classList.remove('hidden');
        }
      }
    };

    // Set initial state
    updateStatus(navigator.onLine);

    window.addEventListener('online', async () => {
      console.log('[App] Back online — syncing...');
      updateStatus(true);
      this.toast('Back online — syncing sales...', 2500);

      // Auto-sync pending sales
      if (typeof OfflineStore !== 'undefined') {
        try {
          const result = await OfflineStore.syncPendingSales();
          if (result.synced > 0) {
            this.toast(`${result.synced} offline sale(s) synced successfully`, 3000);
          }
          if (result.failed > 0) {
            this.toast(`${result.failed} sale(s) failed to sync — will retry`, 3500);
          }
        } catch (e) {
          console.error('[App] Sync error:', e);
        }
        this.updatePendingBadge();
      }
    });

    window.addEventListener('offline', () => {
      console.log('[App] Gone offline');
      updateStatus(false);
      this.toast('You are offline — sales will be queued', 3000);
    });
  },

  // --- PWA: Pending Sales Badge ---
  async updatePendingBadge() {
    const badge = document.getElementById('pendingSalesBadge');
    if (!badge) return;

    if (typeof OfflineStore !== 'undefined') {
      try {
        const count = await OfflineStore.getPendingCount();
        if (count > 0) {
          badge.textContent = count;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      } catch (e) {
        badge.classList.add('hidden');
      }
    } else {
      badge.classList.add('hidden');
    }
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
