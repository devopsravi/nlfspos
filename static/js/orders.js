/* ========================================
   Orders Module — Purchase Orders CRUD, Receive, Print
   ======================================== */

const Orders = {
  all: [],
  filtered: [],
  page: 1,
  pageSize: 10,
  sortCol: 'created',
  sortDir: 'desc',
  suppliers: [],
  products: [],
  orderItems: [],     // items currently in the modal
  _bound: false,
  _searchDebounce: null,

  // Look up barcode from products list, fallback to sku
  _bc(sku) {
    const p = this.products.find(x => x.sku === sku);
    return (p && p.barcode) ? p.barcode : sku;
  },

  async init() {
    await Promise.all([this.loadOrders(), this.loadSuppliers(), this.loadProducts()]);
    if (!this._bound) { this.bindEvents(); this._bound = true; }
    this.applyFilters();
  },

  /* ---------- Data loading ---------- */
  async loadOrders() {
    try {
      const res = await fetch('/api/orders');
      this.all = await res.json();
    } catch (e) { this.all = []; }
  },

  async loadSuppliers() {
    try {
      const res = await fetch('/api/suppliers');
      this.suppliers = await res.json();
    } catch (e) { this.suppliers = []; }
  },

  async loadProducts() {
    try {
      const res = await fetch('/api/inventory');
      this.products = res.ok ? await res.json() : [];
    } catch (e) { this.products = []; }
  },

  /* ---------- Events ---------- */
  bindEvents() {
    // Create order
    const btnCreate = document.getElementById('btnCreateOrder');
    if (btnCreate) btnCreate.onclick = () => this.openModal();

    // Close modal
    const closeBtn = document.getElementById('orderModalClose');
    if (closeBtn) closeBtn.onclick = () => this.closeModal();
    const cancelBtn = document.getElementById('btnCancelOrder');
    if (cancelBtn) cancelBtn.onclick = () => this.closeModal();

    // Form submit
    const form = document.getElementById('orderForm');
    if (form) form.onsubmit = (e) => { e.preventDefault(); this.saveOrder(); };

    // Add item button
    const addItemBtn = document.getElementById('btnAddOrderItem');
    if (addItemBtn) addItemBtn.onclick = () => this.showItemSearch();

    // Product search
    const searchInput = document.getElementById('orderProductSearch');
    if (searchInput) {
      searchInput.oninput = () => {
        clearTimeout(this._searchDebounce);
        this._searchDebounce = setTimeout(() => this.searchProducts(searchInput.value), 200);
      };
    }

    // Cancel item search
    const cancelSearch = document.getElementById('btnCancelOrderItemSearch');
    if (cancelSearch) cancelSearch.onclick = () => this.hideItemSearch();

    // Add new product from order
    const newProdBtn = document.getElementById('btnAddNewProductFromOrder');
    if (newProdBtn) {
      newProdBtn.onclick = () => {
        this.hideItemSearch();
        // Open inventory product modal
        if (typeof Inventory !== 'undefined') {
          Inventory.openModal();
        } else {
          App.toast('Navigate to Inventory to add new products', 'info');
        }
      };
    }

    // Search filter
    const orderSearch = document.getElementById('orderSearch');
    if (orderSearch) orderSearch.oninput = () => this.applyFilters();

    // Status filter
    const statusFilter = document.getElementById('orderStatusFilter');
    if (statusFilter) statusFilter.onchange = () => this.applyFilters();

    // Page size
    const ps = document.getElementById('orderPageSize');
    if (ps) ps.onchange = () => { this.pageSize = parseInt(ps.value); this.page = 1; this.render(); };

    // Receive modal
    const receiveClose = document.getElementById('receiveOrderClose');
    if (receiveClose) receiveClose.onclick = () => this.closeReceiveModal();
    const cancelReceive = document.getElementById('btnCancelReceive');
    if (cancelReceive) cancelReceive.onclick = () => this.closeReceiveModal();
    const confirmReceive = document.getElementById('btnConfirmReceive');
    if (confirmReceive) confirmReceive.onclick = () => this.confirmReceive();

    // Receive check all
    const receiveCheckAll = document.getElementById('receiveCheckAll');
    if (receiveCheckAll) {
      receiveCheckAll.onchange = () => {
        document.querySelectorAll('.receive-item-check').forEach(cb => {
          cb.checked = receiveCheckAll.checked;
        });
      };
    }

    // Item detail modal
    const detailClose = document.getElementById('orderItemDetailClose');
    if (detailClose) detailClose.onclick = () => this.closeItemDetailModal();
    const detailCancel = document.getElementById('btnCancelItemDetail');
    if (detailCancel) detailCancel.onclick = () => this.closeItemDetailModal();
    const detailSave = document.getElementById('btnSaveItemDetail');
    if (detailSave) detailSave.onclick = () => this.confirmItemDetail();

    // Auto-calc listeners for item detail
    const oidQty = document.getElementById('oidOrderQty');
    const oidCost = document.getElementById('oidCostPerUnit');
    const oidTotal = document.getElementById('oidTotalCost');
    if (oidQty) oidQty.oninput = () => this._recalcItemDetail('qty');
    if (oidCost) oidCost.oninput = () => this._recalcItemDetail('cost');
    if (oidTotal) oidTotal.oninput = () => this._recalcItemDetail('total');

    // Markup / selling price auto-calc
    const oidMarkup = document.getElementById('oidMarkupPct');
    const oidSelling = document.getElementById('oidNewSellingPrice');
    if (oidMarkup) oidMarkup.oninput = () => this._recalcMarkup('markup');
    if (oidSelling) oidSelling.oninput = () => this._recalcMarkup('selling');
  },

  /* ---------- Filtering & Sorting ---------- */
  applyFilters() {
    const search = (document.getElementById('orderSearch')?.value || '').toLowerCase();
    const status = document.getElementById('orderStatusFilter')?.value || '';

    this.filtered = this.all.filter(o => {
      if (status && o.status !== status) return false;
      if (search) {
        const str = `${o.order_number} ${o.supplier_name} ${o.notes}`.toLowerCase();
        if (!str.includes(search)) return false;
      }
      return true;
    });

    // Sort
    this.filtered.sort((a, b) => {
      let va = a[this.sortCol] || '', vb = b[this.sortCol] || '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return this.sortDir === 'asc' ? -1 : 1;
      if (va > vb) return this.sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    this.page = 1;
    this.render();
  },

  /* ---------- Rendering ---------- */
  render() {
    const start = (this.page - 1) * this.pageSize;
    const slice = this.filtered.slice(start, start + this.pageSize);
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    if (slice.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400 text-xs">No orders found</td></tr>';
    } else {
      tbody.innerHTML = slice.map(o => {
        const inv = o.invoice_number ? `<div class="text-[10px] text-gray-400 mt-0.5">${esc(o.invoice_number)}</div>` : '';
        return `
        <tr class="hover:bg-orange-50/30 transition">
          <td class="px-4 py-2.5">
            <a href="#" onclick="event.preventDefault();Orders.showOrderDetail(${o.id})" class="text-xs font-medium text-orange-700 hover:text-orange-900 underline cursor-pointer">${esc(o.order_number)}</a>
            ${inv}
          </td>
          <td class="px-4 py-2.5 text-xs">${esc(o.supplier_name)}</td>
          <td class="px-4 py-2.5 text-xs">${o.order_date || ''}</td>
          <td class="px-4 py-2.5 text-xs text-center">${o.item_count || (o.items ? o.items.length : 0)}</td>
          <td class="px-4 py-2.5 text-xs text-right font-medium">₹${Number(o.total_amount || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
          <td class="px-4 py-2.5 text-center">${this._statusBadge(o.status)}</td>
          <td class="px-4 py-2.5 text-center">
            <div class="flex items-center justify-center gap-1">
              ${o.status !== 'received' && o.status !== 'cancelled' ? `
                <button onclick="Orders.openReceiveModal(${o.id})" class="p-1 rounded hover:bg-green-100 text-green-600" title="Receive">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
                </button>` : ''}
              ${o.status !== 'cancelled' ? `
                <button onclick="Orders.openModal(${o.id})" class="p-1 rounded hover:bg-blue-100 text-blue-600" title="Edit">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </button>` : ''}
              <button onclick="Orders.printOrder(${o.id})" class="p-1 rounded hover:bg-gray-100 text-gray-600" title="Print">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
              </button>
              ${o.status !== 'received' ? `
                <button onclick="Orders.deleteOrder(${o.id})" class="p-1 rounded hover:bg-red-100 text-red-500" title="Delete">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>` : ''}
            </div>
          </td>
        </tr>`;
      }).join('');
    }

    // Pagination
    const total = this.filtered.length;
    const pages = Math.ceil(total / this.pageSize) || 1;
    const info = document.getElementById('orderInfo');
    if (info) {
      const s = start + 1, e = Math.min(start + this.pageSize, total);
      info.textContent = total ? `Showing ${s}–${e} of ${total}` : 'No entries';
    }
    const pag = document.getElementById('orderPagination');
    if (pag) {
      let html = '';
      for (let i = 1; i <= pages; i++) {
        html += `<button onclick="Orders.page=${i};Orders.render()" class="px-2 py-1 rounded text-xs ${i === this.page ? 'bg-orange-500 text-white' : 'bg-gray-100 hover:bg-gray-200'}">${i}</button>`;
      }
      pag.innerHTML = html;
    }
  },

  _statusBadge(status) {
    const map = {
      draft: 'bg-gray-100 text-gray-700',
      sent: 'bg-blue-100 text-blue-700',
      partial: 'bg-yellow-100 text-yellow-700',
      received: 'bg-green-100 text-green-700',
      cancelled: 'bg-red-100 text-red-700'
    };
    const cls = map[status] || 'bg-gray-100 text-gray-700';
    return `<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}">${(status || 'draft').toUpperCase()}</span>`;
  },

  /* ---------- Modal (Create/Edit) ---------- */
  async openModal(orderId) {
    await this.loadSuppliers();
    await this.loadProducts();

    const modal = document.getElementById('orderModal');
    const form = document.getElementById('orderForm');
    const title = document.getElementById('orderModalTitle');

    form.reset();
    form.elements.order_id.value = '';
    this.orderItems = [];

    // Populate supplier dropdown
    const supplierSelect = form.elements.supplier_id;
    supplierSelect.innerHTML = '<option value="">Select supplier...</option>' +
      this.suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');

    // Set today's date
    form.elements.order_date.value = new Date().toISOString().split('T')[0];

    if (orderId) {
      title.textContent = 'Edit Purchase Order';
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        if (!res.ok) throw new Error('Failed to load order');
        const order = await res.json();

        form.elements.order_id.value = order.id;
        form.elements.supplier_id.value = order.supplier_id;
        form.elements.invoice_number.value = order.invoice_number || '';
        form.elements.order_date.value = order.order_date || '';
        form.elements.expected_date.value = order.expected_date || '';
        form.elements.status.value = order.status || 'draft';
        form.elements.notes.value = order.notes || '';

        this.orderItems = (order.items || []).map(it => ({
          sku: it.sku,
          product_name: it.product_name,
          quantity: it.quantity,
          cost_price: it.cost_price,
          received_qty: it.received_qty || 0
        }));
      } catch (e) {
        App.toast('Failed to load order', 'error');
        return;
      }
    } else {
      title.textContent = 'New Purchase Order';
    }

    this.renderOrderItems();
    modal.classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('orderModal').classList.add('hidden');
    this.hideItemSearch();
  },

  /* ---------- Order items in modal ---------- */
  renderOrderItems() {
    const tbody = document.getElementById('orderItemsBody');
    const empty = document.getElementById('orderItemsEmpty');

    if (this.orderItems.length === 0) {
      tbody.innerHTML = '<tr id="orderItemsEmpty"><td colspan="6" class="px-3 py-6 text-center text-gray-400">No items added yet</td></tr>';
    } else {
      tbody.innerHTML = this.orderItems.map((it, idx) => `
        <tr class="border-b hover:bg-orange-50/20">
          <td class="px-3 py-2 text-xs">${esc(it.product_name)}</td>
          <td class="px-3 py-2 text-xs text-gray-500">${esc(this._bc(it.sku))}</td>
          <td class="px-3 py-2 text-right">
            <input type="number" min="1" value="${it.quantity}" onchange="Orders.updateItemQty(${idx}, this.value)"
              class="w-14 px-1 py-0.5 border rounded text-xs text-right" />
          </td>
          <td class="px-3 py-2 text-right">
            <input type="number" min="0" step="0.01" value="${it.cost_price}" onchange="Orders.updateItemCost(${idx}, this.value)"
              class="w-20 px-1 py-0.5 border rounded text-xs text-right" />
          </td>
          <td class="px-3 py-2 text-right text-xs font-medium">₹${(it.quantity * it.cost_price).toFixed(2)}</td>
          <td class="px-3 py-2 text-center">
            <button onclick="Orders.removeItem(${idx})" class="text-red-400 hover:text-red-600">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </td>
        </tr>`).join('');
    }

    // Update totals
    const count = this.orderItems.reduce((s, i) => s + i.quantity, 0);
    const total = this.orderItems.reduce((s, i) => s + i.quantity * i.cost_price, 0);
    document.getElementById('orderItemCount').textContent = count;
    document.getElementById('orderItemTotal').textContent = '₹' + total.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  },

  updateItemQty(idx, val) {
    this.orderItems[idx].quantity = Math.max(1, parseInt(val) || 1);
    this.renderOrderItems();
  },

  updateItemCost(idx, val) {
    this.orderItems[idx].cost_price = Math.max(0, parseFloat(val) || 0);
    this.renderOrderItems();
  },

  removeItem(idx) {
    this.orderItems.splice(idx, 1);
    this.renderOrderItems();
  },

  /* ---------- Product Search ---------- */
  showItemSearch() {
    document.getElementById('orderItemSearchRow').classList.remove('hidden');
    const input = document.getElementById('orderProductSearch');
    input.value = '';
    input.focus();
    document.getElementById('orderProductResults').classList.add('hidden');
  },

  hideItemSearch() {
    document.getElementById('orderItemSearchRow').classList.add('hidden');
    document.getElementById('orderProductResults').classList.add('hidden');
  },

  searchProducts(query) {
    const resultsDiv = document.getElementById('orderProductResults');
    if (!query || query.length < 1) {
      resultsDiv.classList.add('hidden');
      return;
    }

    const q = query.toLowerCase();
    const matches = this.products.filter(p => {
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q);
    }).slice(0, 15);

    if (matches.length === 0) {
      resultsDiv.innerHTML = '<div class="px-3 py-2 text-xs text-gray-400">No products found</div>';
    } else {
      resultsDiv.innerHTML = matches.map(p => `
        <div class="px-3 py-2 hover:bg-orange-50 cursor-pointer flex items-center justify-between text-xs border-b"
             onclick="Orders.addProductToOrder('${esc(p.sku)}')">
          <div>
            <span class="font-medium">${esc(p.name)}</span>
            <span class="text-gray-400 ml-2">${esc(p.barcode || p.sku)}</span>
          </div>
          <div class="text-gray-500">₹${Number(p.cost_price || 0).toFixed(2)} | Stock: ${p.quantity}</div>
        </div>`).join('');
    }
    resultsDiv.classList.remove('hidden');
  },

  addProductToOrder(sku) {
    this.hideItemSearch();
    this.openItemDetailModal(sku);
  },

  /* ---------- Item Detail Modal ---------- */
  _detailEditingIdx: -1,  // -1 = new item, >= 0 = editing existing

  openItemDetailModal(sku) {
    const product = this.products.find(p => p.sku === sku);
    if (!product) { App.toast('Product not found', 'error'); return; }

    // Check if already in order
    const existingIdx = this.orderItems.findIndex(i => i.sku === sku);
    this._detailEditingIdx = existingIdx;

    const qty = existingIdx >= 0 ? this.orderItems[existingIdx].quantity : 1;
    const costPerUnit = existingIdx >= 0 ? this.orderItems[existingIdx].cost_price : (product.cost_price || 0);

    const sellingPrice = product.selling_price || 0;

    // Populate read-only fields
    document.getElementById('oidProductName').textContent = product.name;
    document.getElementById('oidSku').textContent = product.barcode || product.sku;
    document.getElementById('oidQtyOnHand').textContent = product.quantity ?? 0;
    document.getElementById('oidSellingPrice').textContent = '₹' + Number(sellingPrice).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    document.getElementById('oidSkuHidden').value = product.sku;

    // Populate editable fields
    document.getElementById('oidOrderQty').value = qty;
    document.getElementById('oidCostPerUnit').value = costPerUnit.toFixed(2);
    document.getElementById('oidTotalCost').value = (qty * costPerUnit).toFixed(2);

    // Markup / selling price
    document.getElementById('oidNewSellingPrice').value = sellingPrice.toFixed(2);
    const markup = costPerUnit > 0 ? ((sellingPrice - costPerUnit) / costPerUnit) * 100 : 0;
    document.getElementById('oidMarkupPct').value = markup.toFixed(1);
    const margin = sellingPrice > 0 ? ((sellingPrice - costPerUnit) / sellingPrice) * 100 : 0;
    document.getElementById('oidMarginPct').textContent = margin.toFixed(2) + '%';

    document.getElementById('orderItemDetailModal').classList.remove('hidden');
    document.getElementById('oidOrderQty').focus();
    document.getElementById('oidOrderQty').select();
  },

  closeItemDetailModal() {
    document.getElementById('orderItemDetailModal').classList.add('hidden');
    this._detailEditingIdx = -1;
  },

  _recalcItemDetail(changed) {
    const qtyEl = document.getElementById('oidOrderQty');
    const costEl = document.getElementById('oidCostPerUnit');
    const totalEl = document.getElementById('oidTotalCost');

    let qty = Math.max(1, parseInt(qtyEl.value) || 1);
    let cost = Math.max(0, parseFloat(costEl.value) || 0);
    let total = Math.max(0, parseFloat(totalEl.value) || 0);

    if (changed === 'qty' || changed === 'cost') {
      total = qty * cost;
      totalEl.value = total.toFixed(2);
    } else if (changed === 'total') {
      cost = qty > 0 ? total / qty : 0;
      costEl.value = cost.toFixed(2);
    }

    // Recalculate markup & margin based on new cost and current selling price
    const selling = parseFloat(document.getElementById('oidNewSellingPrice').value) || 0;
    const markup = cost > 0 ? ((selling - cost) / cost) * 100 : 0;
    document.getElementById('oidMarkupPct').value = markup.toFixed(1);
    const margin = selling > 0 ? ((selling - cost) / selling) * 100 : 0;
    document.getElementById('oidMarginPct').textContent = margin.toFixed(2) + '%';
  },

  // Round to nearest .99 or .49 (e.g. 2183 -> 2199, 2120 -> 2149)
  _roundPrice(raw) {
    if (raw <= 0) return 0;
    const floor = Math.floor(raw);
    const frac = raw - floor;
    const lastTwo = floor % 100;
    const base = floor - lastTwo; // e.g. 2183 -> 2100

    // Candidate prices: base+49 and base+99
    const opt49 = base + 49;
    const opt99 = base + 99;

    // Pick the nearest one that is >= raw (round up to charm price)
    if (raw <= opt49) return opt49;
    return opt99;
  },

  _recalcMarkup(changed) {
    const cost = Math.max(0, parseFloat(document.getElementById('oidCostPerUnit').value) || 0);
    const markupEl = document.getElementById('oidMarkupPct');
    const sellingEl = document.getElementById('oidNewSellingPrice');
    const marginEl = document.getElementById('oidMarginPct');

    if (changed === 'markup') {
      // Markup % changed -> recalculate selling price, rounded to .99 or .49
      const mkp = parseFloat(markupEl.value) || 0;
      const rawSelling = cost * (1 + mkp / 100);
      const newSelling = this._roundPrice(rawSelling);
      sellingEl.value = newSelling.toFixed(2);
      const margin = newSelling > 0 ? ((newSelling - cost) / newSelling) * 100 : 0;
      marginEl.textContent = margin.toFixed(2) + '%';
    } else if (changed === 'selling') {
      // Selling price changed -> recalculate markup %
      const selling = parseFloat(sellingEl.value) || 0;
      const mkp = cost > 0 ? ((selling - cost) / cost) * 100 : 0;
      markupEl.value = mkp.toFixed(1);
      const margin = selling > 0 ? ((selling - cost) / selling) * 100 : 0;
      marginEl.textContent = margin.toFixed(2) + '%';
    }
  },

  async confirmItemDetail() {
    const sku = document.getElementById('oidSkuHidden').value;
    const qty = Math.max(1, parseInt(document.getElementById('oidOrderQty').value) || 1);
    const costPerUnit = Math.max(0, parseFloat(document.getElementById('oidCostPerUnit').value) || 0);
    const newSellingPrice = parseFloat(document.getElementById('oidNewSellingPrice').value) || 0;
    const product = this.products.find(p => p.sku === sku);
    const productName = product ? product.name : sku;

    if (this._detailEditingIdx >= 0) {
      // Update existing item
      this.orderItems[this._detailEditingIdx].quantity = qty;
      this.orderItems[this._detailEditingIdx].cost_price = costPerUnit;
    } else {
      // Add new item
      this.orderItems.push({
        sku: sku,
        product_name: productName,
        quantity: qty,
        cost_price: costPerUnit,
        received_qty: 0
      });
    }

    // Update inventory selling price if changed
    if (product && Math.abs(newSellingPrice - (product.selling_price || 0)) > 0.01) {
      try {
        await fetch(`/api/inventory/${sku}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selling_price: newSellingPrice })
        });
        // Update local cache
        product.selling_price = newSellingPrice;
        App.toast(`Selling price updated to ₹${newSellingPrice.toFixed(2)}`, 'success');
      } catch (e) {
        App.toast('Failed to update selling price', 'error');
      }
    }

    this.closeItemDetailModal();
    this.renderOrderItems();
  },

  /* ---------- Save Order ---------- */
  async saveOrder() {
    const form = document.getElementById('orderForm');
    const orderId = form.elements.order_id.value;
    const supplierId = form.elements.supplier_id.value;

    if (!supplierId) {
      App.toast('Please select a supplier', 'error');
      return;
    }
    if (this.orderItems.length === 0) {
      App.toast('Please add at least one item', 'error');
      return;
    }

    const payload = {
      supplier_id: parseInt(supplierId),
      invoice_number: form.elements.invoice_number.value || '',
      order_date: form.elements.order_date.value,
      expected_date: form.elements.expected_date.value || '',
      status: form.elements.status.value,
      notes: form.elements.notes.value || '',
      items: this.orderItems.map(it => ({
        sku: it.sku,
        product_name: it.product_name,
        quantity: it.quantity,
        cost_price: it.cost_price,
        received_qty: it.received_qty || 0
      }))
    };

    try {
      const url = orderId ? `/api/orders/${orderId}` : '/api/orders';
      const method = orderId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save order');

      App.toast(orderId ? 'Order updated' : `Order ${data.order_number} created`, 'success');
      this.closeModal();
      await this.loadOrders();
      this.applyFilters();
    } catch (e) {
      App.toast(e.message, 'error');
    }
  },

  /* ---------- Delete Order ---------- */
  async deleteOrder(orderId) {
    const ok = await App.confirm('Delete this purchase order?');
    if (!ok) return;

    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete');

      App.toast(data.message, 'success');
      await this.loadOrders();
      this.applyFilters();
    } catch (e) {
      App.toast(e.message, 'error');
    }
  },

  /* ---------- Receive Modal ---------- */
  async openReceiveModal(orderId) {
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) throw new Error('Failed to load order');
      const order = await res.json();

      document.getElementById('receiveOrderId').value = order.id;
      document.getElementById('receiveOrderTitle').textContent = `Receive Order: ${order.order_number}`;
      document.getElementById('receiveNotes').value = '';

      const tbody = document.getElementById('receiveItemsBody');
      tbody.innerHTML = (order.items || []).map(it => {
        const remaining = it.quantity - (it.received_qty || 0);
        return `
          <tr class="border-b">
            <td class="px-3 py-2 text-center">
              <input type="checkbox" class="receive-item-check rounded" data-sku="${esc(it.sku)}" checked />
            </td>
            <td class="px-3 py-2 text-xs">${esc(it.product_name)}</td>
            <td class="px-3 py-2 text-xs text-gray-500">${esc(this._bc(it.sku))}</td>
            <td class="px-3 py-2 text-right text-xs">${it.quantity}</td>
            <td class="px-3 py-2 text-right">
              <input type="number" min="0" max="${remaining}" value="${remaining}"
                class="receive-qty-input w-16 px-1 py-0.5 border rounded text-xs text-right"
                data-sku="${esc(it.sku)}" />
            </td>
            <td class="px-3 py-2 text-right text-xs">₹${Number(it.cost_price || 0).toFixed(2)}</td>
          </tr>`;
      }).join('');

      // Check all by default
      const checkAll = document.getElementById('receiveCheckAll');
      if (checkAll) checkAll.checked = true;

      document.getElementById('receiveOrderModal').classList.remove('hidden');
    } catch (e) {
      App.toast(e.message, 'error');
    }
  },

  closeReceiveModal() {
    document.getElementById('receiveOrderModal').classList.add('hidden');
  },

  async confirmReceive() {
    const orderId = document.getElementById('receiveOrderId').value;
    const notes = document.getElementById('receiveNotes').value;

    const items = [];
    document.querySelectorAll('.receive-item-check').forEach(cb => {
      if (cb.checked) {
        const sku = cb.dataset.sku;
        const qtyInput = document.querySelector(`.receive-qty-input[data-sku="${sku}"]`);
        const qty = parseInt(qtyInput?.value || 0);
        if (qty > 0) {
          items.push({ sku, received_qty: qty });
        }
      }
    });

    if (items.length === 0) {
      App.toast('No items selected to receive', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/orders/${orderId}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, notes })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to receive order');

      App.toast(data.message, 'success');
      this.closeReceiveModal();
      await this.loadOrders();
      this.applyFilters();
    } catch (e) {
      App.toast(e.message, 'error');
    }
  },

  /* ---------- Order Detail View ---------- */
  _viewOrderId: null,

  async showOrderDetail(orderId) {
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) throw new Error('Failed to load order');
      const order = await res.json();
      this._viewOrderId = orderId;

      document.getElementById('orderViewTitle').textContent = `Order Details — ${order.order_number}`;
      document.getElementById('ovOrderNumber').textContent = order.order_number;
      document.getElementById('ovInvoiceNumber').textContent = order.invoice_number || '—';
      document.getElementById('ovSupplier').textContent = order.supplier_name;
      document.getElementById('ovStatus').innerHTML = this._statusBadge(order.status);
      document.getElementById('ovOrderDate').textContent = order.order_date || '—';
      document.getElementById('ovExpectedDate').textContent = order.expected_date || '—';
      document.getElementById('ovTotal').textContent = '₹' + Number(order.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
      document.getElementById('ovReceivedDate').textContent = order.received_date ? order.received_date.split('T')[0] : '—';

      // Notes
      const notesEl = document.getElementById('ovNotes');
      if (order.notes) {
        notesEl.textContent = order.notes;
        notesEl.classList.remove('hidden');
      } else {
        notesEl.classList.add('hidden');
      }

      // Items table
      const tbody = document.getElementById('ovItemsBody');
      tbody.innerHTML = (order.items || []).map((it, i) => `
        <tr class="border-b">
          <td class="px-3 py-2 text-center">${i + 1}</td>
          <td class="px-3 py-2">${esc(it.product_name)}</td>
          <td class="px-3 py-2 text-gray-500">${esc(this._bc(it.sku))}</td>
          <td class="px-3 py-2 text-right">${it.quantity}</td>
          <td class="px-3 py-2 text-right">${it.received_qty || 0}</td>
          <td class="px-3 py-2 text-right">₹${Number(it.cost_price || 0).toFixed(2)}</td>
          <td class="px-3 py-2 text-right font-medium">₹${(it.quantity * it.cost_price).toFixed(2)}</td>
        </tr>`).join('');

      // Footer buttons
      const editBtn = document.getElementById('btnOvEdit');
      if (order.status === 'cancelled') {
        editBtn.classList.add('hidden');
      } else {
        editBtn.classList.remove('hidden');
      }

      // Bind footer actions
      document.getElementById('btnOvClose').onclick = () => this.closeOrderView();
      document.getElementById('orderViewClose').onclick = () => this.closeOrderView();
      document.getElementById('btnOvPrint').onclick = () => { this.closeOrderView(); this.printOrder(orderId); };
      editBtn.onclick = () => { this.closeOrderView(); this.openModal(orderId); };

      document.getElementById('orderViewModal').classList.remove('hidden');
    } catch (e) {
      App.toast(e.message, 'error');
    }
  },

  closeOrderView() {
    document.getElementById('orderViewModal').classList.add('hidden');
    this._viewOrderId = null;
  },

  /* ---------- Print Order ---------- */
  async printOrder(orderId) {
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) throw new Error('Failed to load order');
      const order = await res.json();

      const itemRows = (order.items || []).map((it, i) => `
        <tr>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">${i + 1}</td>
          <td style="padding:6px 10px;border:1px solid #ddd">${esc(it.product_name)}</td>
          <td style="padding:6px 10px;border:1px solid #ddd">${esc(this._bc(it.sku))}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${it.quantity}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">₹${Number(it.cost_price || 0).toFixed(2)}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">₹${(it.quantity * it.cost_price).toFixed(2)}</td>
        </tr>`).join('');

      const html = `
        <html><head><title>Purchase Order - ${esc(order.order_number)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 30px; color: #333; }
          h1 { font-size: 22px; margin-bottom: 5px; }
          .header { display: flex; justify-content: space-between; margin-bottom: 25px; }
          .meta { font-size: 13px; color: #666; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th { background: #e67e22; color: white; padding: 8px 10px; text-align: left; font-size: 12px; }
          td { font-size: 12px; }
          .total-row { font-weight: bold; background: #fef3c7; }
          .footer { margin-top: 30px; font-size: 12px; color: #888; }
          @media print { body { padding: 15px; } }
        </style></head>
        <body>
          <div class="header">
            <div>
              <h1>PURCHASE ORDER</h1>
              <div class="meta">${esc(order.order_number)}</div>
            </div>
            <div style="text-align:right">
              <div class="meta">Status: <strong>${(order.status || 'draft').toUpperCase()}</strong></div>
              <div class="meta">Date: ${order.order_date || ''}</div>
              ${order.expected_date ? `<div class="meta">Expected: ${order.expected_date}</div>` : ''}
            </div>
          </div>
          <div class="meta" style="margin-bottom:15px">
            <strong>Supplier:</strong> ${esc(order.supplier_name)}<br/>
            ${order.notes ? `<strong>Notes:</strong> ${esc(order.notes)}` : ''}
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:40px;text-align:center">#</th>
                <th>Product</th>
                <th>Stockcode</th>
                <th style="text-align:right;width:60px">Qty</th>
                <th style="text-align:right;width:90px">Cost</th>
                <th style="text-align:right;width:90px">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemRows}
              <tr class="total-row">
                <td colspan="5" style="padding:8px 10px;border:1px solid #ddd;text-align:right">Grand Total</td>
                <td style="padding:8px 10px;border:1px solid #ddd;text-align:right">₹${Number(order.total_amount || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
              </tr>
            </tbody>
          </table>
          <div class="footer">
            <p>Next Level Furniture — Purchase Order</p>
          </div>
        </body></html>`;

      const printWin = window.open('', '_blank', 'width=800,height=600');
      printWin.document.write(html);
      printWin.document.close();
      setTimeout(() => { printWin.print(); }, 400);
    } catch (e) {
      App.toast(e.message, 'error');
    }
  }
};
