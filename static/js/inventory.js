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
          <td class="inv-name-cell font-medium text-gray-800" title="${esc(p.name)}">${esc(p.name)}</td>
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
              <button onclick="Inventory.showHistory('${safeSku}')" class="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center" title="History">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
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

    // Pricing auto-calc (markup / margin / selling price)
    this.setupPriceCalc();

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

  setupPriceCalc() {
    const form = document.getElementById('productForm');
    if (!form) return;
    const costEl = form.elements['cost_price'];
    const sellingEl = form.elements['selling_price'];
    const markupEl = form.elements['markup_pct'];
    const marginEl = form.elements['margin_pct'];
    if (!costEl || !sellingEl || !markupEl || !marginEl) return;

    const recalcMargin = () => {
      const cost = parseFloat(costEl.value) || 0;
      const selling = parseFloat(sellingEl.value) || 0;
      if (selling > 0 && cost >= 0) {
        marginEl.value = (((selling - cost) / selling) * 100).toFixed(2);
      } else {
        marginEl.value = '';
      }
    };

    // When Markup % changes → update Selling Price + Margin
    markupEl.addEventListener('input', () => {
      const cost = parseFloat(costEl.value) || 0;
      const markup = parseFloat(markupEl.value);
      if (cost > 0 && !isNaN(markup)) {
        sellingEl.value = (cost * (1 + markup / 100)).toFixed(2);
      }
      recalcMargin();
    });

    // When Selling Price changes → update Markup + Margin
    sellingEl.addEventListener('input', () => {
      const cost = parseFloat(costEl.value) || 0;
      const selling = parseFloat(sellingEl.value) || 0;
      if (cost > 0 && selling > 0) {
        markupEl.value = (((selling - cost) / cost) * 100).toFixed(2);
      } else {
        markupEl.value = '';
      }
      recalcMargin();
    });

    // When Cost Price changes → recalc Selling Price from Markup, then Margin
    costEl.addEventListener('input', () => {
      const cost = parseFloat(costEl.value) || 0;
      const markup = parseFloat(markupEl.value);
      if (cost > 0 && !isNaN(markup) && markup > 0) {
        sellingEl.value = (cost * (1 + markup / 100)).toFixed(2);
      }
      recalcMargin();
    });
  },

  _populateMarkupMargin() {
    const form = document.getElementById('productForm');
    if (!form) return;
    const cost = parseFloat(form.elements['cost_price'].value) || 0;
    const selling = parseFloat(form.elements['selling_price'].value) || 0;
    if (cost > 0 && selling > 0) {
      form.elements['markup_pct'].value = (((selling - cost) / cost) * 100).toFixed(2);
      form.elements['margin_pct'].value = (((selling - cost) / selling) * 100).toFixed(2);
    } else {
      form.elements['markup_pct'].value = '';
      form.elements['margin_pct'].value = '';
    }
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
      this._populateMarkupMargin();
    }

    modal.classList.remove('hidden');
  },

  async handleSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = v; });

    // Remove calculated-only fields (not stored in DB)
    delete data.markup_pct;
    delete data.margin_pct;

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

  // =========================================================================
  // Stock History Modal
  // =========================================================================
  _shSku: null,
  _shChart: null,
  _shDetailData: [],
  _shDetailPage: 1,

  async showHistory(sku) {
    this._shSku = sku;
    const product = this.products.find(p => p.sku === sku);
    const name = product ? product.name : sku;

    document.getElementById('stockHistoryTitle').textContent = `Stock History — ${name}`;
    document.getElementById('stockHistoryModal').classList.remove('hidden');

    // Bind close
    document.getElementById('stockHistoryClose').onclick = () => {
      document.getElementById('stockHistoryModal').classList.add('hidden');
      if (this._shChart) { this._shChart.destroy(); this._shChart = null; }
    };

    // Bind tab switching
    document.querySelectorAll('.sh-tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.sh-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.querySelectorAll('.sh-panel').forEach(p => p.classList.add('hidden'));
        const panelId = 'shTab' + target.charAt(0).toUpperCase() + target.slice(1);
        document.getElementById(panelId)?.classList.remove('hidden');

        if (target === 'detail') this.loadHistoryDetail(sku);
        else if (target === 'stats') this.loadHistoryStats(sku);
        else if (target === 'purchase') this.loadHistoryPurchases(sku);
        else if (target === 'itemsales') this.loadHistorySales(sku);
      };
    });

    // Bind detail search
    document.getElementById('shDetailSearch').oninput = () => this._renderDetailTable();
    document.getElementById('shDetailPageSize').onchange = () => { this._shDetailPage = 1; this._renderDetailTable(); };

    // Bind purchase form
    this._bindPurchaseForm(sku);

    // Bind item sales export
    document.getElementById('shExportSalesCSV').onclick = () => this._exportSalesCSV(sku);

    // Default: show Detail tab
    document.querySelectorAll('.sh-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.sh-tab[data-tab="detail"]').classList.add('active');
    document.querySelectorAll('.sh-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('shTabDetail').classList.remove('hidden');
    this.loadHistoryDetail(sku);
  },

  // --- Detail Tab ---
  async loadHistoryDetail(sku) {
    try {
      const res = await fetch(`/api/inventory/${sku}/history`);
      this._shDetailData = await res.json();
    } catch (e) {
      this._shDetailData = [];
    }
    this._shDetailPage = 1;
    this._renderDetailTable();
  },

  _renderDetailTable() {
    const query = (document.getElementById('shDetailSearch')?.value || '').toLowerCase();
    const pageSize = parseInt(document.getElementById('shDetailPageSize')?.value || '10');
    let data = this._shDetailData;
    if (query) {
      data = data.filter(r => (r.action || '').toLowerCase().includes(query) || (r.description || '').toLowerCase().includes(query));
    }
    const total = data.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (this._shDetailPage > totalPages) this._shDetailPage = totalPages;
    const start = (this._shDetailPage - 1) * pageSize;
    const page = data.slice(start, start + pageSize);

    const tbody = document.getElementById('shDetailBody');
    if (page.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="px-3 py-6 text-center text-gray-400">No history records</td></tr>';
    } else {
      tbody.innerHTML = page.map(r => {
        const qtyClass = r.qty_change > 0 ? 'text-green-600' : r.qty_change < 0 ? 'text-red-600' : 'text-gray-400';
        const qtyLabel = r.qty_change > 0 ? `+${r.qty_change}` : r.qty_change;
        const dateStr = r.created ? new Date(r.created).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
        const actionBadge = this._actionBadge(r.action);
        return `<tr class="hover:bg-gray-50">
          <td class="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">${dateStr}</td>
          <td class="px-3 py-2">${actionBadge}</td>
          <td class="px-3 py-2 text-gray-700 text-xs">${esc(r.description || '')}</td>
          <td class="px-3 py-2 text-right font-semibold ${qtyClass}">${qtyLabel || '—'}</td>
        </tr>`;
      }).join('');
    }

    // Pagination
    const pag = document.getElementById('shDetailPagination');
    pag.innerHTML = `
      <span>Showing ${total > 0 ? start + 1 : 0} to ${Math.min(start + pageSize, total)} of ${total} entries</span>
      <div class="flex gap-1">
        <button class="px-2 py-1 border rounded text-xs ${this._shDetailPage <= 1 ? 'opacity-40' : 'hover:bg-gray-100'}" ${this._shDetailPage <= 1 ? 'disabled' : ''} onclick="Inventory._shDetailPage--;Inventory._renderDetailTable()">Previous</button>
        ${Array.from({ length: totalPages }, (_, i) => `<button class="px-2 py-1 border rounded text-xs ${i + 1 === this._shDetailPage ? 'bg-blue-500 text-white' : 'hover:bg-gray-100'}" onclick="Inventory._shDetailPage=${i + 1};Inventory._renderDetailTable()">${i + 1}</button>`).join('')}
        <button class="px-2 py-1 border rounded text-xs ${this._shDetailPage >= totalPages ? 'opacity-40' : 'hover:bg-gray-100'}" ${this._shDetailPage >= totalPages ? 'disabled' : ''} onclick="Inventory._shDetailPage++;Inventory._renderDetailTable()">Next</button>
      </div>`;
  },

  _actionBadge(action) {
    const colors = {
      'Sale': 'bg-blue-100 text-blue-700',
      'Purchase': 'bg-green-100 text-green-700',
      'Price Changed': 'bg-yellow-100 text-yellow-700',
      'Qty Adjusted': 'bg-purple-100 text-purple-700',
      'Void Refund': 'bg-red-100 text-red-700',
      'Edited': 'bg-gray-100 text-gray-700',
      'Created': 'bg-teal-100 text-teal-700',
    };
    const cls = colors[action] || 'bg-gray-100 text-gray-600';
    return `<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}">${esc(action)}</span>`;
  },

  // --- Stats Tab ---
  async loadHistoryStats(sku) {
    try {
      const res = await fetch(`/api/inventory/${sku}/stats`);
      const data = await res.json();

      // Chart
      const ctx = document.getElementById('shStatsChart');
      if (this._shChart) { this._shChart.destroy(); this._shChart = null; }
      this._shChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.months.map(m => m.label),
          datasets: [{
            label: 'Units Sold',
            data: data.months.map(m => m.sold),
            backgroundColor: 'rgba(58, 123, 213, 0.7)',
            borderRadius: 4,
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 } },
            x: { grid: { display: false } }
          }
        }
      });

      // Metrics
      document.getElementById('shStatsMetrics').innerHTML = `
        <div class="bg-blue-50 rounded-lg p-3">
          <div class="text-xs text-gray-500">Weekly Avg Sales</div>
          <div class="text-lg font-bold text-blue-700">${data.weekly_avg}</div>
        </div>
        <div class="bg-green-50 rounded-lg p-3">
          <div class="text-xs text-gray-500">Sold Last 30 Days</div>
          <div class="text-lg font-bold text-green-700">${data.sold_30}</div>
        </div>
        <div class="bg-yellow-50 rounded-lg p-3">
          <div class="text-xs text-gray-500">Sold Last 90 Days</div>
          <div class="text-lg font-bold text-yellow-700">${data.sold_90}</div>
        </div>
        <div class="bg-purple-50 rounded-lg p-3">
          <div class="text-xs text-gray-500">Sold Last 365 Days</div>
          <div class="text-lg font-bold text-purple-700">${data.sold_365}</div>
        </div>
        <div class="bg-gray-50 rounded-lg p-3">
          <div class="text-xs text-gray-500">Last Sold</div>
          <div class="text-lg font-bold text-gray-700">${data.last_sold}</div>
        </div>`;
    } catch (e) {
      document.getElementById('shStatsMetrics').innerHTML = '<p class="text-gray-400 text-center col-span-5">Failed to load stats</p>';
    }
  },

  // --- Purchase Tab ---
  async loadHistoryPurchases(sku) {
    try {
      const res = await fetch(`/api/inventory/${sku}/purchases`);
      const data = await res.json();
      const tbody = document.getElementById('shPurchaseBody');
      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-3 py-6 text-center text-gray-400">No purchase records</td></tr>';
      } else {
        tbody.innerHTML = data.map(r => {
          const cost = parseFloat(r.cost_price) || 0;
          const sell = parseFloat(r.selling_price) || 0;
          const margin = sell > 0 ? (((sell - cost) / sell) * 100).toFixed(1) : '0.0';
          return `<tr class="hover:bg-gray-50">
            <td class="px-3 py-2 text-sm">${r.date}</td>
            <td class="px-3 py-2 text-sm">${esc(r.supplier || '—')}</td>
            <td class="px-3 py-2 text-sm text-right">${r.quantity}</td>
            <td class="px-3 py-2 text-sm text-right">${App.currency(cost)}</td>
            <td class="px-3 py-2 text-sm text-right">${App.currency(sell)}</td>
            <td class="px-3 py-2 text-sm text-right">${margin}%</td>
            <td class="px-3 py-2 text-sm text-right">${App.currency(parseFloat(r.total_cost) || 0)}</td>
            <td class="px-3 py-2 text-sm">${esc(r.invoice_number || '—')}</td>
          </tr>`;
        }).join('');
      }
    } catch (e) {
      document.getElementById('shPurchaseBody').innerHTML = '<tr><td colspan="8" class="px-3 py-6 text-center text-red-400">Failed to load purchases</td></tr>';
    }
  },

  _bindPurchaseForm(sku) {
    const formDiv = document.getElementById('shPurchaseForm');
    const addBtn = document.getElementById('shAddPurchaseBtn');
    const saveBtn = document.getElementById('shPurchSaveBtn');
    const cancelBtn = document.getElementById('shPurchCancelBtn');

    // Pre-fill date and supplier from product
    const product = this.products.find(p => p.sku === sku);

    addBtn.onclick = () => {
      formDiv.classList.remove('hidden');
      document.getElementById('shPurchDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('shPurchSupplier').value = product?.supplier || '';
      document.getElementById('shPurchCost').value = product?.cost_price || '';
      document.getElementById('shPurchSell').value = product?.selling_price || '';
      document.getElementById('shPurchQty').value = '';
      document.getElementById('shPurchInvoice').value = '';
      document.getElementById('shPurchNotes').value = '';
    };

    cancelBtn.onclick = () => formDiv.classList.add('hidden');

    saveBtn.onclick = async () => {
      const qty = parseInt(document.getElementById('shPurchQty').value) || 0;
      if (qty <= 0) { App.toast('Quantity must be > 0'); return; }
      const cost = parseFloat(document.getElementById('shPurchCost').value) || 0;
      try {
        await fetch(`/api/inventory/${sku}/purchases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: document.getElementById('shPurchDate').value,
            supplier: document.getElementById('shPurchSupplier').value,
            quantity: qty,
            cost_price: cost,
            selling_price: parseFloat(document.getElementById('shPurchSell').value) || 0,
            total_cost: cost * qty,
            invoice_number: document.getElementById('shPurchInvoice').value,
            notes: document.getElementById('shPurchNotes').value,
          })
        });
        App.toast('Purchase recorded');
        formDiv.classList.add('hidden');
        this.loadHistoryPurchases(sku);
        // Refresh inventory to reflect new qty
        await this.loadProducts();
        this.render();
      } catch (e) {
        App.toast('Failed to save purchase');
      }
    };
  },

  // --- Item Sales Tab ---
  _shSalesData: [],

  async loadHistorySales(sku) {
    try {
      const res = await fetch(`/api/inventory/${sku}/sales`);
      this._shSalesData = await res.json();
      const tbody = document.getElementById('shSalesBody');
      if (this._shSalesData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="px-3 py-6 text-center text-gray-400">No sales found</td></tr>';
      } else {
        tbody.innerHTML = this._shSalesData.map(r => {
          return `<tr class="hover:bg-gray-50 text-xs">
            <td class="px-3 py-2">${esc(r.receipt_number)}</td>
            <td class="px-3 py-2">${r.sale_date}</td>
            <td class="px-3 py-2">${esc(r.category || '')}</td>
            <td class="px-3 py-2 text-right">${r.quantity}</td>
            <td class="px-3 py-2 text-right">${App.currency(r.unit_price)}</td>
            <td class="px-3 py-2 text-right">${App.currency(r.cost_price)}</td>
            <td class="px-3 py-2 text-right font-medium ${r.profit >= 0 ? 'text-green-600' : 'text-red-600'}">${App.currency(r.profit)}</td>
            <td class="px-3 py-2 text-right">${r.margin_pct}%</td>
            <td class="px-3 py-2 text-right">${r.markup_pct}%</td>
            <td class="px-3 py-2 text-right">${App.currency(r.discount_amount || 0)}</td>
            <td class="px-3 py-2 text-right font-semibold">${App.currency(r.final_total)}</td>
          </tr>`;
        }).join('');
      }
    } catch (e) {
      document.getElementById('shSalesBody').innerHTML = '<tr><td colspan="11" class="px-3 py-6 text-center text-red-400">Failed to load sales</td></tr>';
    }
  },

  _exportSalesCSV(sku) {
    if (!this._shSalesData || this._shSalesData.length === 0) {
      App.toast('No sales data to export');
      return;
    }
    const headers = ['Receipt #', 'Date', 'Category', 'Sold', 'Price', 'Cost', 'Profit', 'Margin %', 'Markup %', 'Discount', 'Total'];
    const rows = this._shSalesData.map(r => [
      r.receipt_number, r.sale_date, r.category || '', r.quantity,
      r.unit_price, r.cost_price, r.profit, r.margin_pct, r.markup_pct,
      r.discount_amount || 0, r.final_total
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `item_sales_${sku}.csv`;
    a.click();
  },
};
