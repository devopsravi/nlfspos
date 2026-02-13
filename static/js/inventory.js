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
      const displayCode = esc(p.barcode || p.sku);
      return `
        <tr class="${rowBg} hover:bg-blue-50 dark:hover:bg-gray-800 transition text-sm">
          <td class="px-4 py-2.5 font-mono text-xs text-gray-600">${displayCode}</td>
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

    // Show/hide Print Label option
    const printLabelRow = document.getElementById('printLabelRow');
    const printLabelCheckbox = document.getElementById('printLabelOnSave');
    if (printLabelRow) {
      printLabelRow.classList.toggle('hidden', !product);
    }
    if (printLabelCheckbox) {
      printLabelCheckbox.checked = false;
    }

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

    // Barcode is auto-generated on server; don't send empty value
    if (!data.barcode || !data.barcode.trim()) {
      delete data.barcode;
    }

    // Coerce numbers
    ['cost_price', 'selling_price', 'weight'].forEach(f => { data[f] = parseFloat(data[f]) || 0; });
    ['quantity', 'reorder_level'].forEach(f => { data[f] = parseInt(data[f]) || 0; });

    // Check if Print Label is requested
    const shouldPrintLabel = document.getElementById('printLabelOnSave')?.checked || false;

    try {
      let savedProduct = null;
      if (this.editingSku) {
        const res = await fetch(`/api/inventory/${this.editingSku}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const result = await res.json();
        savedProduct = result.product || null;
        App.toast('Product updated');
      } else {
        const res = await fetch('/api/inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const result = await res.json();
        savedProduct = result.product || null;
        App.toast('Product added');
      }

      document.getElementById('productModal').classList.add('hidden');
      await this.loadProducts();
      this.loadCategories();
      this.render();

      // Print label after save if checkbox was checked
      if (shouldPrintLabel && savedProduct && typeof Labels !== 'undefined') {
        Labels.printSingleLabel(savedProduct);
      }
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
            <td class="px-3 py-2"><a href="#" onclick="Inventory.showTransactionDetail('${esc(r.receipt_number)}');return false;" class="text-blue-600 hover:underline font-medium">${esc(r.receipt_number)}</a></td>
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

  // =========================================================================
  // Transaction Detail Modal (from Item Sales receipt click)
  // =========================================================================
  _txnSale: null,

  async showTransactionDetail(receiptNumber) {
    const modal = document.getElementById('txnDetailModal');
    try {
      const res = await fetch(`/api/sales/${encodeURIComponent(receiptNumber)}`);
      if (!res.ok) { App.toast('Sale not found'); return; }
      const sale = await res.json();
      this._txnSale = sale;

      // Close button
      document.getElementById('txnDetailClose').onclick = () => modal.classList.add('hidden');

      // Populate header info
      const isVoided = (sale.status || 'Complete') === 'Voided';
      const statusBadge = isVoided
        ? '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">Voided</span>'
        : '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">Complete</span>';
      const dateStr = sale.timestamp ? new Date(sale.timestamp).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : sale.date;

      document.getElementById('txnDetailInfo').innerHTML = `
        <div><span class="text-gray-500">Status:</span> ${statusBadge}</div>
        <div><span class="text-gray-500">Receipt:</span> <span class="font-medium">${esc(sale.receipt_number)}</span></div>
        <div><span class="text-gray-500">Date:</span> <span class="font-medium">${dateStr}</span></div>
        <div><span class="text-gray-500">Cashier:</span> <span class="font-medium">${esc(sale.cashier || 'Staff')}</span></div>
        <div><span class="text-gray-500">Customer:</span> <span class="font-medium">${esc(sale.customer_name || '—')} ${esc(sale.customer_phone || '')}</span></div>
        <div><span class="text-gray-500">Payment:</span> <span class="font-medium">${esc(sale.payment_method || 'Cash')}</span></div>
      `;

      // Tab switching
      document.querySelectorAll('.txn-tab').forEach(tab => {
        tab.onclick = () => {
          document.querySelectorAll('.txn-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const target = tab.dataset.txntab;
          document.querySelectorAll('.txn-panel').forEach(p => p.classList.add('hidden'));
          const panelId = 'txnTab' + target.charAt(0).toUpperCase() + target.slice(1);
          document.getElementById(panelId)?.classList.remove('hidden');
        };
      });

      // Render all tabs
      this._renderTxnDetails(sale);
      this._renderTxnItems(sale);
      this._renderTxnPayments(sale);
      this._bindTxnOptions(sale);

      // Footer: Void + Close
      const footer = document.getElementById('txnDetailFooter');
      const userRole = (App.userRole || '').toLowerCase();
      const canVoid = !isVoided && (userRole === 'admin' || userRole === 'manager');
      footer.innerHTML = `
        ${canVoid ? `<button id="txnVoidBtn" class="bg-red-500 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-red-600 flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18.364 5.636l-12.728 12.728M5.636 5.636l12.728 12.728"/></svg>
          Void
        </button>` : ''}
        <button id="txnCloseBtn" class="bg-gray-400 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-500 flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
          Close
        </button>`;

      document.getElementById('txnCloseBtn').onclick = () => modal.classList.add('hidden');
      if (canVoid) {
        document.getElementById('txnVoidBtn').onclick = () => {
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
              modal.classList.add('hidden');
              // Reload item sales tab
              if (this._shSku) this.loadHistorySales(this._shSku);
            } else {
              App.toast(data.error || 'Failed to void sale');
            }
          }).catch(() => App.toast('Failed to void sale'));
        };
      }

      // Default tab: Details
      document.querySelectorAll('.txn-tab').forEach(t => t.classList.remove('active'));
      document.querySelector('.txn-tab[data-txntab="details"]').classList.add('active');
      document.querySelectorAll('.txn-panel').forEach(p => p.classList.add('hidden'));
      document.getElementById('txnTabDetails').classList.remove('hidden');

      modal.classList.remove('hidden');
    } catch (e) {
      App.toast('Failed to load transaction');
    }
  },

  _renderTxnDetails(sale) {
    const isVoided = (sale.status || 'Complete') === 'Voided';
    let html = `
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-gray-50 rounded-lg p-3">
            <div class="text-xs text-gray-500 mb-1">Subtotal</div>
            <div class="text-lg font-bold">${App.currency(sale.subtotal)}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-3">
            <div class="text-xs text-gray-500 mb-1">Discount</div>
            <div class="text-lg font-bold text-red-600">-${App.currency(sale.discount_amount || 0)}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-3">
            <div class="text-xs text-gray-500 mb-1">Tax</div>
            <div class="text-lg font-bold">${App.currency(sale.tax_amount || 0)}</div>
          </div>
          <div class="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <div class="text-xs text-blue-600 mb-1">Grand Total</div>
            <div class="text-xl font-bold text-blue-700">${App.currency(sale.grand_total)}</div>
          </div>
        </div>
        <div class="text-sm text-gray-500">Items in this sale: <strong>${(sale.items || []).length}</strong></div>
    `;
    if (isVoided) {
      html += `
        <div class="bg-red-50 border border-red-200 rounded-lg p-3 mt-2">
          <div class="font-semibold text-red-700">Sale Voided</div>
          ${sale.voided_at ? `<div class="text-xs text-red-600">Voided on: ${new Date(sale.voided_at).toLocaleString()}</div>` : ''}
          ${sale.voided_by ? `<div class="text-xs text-red-600">By: ${esc(sale.voided_by)}</div>` : ''}
          ${sale.void_reason ? `<div class="text-xs text-red-600">Reason: ${esc(sale.void_reason)}</div>` : ''}
        </div>`;
    }
    html += '</div>';
    document.getElementById('txnTabDetails').innerHTML = html;
  },

  _renderTxnItems(sale) {
    const items = sale.items || [];
    if (items.length === 0) {
      document.getElementById('txnTabItems').innerHTML = '<p class="text-gray-400 text-center py-6">No items</p>';
      return;
    }
    let html = `<table class="w-full text-sm border">
      <thead class="bg-gray-100 text-xs uppercase text-gray-600">
        <tr>
          <th class="px-3 py-2 text-left">Item</th>
          <th class="px-3 py-2 text-left">Stockcode</th>
          <th class="px-3 py-2 text-right">Qty</th>
          <th class="px-3 py-2 text-right">Unit Price</th>
          <th class="px-3 py-2 text-right">Discount</th>
          <th class="px-3 py-2 text-right">Total</th>
        </tr>
      </thead>
      <tbody class="divide-y">`;
    items.forEach(i => {
      html += `<tr class="hover:bg-gray-50">
        <td class="px-3 py-2 font-medium">${esc(i.name)}</td>
        <td class="px-3 py-2 text-gray-500 font-mono text-xs">${esc(i.sku)}</td>
        <td class="px-3 py-2 text-right">${i.quantity}</td>
        <td class="px-3 py-2 text-right">${App.currency(i.unit_price)}</td>
        <td class="px-3 py-2 text-right text-red-600">${i.discount_amount > 0 ? '-' + App.currency(i.discount_amount) : '—'}</td>
        <td class="px-3 py-2 text-right font-semibold">${App.currency(i.final_total || i.line_total)}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('txnTabItems').innerHTML = html;
  },

  _renderTxnPayments(sale) {
    document.getElementById('txnTabPayments').innerHTML = `
      <div class="space-y-4">
        <div class="bg-gray-50 rounded-lg p-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <div class="text-xs text-gray-500 mb-1">Payment Method</div>
              <div class="text-lg font-bold">${esc(sale.payment_method || 'Cash')}</div>
            </div>
            <div>
              <div class="text-xs text-gray-500 mb-1">Amount Paid</div>
              <div class="text-lg font-bold text-green-700">${App.currency(sale.grand_total)}</div>
            </div>
          </div>
        </div>
        <table class="w-full text-sm border">
          <thead class="bg-gray-100 text-xs uppercase text-gray-600">
            <tr>
              <th class="px-3 py-2 text-left">Method</th>
              <th class="px-3 py-2 text-right">Amount</th>
              <th class="px-3 py-2 text-left">Status</th>
              <th class="px-3 py-2 text-left">Time</th>
            </tr>
          </thead>
          <tbody>
            <tr class="hover:bg-gray-50">
              <td class="px-3 py-2 font-medium">${esc(sale.payment_method || 'Cash')}</td>
              <td class="px-3 py-2 text-right font-semibold">${App.currency(sale.grand_total)}</td>
              <td class="px-3 py-2"><span class="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Paid</span></td>
              <td class="px-3 py-2 text-gray-500">${sale.timestamp ? new Date(sale.timestamp).toLocaleString('en-IN', { timeStyle: 'short' }) : ''}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
  },

  _bindTxnOptions(sale) {
    // Print Receipt
    document.getElementById('txnOptPrint').onclick = () => {
      document.getElementById('txnDetailModal').classList.add('hidden');
      POS.showReceipt(sale);
      setTimeout(() => {
        document.getElementById('btnPrintReceipt')?.click();
      }, 300);
    };

    // Generate Invoice (A4 — reuse quote pattern)
    document.getElementById('txnOptInvoice').onclick = () => {
      const s = App.settings;
      const items = sale.items || [];
      const itemRows = items.map((it, idx) => `
        <tr>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">${idx + 1}</td>
          <td style="padding:6px 10px;border:1px solid #ddd">${esc(it.name)}</td>
          <td style="padding:6px 10px;border:1px solid #ddd">${esc(it.sku)}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">${it.quantity}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${App.currency(it.unit_price)}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${it.discount_amount > 0 ? App.currency(it.discount_amount) : '—'}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-weight:600">${App.currency(it.final_total || it.line_total)}</td>
        </tr>`).join('');

      const invoiceHTML = `
        <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:30px;">
          <div style="text-align:center;margin-bottom:20px;">
            <img src="/static/img/logo.svg" style="width:60px;height:60px;margin:0 auto 8px;display:block;border-radius:10px;" />
            <h2 style="margin:0;font-size:22px;">${esc(s.store_name || 'Next Level Furniture')}</h2>
            <p style="margin:4px 0;color:#666;font-size:13px;">${esc(s.address || '')}</p>
            <p style="margin:2px 0;color:#666;font-size:13px;">${esc(s.phone || '')} ${s.email ? ' | ' + esc(s.email) : ''}</p>
          </div>
          <hr style="border:1px solid #3a7bd5;margin:16px 0;" />
          <h3 style="text-align:center;color:#3a7bd5;margin-bottom:16px;">TAX INVOICE</h3>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:16px;">
            <div>
              <strong>Invoice #:</strong> ${esc(sale.receipt_number)}<br/>
              <strong>Date:</strong> ${sale.date}<br/>
              <strong>Cashier:</strong> ${esc(sale.cashier || 'Staff')}
            </div>
            <div style="text-align:right;">
              ${sale.customer_name ? `<strong>Customer:</strong> ${esc(sale.customer_name)}<br/>` : ''}
              ${sale.customer_phone ? `<strong>Phone:</strong> ${esc(sale.customer_phone)}<br/>` : ''}
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
            <thead>
              <tr style="background:#3a7bd5;color:#fff;">
                <th style="padding:8px 10px;border:1px solid #3a7bd5;text-align:center">#</th>
                <th style="padding:8px 10px;border:1px solid #3a7bd5;text-align:left">Item</th>
                <th style="padding:8px 10px;border:1px solid #3a7bd5;text-align:left">Stockcode</th>
                <th style="padding:8px 10px;border:1px solid #3a7bd5;text-align:center">Qty</th>
                <th style="padding:8px 10px;border:1px solid #3a7bd5;text-align:right">Price</th>
                <th style="padding:8px 10px;border:1px solid #3a7bd5;text-align:right">Discount</th>
                <th style="padding:8px 10px;border:1px solid #3a7bd5;text-align:right">Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
          <div style="text-align:right;font-size:14px;">
            <div style="margin:4px 0;">Subtotal: <strong>${App.currency(sale.subtotal)}</strong></div>
            ${sale.discount_amount > 0 ? `<div style="margin:4px 0;color:#e74c3c;">Discount: <strong>-${App.currency(sale.discount_amount)}</strong></div>` : ''}
            <div style="margin:4px 0;">Tax: <strong>${App.currency(sale.tax_amount || 0)}</strong></div>
            <div style="margin:8px 0;font-size:18px;color:#3a7bd5;"><strong>Grand Total: ${App.currency(sale.grand_total)}</strong></div>
          </div>
          <hr style="border:1px solid #eee;margin:20px 0;" />
          <div style="text-align:center;color:#999;font-size:11px;">
            ${esc(s.receipt_footer || 'Thank you for your business!')}
          </div>
        </div>`;

      // Use the quote print area to print the invoice
      const printArea = document.getElementById('quotePrintArea');
      printArea.innerHTML = invoiceHTML;
      printArea.classList.remove('hidden');
      setTimeout(() => {
        window.print();
        printArea.classList.add('hidden');
      }, 200);
    };

    // Download CSV
    document.getElementById('txnOptCSV').onclick = () => {
      const items = sale.items || [];
      if (items.length === 0) { App.toast('No items to export'); return; }
      const headers = ['Item', 'Stockcode', 'Qty', 'Unit Price', 'Discount', 'Total'];
      const rows = items.map(i => [
        `"${i.name}"`, i.sku, i.quantity, i.unit_price,
        i.discount_amount || 0, i.final_total || i.line_total
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `invoice_${sale.receipt_number}.csv`;
      a.click();
    };

    // Email Invoice (placeholder)
    document.getElementById('txnOptEmail').onclick = () => {
      App.toast('Email feature coming soon — no email server configured');
    };

    // History — go back to Detail tab in Stock History
    document.getElementById('txnOptHistory').onclick = () => {
      document.getElementById('txnDetailModal').classList.add('hidden');
      // Switch to Detail tab in stock history
      if (this._shSku) {
        document.querySelectorAll('.sh-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.sh-tab[data-tab="detail"]')?.classList.add('active');
        document.querySelectorAll('.sh-panel').forEach(p => p.classList.add('hidden'));
        document.getElementById('shTabDetail')?.classList.remove('hidden');
        this.loadHistoryDetail(this._shSku);
      }
    };
  },
};
