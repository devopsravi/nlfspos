/* ========================================
   Inventory Management Module
   ======================================== */

const Inventory = {
  products: [],
  editingSku: null,

  async init() {
    await this.loadProducts();
    this.loadCategories();
    this.render();
    this.bindEvents();
  },

  async loadProducts() {
    const params = new URLSearchParams();
    const q = document.getElementById('invSearch')?.value || '';
    const cat = document.getElementById('invCategoryFilter')?.value || '';
    const low = document.getElementById('invLowStock')?.checked || false;
    if (q) params.set('q', q);
    if (cat) params.set('category', cat);
    if (low) params.set('low_stock', 'true');

    try {
      const res = await fetch(`/api/inventory?${params}`);
      this.products = await res.json();
    } catch (e) {
      console.error('Failed to load inventory', e);
    }
  },

  async loadCategories() {
    try {
      const res = await fetch('/api/inventory/categories');
      const cats = await res.json();
      ['invCategoryFilter', 'posCategoryFilter'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">All Categories</option>' +
          cats.map(c => `<option value="${esc(c)}"${c === current ? ' selected' : ''}>${esc(c)}</option>`).join('');
      });
    } catch (e) { /* ignore */ }
  },

  render() {
    const tbody = document.getElementById('invTableBody');
    if (!tbody) return;

    if (this.products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="px-4 py-8 text-center text-gray-400">No products found</td></tr>';
      return;
    }

    tbody.innerHTML = this.products.map((p, idx) => {
      const isLow = p.quantity <= (p.reorder_level || 3);
      const cost = parseFloat(p.cost_price) || 0;
      const price = parseFloat(p.selling_price) || 0;
      const margin = price > 0 ? (((price - cost) / price) * 100).toFixed(1) : '0.0';
      const marginColor = parseFloat(margin) >= 40 ? 'text-green-600' : parseFloat(margin) >= 20 ? 'text-amber-600' : 'text-red-600';
      const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
      const safeSku = esc(p.sku);
      return `
        <tr class="${rowBg} hover:bg-blue-50 dark:hover:bg-gray-800 transition text-sm">
          <td class="px-4 py-2.5 font-mono text-xs text-gray-600">${safeSku}</td>
          <td class="px-4 py-2.5 font-medium text-gray-800 max-w-[220px] truncate">${esc(p.name)}</td>
          <td class="px-4 py-2.5 text-gray-600">${esc(p.category)}</td>
          <td class="px-4 py-2.5 text-right font-semibold ${isLow ? 'text-red-600' : 'text-gray-800'}">${p.quantity}</td>
          <td class="px-4 py-2.5 text-right text-gray-600">${App.currency(cost)}</td>
          <td class="px-4 py-2.5 text-right font-semibold text-gray-800">${App.currency(price)}</td>
          <td class="px-4 py-2.5 text-right font-semibold ${marginColor}">${margin}%</td>
          <td class="px-4 py-2.5 text-gray-600">${esc(p.supplier) || '—'}</td>
          <td class="px-4 py-2.5 text-right text-gray-500">${p.reorder_level || 0}</td>
          <td class="px-4 py-2.5"><span class="${isLow ? 'stock-low' : 'stock-ok'}">${isLow ? 'Low' : 'OK'}</span></td>
          <td class="px-4 py-2.5 text-center">
            <div class="flex items-center justify-center gap-1.5">
              <button onclick="Inventory.edit('${safeSku}')" class="w-7 h-7 rounded bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center" title="Edit">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button onclick="Inventory.delete('${safeSku}')" class="w-7 h-7 rounded bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center" title="Delete">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  },

  bindEvents() {
    // Search & filters
    const search = document.getElementById('invSearch');
    const catFilter = document.getElementById('invCategoryFilter');
    const lowStock = document.getElementById('invLowStock');

    let debounce;
    const reload = () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        await this.loadProducts();
        this.render();
      }, 300);
    };

    search?.addEventListener('input', reload);
    catFilter?.addEventListener('change', reload);
    lowStock?.addEventListener('change', reload);

    // Add product button
    document.getElementById('btnAddProduct')?.addEventListener('click', () => this.openModal());

    // Form submit
    document.getElementById('productForm')?.addEventListener('submit', (e) => this.handleSubmit(e));

    // Export
    document.getElementById('btnExportCSV')?.addEventListener('click', () => {
      window.location.href = '/api/inventory/export';
    });

    // Import
    document.getElementById('btnImportCSV')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch('/api/inventory/import', { method: 'POST', body: form });
        const data = await res.json();
        App.toast(`Imported ${data.added} products`);
        await this.loadProducts();
        this.render();
      } catch (err) {
        App.toast('Import failed');
      }
      e.target.value = '';
    });
  },

  openModal(product = null) {
    this.editingSku = product ? product.sku : null;
    const modal = document.getElementById('productModal');
    const title = document.getElementById('productModalTitle');
    const form = document.getElementById('productForm');

    title.textContent = product ? 'Edit Product' : 'Add Product';
    form.reset();

    if (product) {
      Object.keys(product).forEach(key => {
        const input = form.elements[key];
        if (input) input.value = product[key] ?? '';
      });
    }

    modal.classList.remove('hidden');
  },

  async handleSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });

    // Coerce numbers
    ['cost_price', 'selling_price', 'weight'].forEach(f => { data[f] = parseFloat(data[f]) || 0; });
    ['quantity', 'reorder_level'].forEach(f => { data[f] = parseInt(data[f]) || 0; });

    try {
      if (this.editingSku) {
        await fetch(`/api/inventory/${this.editingSku}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        App.toast('Product updated');
      } else {
        await fetch('/api/inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        App.toast('Product added');
      }

      document.getElementById('productModal').classList.add('hidden');
      await this.loadProducts();
      this.loadCategories();
      this.render();
    } catch (err) {
      App.toast('Failed to save product');
    }
  },

  async edit(sku) {
    try {
      const res = await fetch(`/api/inventory/${sku}`);
      const product = await res.json();
      this.openModal(product);
    } catch (e) {
      App.toast('Failed to load product');
    }
  },

  async delete(sku) {
    const ok = await App.confirm('Delete this product?');
    if (!ok) return;
    try {
      await fetch(`/api/inventory/${sku}`, { method: 'DELETE' });
      App.toast('Product deleted');
      await this.loadProducts();
      this.render();
    } catch (e) {
      App.toast('Failed to delete');
    }
  },
};
