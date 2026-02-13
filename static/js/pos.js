/* ========================================
   Point of Sale Module — Register Layout
   ======================================== */

const POS = {
  products: [],
  cart: [],          // Each item: { sku, name, price, quantity, maxQty, discountType:'none'|'percent'|'flat', discountValue:0 }
  paymentMethod: 'Cash',

  async init() {
    await this.loadProducts();
    this.renderProducts();
    this.bindEvents();
    this.restoreCart();          // Restore cart from localStorage
    this.updateCartUI();
    this.updateHeldBadge();
    this.updateTaxLabel();
    this.populateCategories();
  },

  // --- Cart persistence (localStorage) ---
  saveCart() {
    try {
      localStorage.setItem('nlf_pos_cart', JSON.stringify(this.cart));
    } catch (e) { /* ignore quota errors */ }
  },

  restoreCart() {
    try {
      const saved = localStorage.getItem('nlf_pos_cart');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.cart = parsed;
        }
      }
    } catch (e) { /* ignore parse errors */ }
  },

  async loadProducts() {
    const params = new URLSearchParams();
    const q = document.getElementById('posSearch')?.value || '';
    const cat = document.getElementById('posCategoryFilter')?.value || '';
    const catQ = document.getElementById('posCatQuick')?.value || '';
    if (q) params.set('q', q);
    if (cat) params.set('category', cat);
    else if (catQ) params.set('category', catQ);
    try {
      const res = await fetch(`/api/inventory?${params}`);
      this.products = await res.json();
      // Cache products in IndexedDB for offline use (only full catalog, no filter)
      if (!q && !cat && !catQ && typeof OfflineStore !== 'undefined') {
        OfflineStore.saveProducts(this.products).catch(() => {});
      }
    } catch (e) {
      // Offline fallback — load from IndexedDB cache
      if (typeof OfflineStore !== 'undefined') {
        try {
          const category = cat || catQ || '';
          if (category) {
            this.products = await OfflineStore.getProductsByCategory(category);
          } else {
            this.products = await OfflineStore.getProducts(q || undefined);
          }
          console.log(`[POS] Loaded ${this.products.length} products from offline cache`);
        } catch (dbErr) {
          this.products = [];
        }
      } else {
        this.products = [];
      }
    }
  },

  async populateCategories() {
    let cats = [];
    try {
      const res = await fetch('/api/inventory');
      const all = await res.json();
      cats = [...new Set(all.map(p => p.category).filter(Boolean))].sort();
      // Cache categories for offline
      if (typeof OfflineStore !== 'undefined') {
        OfflineStore.saveCategories(cats).catch(() => {});
      }
    } catch (e) {
      // Offline fallback
      if (typeof OfflineStore !== 'undefined') {
        try { cats = await OfflineStore.getCategories(); } catch (_) {}
      }
    }

    // Populate both dropdowns
    ['posCategoryFilter', 'posCatQuick'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const current = el.value;
      const options = id === 'posCatQuick'
        ? '<option value="">All Categories</option>'
        : '<option value="">All</option>';
      el.innerHTML = options + cats.map(c =>
        `<option value="${esc(c)}" ${c === current ? 'selected' : ''}>${esc(c)}</option>`
      ).join('');
    });
  },

  renderProducts() {
    const container = document.getElementById('posProductCards');
    if (!container) return;

    if (this.products.length === 0) {
      container.innerHTML = '<p class="text-gray-400 text-sm col-span-2 text-center py-8">No products found</p>';
      return;
    }

    container.innerHTML = this.products.map(p => `
      <div class="pos-product-card ${p.quantity <= 0 ? 'out-of-stock' : ''}" data-sku="${esc(p.sku)}">
        <span class="card-sku">${esc(p.barcode || p.sku)}</span>
        <span class="card-name">${esc(p.name)}</span>
        <span class="card-stock">${p.quantity > 0 ? p.quantity + ' in stock' : 'Out'}</span>
        <span class="card-price">${App.currency(p.selling_price)}</span>
      </div>
    `).join('');

    container.querySelectorAll('.pos-product-card:not(.out-of-stock)').forEach(card => {
      card.addEventListener('click', () => {
        const sku = card.dataset.sku;
        const product = this.products.find(p => p.sku === sku);
        if (product) this.addToCart(product);
      });
    });
  },

  addToCart(product) {
    const existing = this.cart.find(c => c.sku === product.sku);
    if (existing) {
      if (existing.quantity < product.quantity) {
        existing.quantity++;
      } else {
        App.toast('Max stock reached');
        return;
      }
    } else {
      this.cart.push({
        sku: product.sku,
        barcode: product.barcode || '',
        name: product.name,
        price: product.selling_price,
        quantity: 1,
        maxQty: product.quantity,
        discountType: 'none',
        discountValue: 0,
      });
    }
    this.updateCartUI();
  },

  _searchSkuTypeahead() {
    const input = document.getElementById('posSkuInput');
    const dropdown = document.getElementById('posSkuDropdown');
    const query = (input?.value || '').trim().toLowerCase();

    if (!query || query.length < 1) {
      dropdown?.classList.add('hidden');
      return;
    }

    const matches = this.products.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.sku.toLowerCase().includes(query) ||
      (p.barcode || '').toLowerCase().includes(query) ||
      (p.category || '').toLowerCase().includes(query)
    ).slice(0, 10);

    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="px-3 py-2 text-xs text-gray-400">No products found</div>';
    } else {
      dropdown.innerHTML = matches.map(p => `
        <div class="sku-result-item px-3 py-2 hover:bg-teal-50 cursor-pointer flex items-center justify-between text-xs border-b last:border-b-0"
             data-sku="${esc(p.sku)}">
          <div>
            <div class="font-medium text-gray-800">${esc(p.name)}</div>
            <div class="text-gray-400">${esc(p.barcode || p.sku)}</div>
          </div>
          <div class="text-right">
            <div class="font-bold text-teal-600">₹${Number(p.selling_price || 0).toLocaleString('en-IN')}</div>
            <div class="text-gray-400">${p.quantity} in stock</div>
          </div>
        </div>`).join('');

      dropdown.querySelectorAll('.sku-result-item').forEach(item => {
        item.addEventListener('click', () => {
          const sku = item.dataset.sku;
          const product = this.products.find(pr => pr.sku === sku);
          if (product) {
            this.addToCart(product);
            input.value = '';
            dropdown.classList.add('hidden');
          }
        });
      });
    }
    dropdown.classList.remove('hidden');
  },

  removeFromCart(sku) {
    this.cart = this.cart.filter(c => c.sku !== sku);
    this.updateCartUI();
  },

  updateQty(sku, delta) {
    const item = this.cart.find(c => c.sku === sku);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
      this.removeFromCart(sku);
      return;
    }
    if (item.quantity > item.maxQty) {
      item.quantity = item.maxQty;
      App.toast('Max stock reached');
    }
    this.updateCartUI();
  },

  // --- Per-item discount helpers ---

  setItemDiscountType(sku, type) {
    const item = this.cart.find(c => c.sku === sku);
    if (!item) return;
    item.discountType = type;
    if (type === 'none') item.discountValue = 0;
    this.updateCartUI();
  },

  setItemDiscountValue(sku, val) {
    const item = this.cart.find(c => c.sku === sku);
    if (!item) return;
    item.discountValue = parseFloat(val) || 0;
    this.updateCartUI();
  },

  getItemDiscount(item) {
    const lineTotal = item.price * item.quantity;
    if (item.discountType === 'percent') {
      return lineTotal * (Math.min(item.discountValue, 100) / 100);
    }
    if (item.discountType === 'flat') {
      return Math.min(item.discountValue, lineTotal);
    }
    return 0;
  },

  getItemFinalTotal(item) {
    return (item.price * item.quantity) - this.getItemDiscount(item);
  },

  // --- Cart totals ---

  getSubtotal() {
    return this.cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  },

  getTotalDiscount() {
    return this.cart.reduce((sum, c) => sum + this.getItemDiscount(c), 0);
  },

  getAfterDiscount() {
    return this.getSubtotal() - this.getTotalDiscount();
  },

  getTax() {
    return this.getAfterDiscount() * App.taxRate();
  },

  getTotal() {
    return this.getAfterDiscount() + this.getTax();
  },

  // --- Cart UI (TABLE-based) ---

  updateCartUI() {
    const tbody = document.getElementById('cartItems');
    const btn = document.getElementById('btnCompleteSale');
    const sym = App._currSym();
    const taxRate = parseFloat(App.settings.tax_rate || 0);

    if (this.cart.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-gray-400 py-10 text-sm">No items in cart</td></tr>';
      btn.disabled = true;
      btn.textContent = `Pay ₹0.00`;
    } else {
      tbody.innerHTML = this.cart.map((c, idx) => {
        const lineTotal = c.price * c.quantity;
        const disc = this.getItemDiscount(c);
        const finalTotal = lineTotal - disc;
        const itemTax = finalTotal * (taxRate / 100);
        const hasDiscount = c.discountType !== 'none' && disc > 0;
        const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';

        const safeSku = esc(c.sku);
        return `
        <tr class="${rowBg}">
          <td class="px-4 py-2.5 text-center">
            <div class="cart-qty-ctrl">
              <button onclick="POS.updateQty('${safeSku}', -1)">−</button>
              <span>${c.quantity}</span>
              <button onclick="POS.updateQty('${safeSku}', 1)">+</button>
            </div>
          </td>
          <td class="px-4 py-2.5">
            <div class="font-medium text-gray-800 text-sm leading-tight">${esc(c.name)}</div>
            <div class="text-xs text-gray-400">${esc(c.barcode || c.sku)}</div>
          </td>
          <td class="px-4 py-2.5 text-right font-semibold text-gray-700">${App.currency(c.price)}</td>
          <td class="px-4 py-2.5 text-right text-gray-500">${App.currency(itemTax)}</td>
          <td class="px-4 py-2.5 text-right font-bold text-gray-900">
            ${hasDiscount ? `<span class="line-through text-gray-400 text-xs">${App.currency(lineTotal)}</span><br>` : ''}
            ${App.currency(finalTotal)}
          </td>
          <td class="px-3 py-2.5 text-center">
            <div class="cart-disc-ctrl">
              <select onchange="POS.setItemDiscountType('${safeSku}', this.value)">
                <option value="none" ${c.discountType === 'none' ? 'selected' : ''}>—</option>
                <option value="percent" ${c.discountType === 'percent' ? 'selected' : ''}>%</option>
                <option value="flat" ${c.discountType === 'flat' ? 'selected' : ''}>₹</option>
              </select>
              ${c.discountType !== 'none' ? `
                <input type="number" min="0" step="0.01"
                  value="${c.discountValue}"
                  onchange="POS.setItemDiscountValue('${safeSku}', this.value)"
                  oninput="POS.setItemDiscountValue('${safeSku}', this.value)"
                  placeholder="${c.discountType === 'percent' ? '%' : '₹'}" />
              ` : ''}
              ${hasDiscount ? `<span class="cart-disc-badge">-${App.currency(disc)}</span>` : ''}
            </div>
          </td>
          <td class="px-3 py-2.5 text-center">
            <button class="cart-remove-btn" onclick="POS.removeFromCart('${safeSku}')">&times;</button>
          </td>
        </tr>`;
      }).join('');
      btn.disabled = false;
    }

    // Totals
    const totalItems = this.cart.reduce((s, c) => s + c.quantity, 0);
    const totalDiscount = this.getTotalDiscount();
    const el = (id) => document.getElementById(id);

    el('cartItemCount').textContent = totalItems;
    el('cartSubtotal').textContent = App.currency(this.getSubtotal());
    el('cartDiscount').textContent = totalDiscount > 0 ? `-${App.currency(totalDiscount)}` : `₹0.00`;
    el('cartTax').textContent = App.currency(this.getTax());

    const grandTotal = this.getTotal();
    el('cartTotal').textContent = App.currency(grandTotal);

    // Update pay button
    btn.textContent = `Pay ${App.currency(grandTotal)}`;

    // Persist cart to localStorage
    this.saveCart();
  },

  // ========== Customer Phone Lookup ==========

  _customerCache: [],

  async lookupCustomer() {
    const input = document.getElementById('custPhone');
    const dropdown = document.getElementById('custPhoneDropdown');
    if (!input || !dropdown) return;

    const query = input.value.trim();
    if (query.length < 3) {
      dropdown.classList.add('hidden');
      return;
    }

    // Fetch customers if cache is empty or stale
    if (this._customerCache.length === 0) {
      try {
        const res = await fetch('/api/customers');
        if (res.ok) this._customerCache = await res.json();
      } catch (e) { /* ignore */ }
    }

    // Search by phone or name
    const q = query.toLowerCase();
    const matches = this._customerCache.filter(c =>
      (c.phone || '').includes(q) || (c.name || '').toLowerCase().includes(q)
    ).slice(0, 5);

    if (matches.length > 0) {
      dropdown.innerHTML = matches.map(c => {
        const safePhone = esc(c.phone).replace(/'/g, "\\'");
        const safeName = esc(c.name || '').replace(/'/g, "\\'");
        const safeEmail = esc(c.email || '').replace(/'/g, "\\'");
        return `
        <div class="px-3 py-2 hover:bg-teal-50 cursor-pointer flex items-center gap-2 border-b border-gray-100 last:border-0 transition"
             onclick="POS.selectCustomer(${c.id}, '${safePhone}', '${safeName}', '${safeEmail}')">
          <div class="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
            ${esc((c.name || c.phone || '?').charAt(0).toUpperCase())}
          </div>
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 truncate">${esc(c.name || 'No name')}</div>
            <div class="text-xs text-gray-500">${esc(c.phone)}${c.order_count ? ` · ${c.order_count} orders` : ''}</div>
          </div>
        </div>`;
      }).join('') + `
        <div class="px-3 py-2 hover:bg-green-50 cursor-pointer flex items-center gap-2 border-t border-gray-200 transition"
             onclick="POS.addNewCustomerFromPOS()">
          <div class="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold flex-shrink-0">+</div>
          <div class="text-sm text-green-700 font-medium">Add as new customer</div>
        </div>`;
    } else {
      // No matches — show "add new" option
      dropdown.innerHTML = `
        <div class="px-3 py-3 text-center text-xs text-gray-400">No customer found for "${esc(query)}"</div>
        <div class="px-3 py-2 hover:bg-green-50 cursor-pointer flex items-center gap-2 border-t border-gray-200 transition"
             onclick="POS.addNewCustomerFromPOS()">
          <div class="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold flex-shrink-0">+</div>
          <div class="text-sm text-green-700 font-medium">Add "${esc(query)}" as new customer</div>
        </div>`;
    }

    // Position dropdown below the input using fixed positioning
    this.positionDropdown(input, dropdown);
    dropdown.classList.remove('hidden');
  },

  positionDropdown(input, dropdown) {
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Show above if not enough room below (dropdown ~200px)
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      dropdown.style.left = rect.left + 'px';
      dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
      dropdown.style.top = 'auto';
    } else {
      dropdown.style.left = rect.left + 'px';
      dropdown.style.top = (rect.bottom + 4) + 'px';
      dropdown.style.bottom = 'auto';
    }
  },

  selectCustomer(id, phone, name, email) {
    document.getElementById('custPhone').value = phone;
    document.getElementById('custName').value = name;
    const emailEl = document.getElementById('custEmail');
    if (emailEl && email) {
      emailEl.value = email;
    }
    document.getElementById('custPhoneDropdown').classList.add('hidden');
    App.toast(`Customer: ${name || phone}`, 1500);
  },

  addNewCustomerFromPOS() {
    const phone = document.getElementById('custPhone').value.trim();
    if (!phone) return;

    const dropdown = document.getElementById('custPhoneDropdown');
    const existingName = document.getElementById('custName').value.trim();
    // Replace dropdown content with inline name entry form
    dropdown.innerHTML = `
      <div class="p-3">
        <div class="flex items-center gap-2 mb-3">
          <div class="w-8 h-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-sm font-bold">+</div>
          <div>
            <div class="text-sm font-bold text-gray-800">New Customer</div>
            <div class="text-xs text-gray-500">${esc(phone)}</div>
          </div>
        </div>
        <label class="text-xs font-semibold text-gray-600 mb-1 block">Customer Name *</label>
        <input id="quickCustName" type="text" placeholder="Type customer name here..." value="${esc(existingName)}"
          class="w-full px-3 py-2.5 border-2 border-teal-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-400 focus:border-teal-400 focus:outline-none mb-3 bg-teal-50" />
        <div class="flex gap-2">
          <button id="btnQuickCustSave" onclick="POS.saveQuickCustomer()" disabled
            class="flex-1 bg-teal-500 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-teal-600 transition disabled:opacity-40 disabled:cursor-not-allowed">
            Save Customer
          </button>
          <button onclick="document.getElementById('custPhoneDropdown').classList.add('hidden')"
            class="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 transition">
            Cancel
          </button>
        </div>
      </div>`;

    // Focus the name input + enable Save only when name is entered
    setTimeout(() => {
      const nameInput = document.getElementById('quickCustName');
      const saveBtn = document.getElementById('btnQuickCustSave');
      if (nameInput) {
        nameInput.focus();
        nameInput.select();
        // Enable/disable save button based on name input
        const toggleSave = () => {
          if (saveBtn) saveBtn.disabled = !nameInput.value.trim();
        };
        toggleSave();
        nameInput.oninput = toggleSave;
        nameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && nameInput.value.trim()) { e.preventDefault(); POS.saveQuickCustomer(); }
          if (e.key === 'Escape') { dropdown.classList.add('hidden'); }
        });
      }
    }, 50);
  },

  async saveQuickCustomer() {
    const phone = document.getElementById('custPhone').value.trim();
    const name = (document.getElementById('quickCustName')?.value || '').trim();
    const dropdown = document.getElementById('custPhoneDropdown');

    if (!phone) return;

    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name }),
      });
      const data = await res.json();
      if (res.ok) {
        // Auto-fill the name field on POS
        if (name) document.getElementById('custName').value = name;
        App.toast(`Customer ${name || phone} saved`, 1500);
        this._customerCache = [];
      } else if (data.error && data.error.includes('already exists')) {
        App.toast('Customer already exists', 1500);
      } else {
        App.toast(data.error || 'Could not save customer');
      }
    } catch (e) {
      App.toast('Customer will be saved on checkout', 1500);
    }

    dropdown.classList.add('hidden');
  },

  // ========== Cash Payment Modal ==========

  showCashPayModal() {
    const total = this.getTotal();
    const modal = document.getElementById('cashPayModal');
    if (!modal) { this.completeSale(); return; }

    // Set the total display
    document.getElementById('cashModalTotal').textContent = App.currency(total);

    // Reset input
    const input = document.getElementById('cashTendered');
    if (input) { input.value = ''; }

    // Build quick cash buttons
    const quickBtns = document.getElementById('quickCashBtns');
    if (quickBtns) {
      const amounts = this.getQuickCashAmounts(total);
      quickBtns.innerHTML = amounts.map(amt =>
        `<button onclick="POS.setTendered(${amt})"
          class="py-2.5 bg-gray-100 hover:bg-green-100 text-gray-800 hover:text-green-800 rounded-lg text-sm font-bold border border-gray-200 hover:border-green-300 transition">
          ₹${amt.toLocaleString('en-IN')}
        </button>`
      ).join('');
    }

    // Reset change display
    this.updateCashModal();

    // Confirm button
    document.getElementById('btnCashConfirm').onclick = () => {
      modal.classList.add('hidden');
      POS.completeSale();
    };

    // Show modal
    modal.classList.remove('hidden');

    // Focus the input after a short delay
    setTimeout(() => { input?.focus(); }, 100);
  },

  getQuickCashAmounts(total) {
    const amounts = [];
    // Exact amount first
    amounts.push(Math.ceil(total));
    // Round-up denominations
    const roundUp = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    for (const d of roundUp) {
      if (d > total && amounts.length < 8) {
        amounts.push(d);
      }
    }
    return amounts;
  },

  setTendered(amount) {
    const input = document.getElementById('cashTendered');
    if (input) {
      input.value = amount;
      this.updateCashModal();
    }
  },

  updateCashModal() {
    const input = document.getElementById('cashTendered');
    const display = document.getElementById('changeAmount');
    const box = document.getElementById('cashChangeBox');
    const confirmBtn = document.getElementById('btnCashConfirm');
    if (!input || !display) return;

    const tendered = parseFloat(input.value) || 0;
    const total = this.getTotal();
    const change = tendered - total;

    if (tendered === 0) {
      display.textContent = '₹0.00';
      display.className = 'text-3xl font-bold text-gray-400';
      if (box) { box.className = 'rounded-xl p-4 text-center bg-gray-50 border-2 border-dashed border-gray-200'; }
      if (confirmBtn) { confirmBtn.disabled = true; }
    } else if (change >= 0) {
      display.textContent = App.currency(change);
      display.className = 'text-3xl font-bold text-green-600';
      if (box) { box.className = 'rounded-xl p-4 text-center bg-green-50 border-2 border-green-300'; }
      if (confirmBtn) { confirmBtn.disabled = false; }
    } else {
      display.textContent = `-${App.currency(Math.abs(change))}`;
      display.className = 'text-3xl font-bold text-red-600';
      if (box) { box.className = 'rounded-xl p-4 text-center bg-red-50 border-2 border-red-300'; }
      if (confirmBtn) { confirmBtn.disabled = true; }
    }
  },

  updateTaxLabel() {
    const label = document.getElementById('taxLabel');
    if (label) {
      label.textContent = `${App.taxName()} (${App.settings.tax_rate || 0}%):`;
    }
  },

  async updateHeldBadge() {
    try {
      const res = await fetch('/api/held');
      const held = await res.json();
      const badge = document.getElementById('heldBadge');
      if (held.length > 0) {
        badge.textContent = held.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    } catch (e) { /* ignore */ }
  },

  bindEvents() {
    // Search (filters product grid on right)
    let debounce;
    const searchHandler = () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        await this.loadProducts();
        this.renderProducts();
      }, 250);
    };
    document.getElementById('posSearch')?.addEventListener('input', searchHandler);

    // Barcode scanner (Enter key in search)
    document.getElementById('posSearch')?.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await this.loadProducts();
        this.renderProducts();
        if (this.products.length === 1 && this.products[0].quantity > 0) {
          this.addToCart(this.products[0]);
          document.getElementById('posSearch').value = '';
          await this.loadProducts();
          this.renderProducts();
        }
      }
    });

    // Stock Code — typeahead search by name or SKU
    this._skuSearchDebounce = null;
    const skuInput = document.getElementById('posSkuInput');
    const skuDropdown = document.getElementById('posSkuDropdown');

    if (skuInput) {
      skuInput.addEventListener('input', () => {
        clearTimeout(this._skuSearchDebounce);
        this._skuSearchDebounce = setTimeout(() => this._searchSkuTypeahead(), 200);
      });

      skuInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          // Select the first result if dropdown is showing
          const first = skuDropdown?.querySelector('.sku-result-item');
          if (first) { first.click(); }
        } else if (e.key === 'Escape') {
          skuDropdown?.classList.add('hidden');
        }
      });

      // Hide dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!skuInput.contains(e.target) && !skuDropdown?.contains(e.target)) {
          skuDropdown?.classList.add('hidden');
        }
      });
    }

    // "Add" button — still works for exact SKU entry
    document.getElementById('btnAddSku').onclick = async () => {
      const query = skuInput?.value?.trim();
      if (!query) return;
      // Try exact SKU first
      try {
        const res = await fetch(`/api/inventory/${encodeURIComponent(query)}`);
        if (res.ok) {
          const product = await res.json();
          this.addToCart(product);
          skuInput.value = '';
          skuDropdown?.classList.add('hidden');
          return;
        }
      } catch (e) { /* fall through */ }
      // If not exact SKU, pick first match from search
      const first = skuDropdown?.querySelector('.sku-result-item');
      if (first) { first.click(); }
      else { App.toast('Product not found'); }
    };

    // Category filters (both dropdowns sync)
    document.getElementById('posCategoryFilter')?.addEventListener('change', async () => {
      const val = document.getElementById('posCategoryFilter').value;
      document.getElementById('posCatQuick').value = val;
      await this.loadProducts();
      this.renderProducts();
    });
    document.getElementById('posCatQuick')?.addEventListener('change', async () => {
      const val = document.getElementById('posCatQuick').value;
      document.getElementById('posCategoryFilter').value = val;
      await this.loadProducts();
      this.renderProducts();
    });

    // Customer phone lookup
    const custPhoneInput = document.getElementById('custPhone');
    if (custPhoneInput) {
      let custDebounce;
      custPhoneInput.oninput = () => {
        clearTimeout(custDebounce);
        custDebounce = setTimeout(() => POS.lookupCustomer(), 300);
      };
      custPhoneInput.addEventListener('focus', () => {
        if (custPhoneInput.value.trim().length >= 3) POS.lookupCustomer();
      });
      // Prevent clicks inside dropdown from bubbling (so close handler doesn't fire)
      const ddEl = document.getElementById('custPhoneDropdown');
      if (ddEl) {
        ddEl.addEventListener('mousedown', (e) => e.stopPropagation());
        ddEl.addEventListener('click', (e) => e.stopPropagation());
      }
      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        const dd = document.getElementById('custPhoneDropdown');
        if (dd && e.target.id !== 'custPhone') {
          dd.classList.add('hidden');
        }
      });
    }

    // Payment method — use onclick to prevent stacking on re-init
    document.querySelectorAll('.pay-method-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.pay-method-btn').forEach(b => b.classList.remove('active-pay'));
        btn.classList.add('active-pay');
        POS.paymentMethod = btn.dataset.pay;

        // If UPI is selected and cart has items, show QR immediately
        if (btn.dataset.pay === 'UPI' && POS.cart.length > 0) {
          POS.showUpiQR();
        }
      };
    });

    // Complete Sale (Pay button) — use onclick to avoid duplicate listeners
    document.getElementById('btnCompleteSale').onclick = () => {
      if (POS.cart.length === 0) return;
      if (POS.paymentMethod === 'UPI') {
        // UPI — show QR modal first
        POS.showUpiQR();
      } else if (POS.paymentMethod === 'Cash') {
        // Cash — show cash payment modal for change calculation
        POS.showCashPayModal();
      } else {
        // Card / Other — complete directly
        POS.completeSale();
      }
    };

    // Clear Cart (Cancel)
    document.getElementById('btnClearCart').onclick = async () => {
      if (POS.cart.length === 0) return;
      const ok = await App.confirm('Clear the entire cart?');
      if (ok) {
        POS.cart = [];
        POS.saveCart();
        POS.updateCartUI();
      }
    };

    // Cash tendered input — live change calculation in modal
    const cashInput = document.getElementById('cashTendered');
    if (cashInput) {
      cashInput.oninput = () => POS.updateCashModal();
    }

    // Hold (Suspend)
    document.getElementById('btnHoldSale').onclick = () => POS.holdSale();

    // Recall
    document.getElementById('btnRecallSale').onclick = () => POS.showHeld();

    // Generate Quote
    document.getElementById('btnGenerateQuote').onclick = () => POS.generateQuote();

    // UPI modal buttons — use onclick to avoid duplicate listeners on re-init
    document.getElementById('btnUpiPaymentDone').onclick = () => {
      document.getElementById('upiModal').classList.add('hidden');
      POS.completeSale();
    };
    document.getElementById('btnUpiCancel').onclick = () => {
      document.getElementById('upiModal').classList.add('hidden');
    };
    document.getElementById('upiModalClose').onclick = () => {
      document.getElementById('upiModal').classList.add('hidden');
    };
  },

  // --- UPI QR Code ---

  showUpiQR() {
    const upiId = App.settings.upi_id;
    const upiName = App.settings.upi_name || App.settings.store_name || 'Store';

    if (!upiId) {
      App.toast('UPI ID not configured. Go to Settings to add your UPI ID.');
      return;
    }

    if (POS.cart.length === 0) {
      App.toast('Cart is empty');
      return;
    }

    const total = POS.getTotal();
    const sym = App._currSym();

    // Build UPI deep link URI
    const txnNote = 'Payment to ' + upiName;
    const upiUri = 'upi://pay?pa=' + encodeURIComponent(upiId)
      + '&pn=' + encodeURIComponent(upiName)
      + '&am=' + total.toFixed(2)
      + '&cu=INR'
      + '&tn=' + encodeURIComponent(txnNote);

    // Update display
    document.getElementById('upiAmount').textContent = sym + total.toFixed(2);
    document.getElementById('upiIdDisplay').textContent = upiId;
    document.getElementById('upiNameDisplay').textContent = upiName;

    // Generate QR code using qrcodejs library (new QRCode(el, opts))
    const qrContainer = document.getElementById('upiQrCanvas');
    qrContainer.innerHTML = '';

    try {
      new QRCode(qrContainer, {
        text: upiUri,
        width: 220,
        height: 220,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (err) {
      console.error('QR generation failed:', err);
      qrContainer.innerHTML = '<p class="text-red-500 text-sm py-4">QR generation failed. Check console.</p>';
    }

    // Show the modal
    document.getElementById('upiModal').classList.remove('hidden');
  },

  async completeSale() {
    if (this.cart.length === 0) return;

    const subtotal = this.getSubtotal();
    const totalDiscount = this.getTotalDiscount();
    const tax = this.getTax();
    const total = this.getTotal();

    const sale = {
      items: this.cart.map(c => {
        const disc = this.getItemDiscount(c);
        return {
          sku: c.sku,
          name: c.name,
          quantity: c.quantity,
          unit_price: c.price,
          line_total: c.price * c.quantity,
          discount_type: c.discountType,
          discount_value: c.discountValue,
          discount_amount: Math.round(disc * 100) / 100,
          final_total: Math.round((c.price * c.quantity - disc) * 100) / 100,
        };
      }),
      subtotal: Math.round(subtotal * 100) / 100,
      discount_amount: Math.round(totalDiscount * 100) / 100,
      tax_amount: Math.round(tax * 100) / 100,
      grand_total: Math.round(total * 100) / 100,
      payment_method: this.paymentMethod,
      cashier: App.settings.cashier_name || 'Staff',
      customer_name: document.getElementById('custName')?.value || '',
      customer_phone: document.getElementById('custPhone')?.value || '',
      customer_email: document.getElementById('custEmail')?.value || '',
    };

    // --- Offline detection: queue sale if no network ---
    if (!navigator.onLine && typeof OfflineStore !== 'undefined') {
      await this._queueOfflineSale(sale);
      return;
    }

    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sale),
      });
      const data = await res.json();

      if (!res.ok) {
        // Stock validation failed — show details
        if (data.details && data.details.length > 0) {
          App.toast(data.details[0], 4000);
        } else {
          App.toast(data.error || 'Sale failed!', 3000);
        }
        return;
      }

      App.toast('Sale completed!');
      this.showReceipt(data.sale);

      // Reset cart + clear localStorage
      this.cart = [];
      this.saveCart();
      this.updateCartUI();
      document.getElementById('custName').value = '';
      document.getElementById('custPhone').value = '';
      document.getElementById('custEmail').value = '';
      this._customerCache = []; // Clear cache so auto-created customer appears next time

      await this.loadProducts();
      this.renderProducts();
    } catch (e) {
      // Network error — queue the sale offline
      if (typeof OfflineStore !== 'undefined') {
        await this._queueOfflineSale(sale);
      } else {
        App.toast('Sale failed!');
      }
    }
  },

  // --- Offline Sale Queuing ---

  async _queueOfflineSale(sale) {
    try {
      sale.timestamp = new Date().toISOString();
      const localId = await OfflineStore.queueSale(sale);

      // Decrement local stock cache so quantities stay accurate
      for (const item of sale.items) {
        if (item.sku) {
          await OfflineStore.decrementStock(item.sku, item.quantity);
        }
      }

      App.toast('Sale queued — will sync when online', 3500);

      // Reset cart
      this.cart = [];
      this.saveCart();
      this.updateCartUI();
      document.getElementById('custName').value = '';
      document.getElementById('custPhone').value = '';
      document.getElementById('custEmail').value = '';

      // Reload products from cache (with decremented stock)
      await this.loadProducts();
      this.renderProducts();

      // Update pending badge
      if (typeof App !== 'undefined' && App.updatePendingBadge) {
        App.updatePendingBadge();
      }
    } catch (err) {
      console.error('[POS] Failed to queue offline sale:', err);
      App.toast('Failed to save sale offline!', 3000);
    }
  },

  // --- Quote Generation (A4 PDF-style) ---

  generateQuote() {
    if (this.cart.length === 0) {
      App.toast('Add items to cart before generating a quote');
      return;
    }

    const s = App.settings;
    const sym = App._currSym();
    const taxRate = parseFloat(s.tax_rate || 0);
    const taxName = App.taxName ? App.taxName() : `GST (${taxRate}%)`;

    // Generate quote number
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const quoteNum = `QT-${dateStr}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    // Customer info from POS fields
    const custName = document.getElementById('custName')?.value || '';
    const custPhone = document.getElementById('custPhone')?.value || '';
    const custEmail = document.getElementById('custEmail')?.value || '';

    // Calculate totals
    const subtotal = this.getSubtotal();
    const totalDiscount = this.getTotalDiscount();
    const tax = this.getTax();
    const grandTotal = this.getTotal();

    // Build item rows
    const itemRows = this.cart.map((c, idx) => {
      const lineTotal = c.price * c.quantity;
      const disc = this.getItemDiscount(c);
      const finalTotal = lineTotal - disc;
      const itemTax = finalTotal * (taxRate / 100);
      const itemGross = finalTotal + itemTax;
      const hasDiscount = c.discountType !== 'none' && disc > 0;

      return `
        <tr style="${idx % 2 === 0 ? '' : 'background:#f8fafc;'}">
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#6b7280;font-size:13px;">${idx + 1}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">
            <div style="font-weight:600;color:#1f2937;font-size:13px;">${esc(c.name)}</div>
            <div style="font-size:11px;color:#9ca3af;">${esc(c.barcode || c.sku)}</div>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:13px;">${c.quantity}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:13px;">${App.currency(c.price)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:13px;">
            ${hasDiscount ? `<span style="color:#ef4444;font-size:11px;">-${App.currency(disc)}</span>` : '—'}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:13px;">${App.currency(itemTax)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:13px;">${App.currency(itemGross)}</td>
        </tr>`;
    }).join('');

    // Format date nicely
    const formattedDate = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const validUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const html = `
      <div class="quote-a4" style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#1f2937;line-height:1.5;">

        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:20px;border-bottom:3px solid #4f46e5;">
          <div style="display:flex;align-items:center;gap:16px;">
            <img src="/static/img/logo.svg" alt="NLF" style="width:64px;height:64px;border-radius:10px;" />
            <div>
              <div style="font-size:22px;font-weight:800;color:#1f2937;letter-spacing:0.5px;">${esc(s.store_name || 'Next Level Furniture')}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:2px;">${esc(s.address || '')}</div>
              <div style="font-size:12px;color:#6b7280;">${esc(s.phone || '')}${s.email ? ' | ' + esc(s.email) : ''}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:28px;font-weight:800;color:#4f46e5;letter-spacing:1px;">QUOTATION</div>
            <div style="font-size:12px;color:#6b7280;margin-top:4px;">
              <strong>Quote #:</strong> ${esc(quoteNum)}<br/>
              <strong>Date:</strong> ${formattedDate}<br/>
              <strong>Valid Until:</strong> ${validUntil}
            </div>
          </div>
        </div>

        <!-- Customer Info -->
        ${custName || custPhone ? `
        <div style="background:#f0f4ff;border:1px solid #c7d2fe;border-radius:8px;padding:14px 18px;margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;color:#4f46e5;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Quotation For</div>
          ${custName ? `<div style="font-size:15px;font-weight:700;color:#1f2937;">${esc(custName)}</div>` : ''}
          ${custPhone ? `<div style="font-size:13px;color:#6b7280;">Phone: ${esc(custPhone)}</div>` : ''}
          ${custEmail ? `<div style="font-size:13px;color:#6b7280;">Email: ${esc(custEmail)}</div>` : ''}
        </div>
        ` : ''}

        <!-- Items Table -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <thead>
            <tr style="background:#4f46e5;color:#fff;">
              <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;width:40px;">#</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Item Description</th>
              <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;width:50px;">Qty</th>
              <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;width:90px;">Unit Price</th>
              <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;width:80px;">Discount</th>
              <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;width:80px;">${esc(taxName.replace(/\(.*/, '').trim())}</th>
              <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;width:100px;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>

        <!-- Totals -->
        <div style="display:flex;justify-content:flex-end;margin-bottom:30px;">
          <div style="width:300px;">
            <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;">
              <span style="color:#6b7280;">Subtotal</span>
              <span style="font-weight:600;">${App.currency(subtotal)}</span>
            </div>
            ${totalDiscount > 0 ? `
            <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#ef4444;">
              <span>Total Discount</span>
              <span style="font-weight:600;">-${App.currency(totalDiscount)}</span>
            </div>` : ''}
            <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;">
              <span style="color:#6b7280;">${esc(taxName)} (${taxRate}%)</span>
              <span style="font-weight:600;">${App.currency(tax)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:12px 0;font-size:18px;font-weight:800;border-top:2px solid #4f46e5;margin-top:6px;">
              <span style="color:#4f46e5;">TOTAL</span>
              <span style="color:#4f46e5;">${App.currency(grandTotal)}</span>
            </div>
          </div>
        </div>

        <!-- Amount in Words -->
        <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:10px 16px;margin-bottom:24px;font-size:12px;">
          <strong>Amount in Words:</strong> ${esc(POS.numberToWords(Math.round(grandTotal)))} Rupees Only
        </div>

        <!-- Terms & Conditions -->
        <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:auto;">
          <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:8px;">Terms & Conditions</div>
          <ol style="font-size:11px;color:#6b7280;margin:0;padding-left:16px;line-height:1.8;">
            <li>This quotation is valid for 7 days from the date of issue.</li>
            <li>Prices are inclusive of ${esc(taxName.replace(/\(.*/, '').trim())} as applicable.</li>
            <li>Delivery charges, if any, will be communicated separately.</li>
            <li>Payment terms: Full payment at the time of purchase.</li>
            <li>Product availability is subject to stock at the time of order confirmation.</li>
          </ol>
        </div>

        <!-- Footer -->
        <div style="text-align:center;margin-top:30px;padding-top:16px;border-top:1px solid #e5e7eb;">
          <div style="font-size:12px;color:#6b7280;">Thank you for your interest in ${esc(s.store_name || 'our products')}!</div>
          <div style="font-size:11px;color:#9ca3af;margin-top:4px;">${esc(s.phone || '')}${s.email ? ' | ' + esc(s.email) : ''}</div>
        </div>
      </div>
    `;

    // Show in modal
    document.getElementById('quoteContent').innerHTML = html;
    document.getElementById('quoteModal').classList.remove('hidden');

    // Print handler
    document.getElementById('btnPrintQuote').onclick = () => {
      const printArea = document.getElementById('quotePrintArea');
      printArea.innerHTML = html;
      printArea.classList.remove('hidden');
      setTimeout(() => {
        window.print();
        printArea.classList.add('hidden');
      }, 200);
    };

    // Close handler
    document.getElementById('quoteModalClose').onclick = () => {
      document.getElementById('quoteModal').classList.add('hidden');
    };
  },

  // --- Number to Words (Indian format) ---
  numberToWords(num) {
    if (num === 0) return 'Zero';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function convert(n) {
      if (n < 20) return ones[n];
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
      if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
      if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
      if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
      return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
    }

    return convert(Math.abs(Math.round(num)));
  },

  showReceipt(sale) {
    const s = App.settings;
    const sym = App._currSym();

    // Build item rows with per-item discount info
    const itemRows = sale.items.map(i => {
      const hasDisc = i.discount_amount && i.discount_amount > 0;
      return `
        <tr>
          <td class="item-name-cell">${esc(i.name)}</td>
          <td>${i.quantity}</td>
          <td>${App.currency(i.unit_price)}</td>
          <td>
            ${hasDisc ? `<span style="text-decoration:line-through;color:#999;font-size:10px">${App.currency(i.line_total)}</span><br/>` : ''}
            ${App.currency(i.final_total || i.line_total)}
          </td>
        </tr>
        ${hasDisc ? `<tr><td colspan="4" style="font-size:9px;color:#e74c3c;padding:0 0 4px 8px;">↳ Discount: -${App.currency(i.discount_amount)} ${i.discount_type === 'percent' ? '(' + i.discount_value + '% off)' : '(' + sym + i.discount_value + ' off)'}</td></tr>` : ''}`;
    }).join('');

    const isVoided = (sale.status || 'Complete') === 'Voided';
    const voidBanner = isVoided ? `
      <div style="background:#dc2626;color:#fff;text-align:center;padding:8px;font-weight:bold;font-size:14px;letter-spacing:2px;border-radius:6px;margin-bottom:8px;">
        ✕ VOIDED ✕
        ${sale.voided_at ? `<div style="font-size:10px;font-weight:normal;margin-top:2px;">Voided on ${new Date(sale.voided_at).toLocaleString()}</div>` : ''}
        ${sale.void_reason ? `<div style="font-size:10px;font-weight:normal;">Reason: ${esc(sale.void_reason)}</div>` : ''}
      </div>` : '';

    const html = `
      <div class="receipt">
        ${voidBanner}
        <div class="receipt-header">
          <img src="/static/img/logo.svg" alt="NLF" style="width:64px;height:64px;margin:0 auto 6px;display:block;border-radius:10px;" />
          <div class="store-name">${esc(s.store_name || 'Store')}</div>
          <div class="store-info">${esc(s.address || '')}</div>
          <div class="store-info">${esc(s.phone || '')} ${s.email ? '| ' + esc(s.email) : ''}</div>
        </div>
        <hr class="receipt-divider" />
        <div class="receipt-meta">
          <span><strong>Receipt:</strong> ${esc(sale.receipt_number)}</span>
          <span><strong>Date:</strong> ${esc(new Date(sale.timestamp).toLocaleString())}</span>
          <span><strong>Cashier:</strong> ${esc(sale.cashier)}</span>
          ${sale.customer_name ? `<span><strong>Customer:</strong> ${esc(sale.customer_name)} ${esc(sale.customer_phone || '')}</span>` : ''}
        </div>
        <hr class="receipt-divider" />
        <table class="receipt-items">
          <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <hr class="receipt-divider" />
        <div class="receipt-totals">
          <div class="total-row"><span>Subtotal</span><span>${App.currency(sale.subtotal)}</span></div>
          ${sale.discount_amount > 0 ? `<div class="total-row" style="color:#e74c3c"><span>Total Discount</span><span>-${App.currency(sale.discount_amount)}</span></div>` : ''}
          <div class="total-row"><span>${App.taxName()} (${s.tax_rate || 0}%)</span><span>${App.currency(sale.tax_amount)}</span></div>
          <div class="total-row grand-total"><span>TOTAL</span><span>${App.currency(sale.grand_total)}</span></div>
          <div class="total-row" style="margin-top:4px"><span>Paid via</span><span>${sale.payment_method}</span></div>
        </div>
        <div class="receipt-barcode"><svg id="receiptBarcode"></svg></div>
        <hr class="receipt-divider" />
        <div class="receipt-footer">${esc(s.receipt_footer || 'Thank you!')}</div>
      </div>
    `;

    document.getElementById('receiptContent').innerHTML = html;
    document.getElementById('receiptModal').classList.remove('hidden');

    setTimeout(() => {
      try {
        JsBarcode('#receiptBarcode', sale.receipt_number, {
          format: 'CODE128', width: 1.5, height: 30, displayValue: true, fontSize: 10, margin: 4
        });
      } catch (e) { /* ignore */ }
    }, 50);

    document.getElementById('btnPrintReceipt').onclick = () => {
      const printArea = document.getElementById('receiptPrintArea');
      printArea.innerHTML = html;
      printArea.classList.remove('hidden');
      setTimeout(() => {
        window.print();
        printArea.classList.add('hidden');
      }, 100);
    };

    // WhatsApp button — store the current sale for WhatsApp sending
    this._currentReceiptSale = sale;
    document.getElementById('btnWhatsAppReceipt').onclick = () => this.openWhatsAppModal(sale);

    // Void button — show only for non-voided, completed sales (admin/manager)
    const voidBtn = document.getElementById('btnVoidSale');
    if (voidBtn) {
      const isVoided = (sale.status || 'Complete') === 'Voided';
      const userRole = (App.userRole || '').toLowerCase();
      const canVoid = !isVoided && (userRole === 'admin' || userRole === 'manager');
      voidBtn.classList.toggle('hidden', !canVoid);
      voidBtn.onclick = canVoid ? () => {
        const reason = prompt('Reason for voiding this sale (optional):');
        if (reason === null) return;
        if (!confirm(`Void sale ${sale.receipt_number}?\nInventory will be restored.`)) return;
        fetch(`/api/sales/${encodeURIComponent(sale.receipt_number)}/void`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason || '' }),
        }).then(r => r.json()).then(data => {
          if (data.success) {
            App.toast(data.message || 'Sale voided');
            document.getElementById('receiptModal').classList.add('hidden');
            // Refresh transactions if on that page
            if (typeof Transactions !== 'undefined' && Transactions.allSales.length > 0) {
              Transactions.loadSales().then(() => Transactions.applyFilters());
            }
          } else {
            App.toast(data.error || 'Failed to void sale');
          }
        }).catch(() => App.toast('Failed to void sale'));
      } : null;
    }
  },

  // --- WhatsApp Receipt ---

  formatReceiptText(sale) {
    const s = App.settings;
    const sym = App._currSym();

    let text = `*${s.store_name || 'Store'}*\n`;
    text += `${s.phone || ''}\n\n`;
    text += `Receipt: ${sale.receipt_number}\n`;
    text += `Date: ${new Date(sale.timestamp).toLocaleString()}\n`;
    if (sale.customer_name) {
      text += `Customer: ${sale.customer_name}\n`;
    }
    text += `\n`;

    sale.items.forEach((i, idx) => {
      const hasDisc = i.discount_amount && i.discount_amount > 0;
      const total = hasDisc ? (i.final_total || i.line_total) : i.line_total;
      text += `${idx + 1}. ${i.name}`;
      text += `\n   ${i.quantity} x ${sym}${i.unit_price}`;
      if (hasDisc) {
        text += ` (-${sym}${i.discount_amount})`;
      }
      text += ` = *${sym}${total}*\n`;
    });

    text += `\n`;
    if (sale.discount_amount > 0) {
      text += `Discount: -${sym}${sale.discount_amount}\n`;
    }
    text += `${s.tax_name || 'GST'}: ${sym}${sale.tax_amount}\n`;
    text += `*TOTAL: ${sym}${sale.grand_total}*\n`;
    text += `Paid: ${sale.payment_method}\n\n`;
    text += `Thank you for shopping at ${s.store_name || 'our store'}!`;

    return text;
  },

  openWhatsAppModal(sale) {
    const modal = document.getElementById('whatsappModal');
    const phoneInput = document.getElementById('waCustomerPhone');

    // Pre-fill with customer phone if available (strip non-digits)
    const custPhone = (sale.customer_phone || '').replace(/[^0-9]/g, '');
    phoneInput.value = custPhone;

    modal.classList.remove('hidden');

    // Send to customer
    document.getElementById('btnWaSendCustomer').onclick = () => {
      const phone = phoneInput.value.replace(/[^0-9]/g, '');
      if (!phone || phone.length < 10) {
        App.toast('Please enter a valid phone number');
        return;
      }
      // Ensure 91 prefix for Indian numbers
      const fullPhone = phone.length === 10 ? '91' + phone : phone;
      this.sendToWhatsApp(fullPhone, sale);
      modal.classList.add('hidden');
    };

    // Send to store WhatsApp
    document.getElementById('btnWaSendStore').onclick = () => {
      const storePhone = (App.settings.whatsapp_number || '').replace(/[^0-9]/g, '');
      if (!storePhone) {
        App.toast('Store WhatsApp number not configured in Settings');
        return;
      }
      this.sendToWhatsApp(storePhone, sale);
      modal.classList.add('hidden');
    };

    // Cancel
    document.getElementById('btnWaCancel').onclick = () => {
      modal.classList.add('hidden');
    };
  },

  sendToWhatsApp(phone, sale) {
    const text = this.formatReceiptText(sale);
    const encoded = encodeURIComponent(text);

    // Use WhatsApp Web on desktop, wa.me on mobile
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const baseUrl = isMobile
      ? `https://wa.me/${phone}`
      : `https://web.whatsapp.com/send?phone=${phone}`;

    const url = `${baseUrl}${isMobile ? '?' : '&'}text=${encoded}`;
    window.open(url, '_blank');
    App.toast('Opening WhatsApp...');
  },

  async holdSale() {
    if (this.cart.length === 0) { App.toast('Nothing to hold'); return; }

    const holdData = {
      items: this.cart.map(c => ({ ...c })),  // clone with discount info preserved
      customer_name: document.getElementById('custName')?.value || '',
      customer_phone: document.getElementById('custPhone')?.value || '',
      customer_email: document.getElementById('custEmail')?.value || '',
    };

    try {
      await fetch('/api/held', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(holdData),
      });
      App.toast('Sale suspended');
      this.cart = [];
      this.saveCart();
      this.updateCartUI();
      this.updateHeldBadge();
    } catch (e) {
      App.toast('Hold failed');
    }
  },

  async showHeld() {
    const modal = document.getElementById('heldModal');
    const list = document.getElementById('heldList');

    try {
      const res = await fetch('/api/held');
      const held = await res.json();

      if (held.length === 0) {
        list.innerHTML = '<p class="text-gray-400 text-sm">No held transactions</p>';
      } else {
        list.innerHTML = held.map(h => {
          const total = h.items.reduce((s, i) => {
            const lineTotal = i.price * i.quantity;
            let disc = 0;
            if (i.discountType === 'percent') disc = lineTotal * Math.min(i.discountValue || 0, 100) / 100;
            else if (i.discountType === 'flat') disc = Math.min(i.discountValue || 0, lineTotal);
            return s + (lineTotal - disc);
          }, 0);
          const itemCount = h.items.reduce((s, i) => s + i.quantity, 0);
          return `
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <div>
                <div class="text-sm font-medium">${esc(h.customer_name || 'Walk-in')} — ${itemCount} items</div>
                <div class="text-xs text-gray-400">${App.currency(total)} | Held at ${esc(new Date(h.held_at).toLocaleTimeString())}</div>
              </div>
              <div class="flex gap-2">
                <button onclick="POS.recallHeld('${esc(h.hold_id)}')" class="bg-brand-600 text-white px-3 py-1 rounded-lg text-xs hover:bg-brand-700">Recall</button>
                <button onclick="POS.deleteHeld('${esc(h.hold_id)}')" class="bg-red-100 text-red-600 px-3 py-1 rounded-lg text-xs hover:bg-red-200">Delete</button>
              </div>
            </div>`;
        }).join('');
      }

      modal.classList.remove('hidden');
    } catch (e) {
      App.toast('Failed to load held transactions');
    }
  },

  async recallHeld(holdId) {
    try {
      const res = await fetch('/api/held');
      const held = await res.json();
      const tx = held.find(h => h.hold_id === holdId);
      if (tx) {
        this.cart = tx.items;
        if (tx.customer_name) document.getElementById('custName').value = tx.customer_name;
        if (tx.customer_phone) document.getElementById('custPhone').value = tx.customer_phone;
        if (tx.customer_email) document.getElementById('custEmail').value = tx.customer_email;
        // Refresh maxQty from current stock
        for (const item of this.cart) {
          const prod = this.products.find(p => p.sku === item.sku);
          if (prod) item.maxQty = prod.quantity;
        }
        this.updateCartUI();
        await fetch(`/api/held/${holdId}`, { method: 'DELETE' });
        this.updateHeldBadge();
        document.getElementById('heldModal').classList.add('hidden');
        App.toast('Sale recalled');
      }
    } catch (e) {
      App.toast('Recall failed');
    }
  },

  async deleteHeld(holdId) {
    try {
      await fetch(`/api/held/${holdId}`, { method: 'DELETE' });
      this.updateHeldBadge();
      this.showHeld();
    } catch (e) { /* ignore */ }
  },
};
