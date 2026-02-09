/* ========================================
   Reports Module
   ======================================== */

const Reports = {
  sales: [],
  inventory: [],

  async init() {
    // Set default date range to today
    const today = new Date().toISOString().split('T')[0];
    const startEl = document.getElementById('rptStart');
    const endEl = document.getElementById('rptEnd');
    if (startEl && !startEl.value) startEl.value = today;
    if (endEl && !endEl.value) endEl.value = today;
    this.bindEvents();
    await this.runReport();
  },

  bindEvents() {
    document.getElementById('btnRunReport').onclick = () => this.runReport();
    document.getElementById('btnExportReport').onclick = () => {
      window.location.href = '/api/sales/export';
    };
    document.getElementById('btnPrintReport').onclick = () => window.print();
    document.getElementById('reportType').onchange = () => this.runReport();
  },

  async runReport() {
    const type = document.getElementById('reportType').value;
    const start = document.getElementById('rptStart').value;
    const end = document.getElementById('rptEnd').value;

    // Load sales data
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);

    try {
      const res = await fetch(`/api/sales?${params}`);
      this.sales = await res.json();
    } catch (e) { this.sales = []; }

    // Update header
    const startFmt = start ? new Date(start + 'T00:00').toLocaleDateString('en-IN') : '--';
    const endFmt = end ? new Date(end + 'T23:59').toLocaleDateString('en-IN') : '--';
    const typeLabels = { summary:'Summary', sales:'Sales Report', day:'Day Report', tender:'Tender Report', lowstock:'Low Stock Report', category:'Category Report' };
    document.getElementById('rptTitle').textContent = `${typeLabels[type] || type} - All`;
    document.getElementById('rptRange').textContent = `Range: ${startFmt} — ${endFmt}`;

    switch (type) {
      case 'summary': this.renderSummary(); break;
      case 'sales': this.renderSalesReport(); break;
      case 'day': this.renderDayReport(); break;
      case 'tender': this.renderTenderReport(); break;
      case 'lowstock': await this.renderLowStock(); break;
      case 'category': this.renderCategoryReport(); break;
    }
  },

  /* ----- Summary Report ----- */
  renderSummary() {
    const head = document.getElementById('rptHead');
    const body = document.getElementById('rptBody');

    head.innerHTML = '<tr><th class="px-4 py-2.5 text-left"></th><th class="px-4 py-2.5 text-right"># Sales</th><th class="px-4 py-2.5 text-right">Total</th></tr>';

    const totalSales = this.sales.length;
    const totalAmount = this.sales.reduce((s, x) => s + (x.grand_total || 0), 0);
    const totalItems = this.sales.reduce((s, x) => s + (x.items || []).reduce((a, i) => a + (i.quantity || 1), 0), 0);
    const avgTicket = totalSales > 0 ? totalAmount / totalSales : 0;

    const rows = [
      ['Total Sales', totalSales, App.currency(totalAmount)],
      ['Total Items Sold', totalItems, ''],
      ['Average Ticket', '', App.currency(avgTicket)],
      ['Cash Sales', this.sales.filter(s => s.payment_method === 'Cash').length, App.currency(this.sales.filter(s => s.payment_method === 'Cash').reduce((a, s) => a + (s.grand_total || 0), 0))],
      ['Card Sales', this.sales.filter(s => s.payment_method === 'Card').length, App.currency(this.sales.filter(s => s.payment_method === 'Card').reduce((a, s) => a + (s.grand_total || 0), 0))],
      ['UPI Sales', this.sales.filter(s => s.payment_method === 'UPI').length, App.currency(this.sales.filter(s => s.payment_method === 'UPI').reduce((a, s) => a + (s.grand_total || 0), 0))],
      ['Other', this.sales.filter(s => !['Cash','Card','UPI'].includes(s.payment_method)).length, App.currency(this.sales.filter(s => !['Cash','Card','UPI'].includes(s.payment_method)).reduce((a, s) => a + (s.grand_total || 0), 0))],
    ];

    body.innerHTML = rows.map((r, i) => `
      <tr class="${i % 2 ? 'bg-gray-50' : 'bg-white'} hover:bg-blue-50">
        <td class="px-4 py-2 font-medium text-gray-700">${r[0]}</td>
        <td class="px-4 py-2 text-right text-gray-600">${r[1]}</td>
        <td class="px-4 py-2 text-right font-semibold">${r[2]}</td>
      </tr>`).join('');
  },

  /* ----- Sales Report (individual transactions) ----- */
  renderSalesReport() {
    const head = document.getElementById('rptHead');
    const body = document.getElementById('rptBody');

    head.innerHTML = '<tr><th class="px-4 py-2.5 text-left">Receipt #</th><th class="px-4 py-2.5 text-left">Date</th><th class="px-4 py-2.5 text-right">Items</th><th class="px-4 py-2.5 text-right">Total</th><th class="px-4 py-2.5 text-left">Payment</th><th class="px-4 py-2.5 text-left">Cashier</th><th class="px-4 py-2.5 text-right">Actions</th></tr>';

    if (this.sales.length === 0) {
      body.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">No sales in this period</td></tr>';
      return;
    }

    body.innerHTML = this.sales.map((s, i) => {
      const itemCount = (s.items || []).reduce((a, x) => a + (x.quantity || 1), 0);
      const payBadge = s.payment_method === 'Cash' ? 'bg-green-100 text-green-700' :
                       s.payment_method === 'Card' ? 'bg-blue-100 text-blue-700' :
                       s.payment_method === 'UPI' ? 'bg-orange-100 text-orange-700' :
                       'bg-purple-100 text-purple-700';
      return `
        <tr class="${i % 2 ? 'bg-gray-50' : 'bg-white'} hover:bg-blue-50">
          <td class="px-4 py-2 font-mono text-[11px]">${esc(s.receipt_number)}</td>
          <td class="px-4 py-2 text-gray-600">${esc(new Date(s.timestamp).toLocaleString('en-IN'))}</td>
          <td class="px-4 py-2 text-right">${itemCount}</td>
          <td class="px-4 py-2 text-right font-semibold">${App.currency(s.grand_total)}</td>
          <td class="px-4 py-2"><span class="px-2 py-0.5 rounded-full text-[10px] font-medium ${payBadge}">${esc(s.payment_method)}</span></td>
          <td class="px-4 py-2 text-gray-600">${esc(s.cashier || '')}</td>
          <td class="px-4 py-2 text-right"><button onclick="Reports.viewReceipt('${esc(s.receipt_number)}')" class="text-blue-600 hover:underline">View</button></td>
        </tr>`;
    }).join('');
  },

  /* ----- Day Report (grouped by date) ----- */
  renderDayReport() {
    const head = document.getElementById('rptHead');
    const body = document.getElementById('rptBody');

    head.innerHTML = '<tr><th class="px-4 py-2.5 text-left">Date</th><th class="px-4 py-2.5 text-right"># Sales</th><th class="px-4 py-2.5 text-right">Total</th><th class="px-4 py-2.5 text-right">Avg Ticket</th></tr>';

    const byDate = {};
    this.sales.forEach(s => {
      const d = s.date || s.timestamp?.split('T')[0] || 'Unknown';
      if (!byDate[d]) byDate[d] = { count: 0, total: 0 };
      byDate[d].count++;
      byDate[d].total += s.grand_total || 0;
    });

    const rows = Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0]));
    if (rows.length === 0) {
      body.innerHTML = '<tr><td colspan="4" class="px-4 py-8 text-center text-gray-400">No sales in this period</td></tr>';
      return;
    }

    body.innerHTML = rows.map(([date, d], i) => `
      <tr class="${i % 2 ? 'bg-gray-50' : 'bg-white'} hover:bg-blue-50">
        <td class="px-4 py-2 font-medium text-gray-700">${date}</td>
        <td class="px-4 py-2 text-right">${d.count}</td>
        <td class="px-4 py-2 text-right font-semibold">${App.currency(d.total)}</td>
        <td class="px-4 py-2 text-right text-gray-600">${App.currency(d.total / d.count)}</td>
      </tr>`).join('');
  },

  /* ----- Tender Report (by payment method) ----- */
  renderTenderReport() {
    const head = document.getElementById('rptHead');
    const body = document.getElementById('rptBody');

    head.innerHTML = '<tr><th class="px-4 py-2.5 text-left">Payment Method</th><th class="px-4 py-2.5 text-right"># Sales</th><th class="px-4 py-2.5 text-right">Total</th></tr>';

    const byMethod = {};
    this.sales.forEach(s => {
      const m = s.payment_method || 'Other';
      if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
      byMethod[m].count++;
      byMethod[m].total += s.grand_total || 0;
    });

    const rows = Object.entries(byMethod).sort((a, b) => b[1].total - a[1].total);
    body.innerHTML = rows.map(([method, d], i) => `
      <tr class="${i % 2 ? 'bg-gray-50' : 'bg-white'} hover:bg-blue-50">
        <td class="px-4 py-2 font-medium text-gray-700">${method}</td>
        <td class="px-4 py-2 text-right">${d.count}</td>
        <td class="px-4 py-2 text-right font-semibold">${App.currency(d.total)}</td>
      </tr>`).join('');
  },

  /* ----- Low Stock Report ----- */
  async renderLowStock() {
    const head = document.getElementById('rptHead');
    const body = document.getElementById('rptBody');

    head.innerHTML = '<tr><th class="px-4 py-2.5 text-left">SKU</th><th class="px-4 py-2.5 text-left">Name</th><th class="px-4 py-2.5 text-left">Category</th><th class="px-4 py-2.5 text-right">Qty</th><th class="px-4 py-2.5 text-right">Reorder Pt</th><th class="px-4 py-2.5 text-right">Cost</th></tr>';

    try {
      const res = await fetch('/api/inventory?low_stock=true');
      this.inventory = await res.json();
    } catch (e) { this.inventory = []; }

    if (this.inventory.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">No low stock items</td></tr>';
      return;
    }

    body.innerHTML = this.inventory.map((p, i) => `
      <tr class="${i % 2 ? 'bg-gray-50' : 'bg-white'} hover:bg-blue-50">
        <td class="px-4 py-2 font-mono text-[11px] text-gray-500">${esc(p.sku)}</td>
        <td class="px-4 py-2 font-medium text-gray-700">${esc(p.name)}</td>
        <td class="px-4 py-2 text-gray-600">${esc(p.category)}</td>
        <td class="px-4 py-2 text-right font-bold text-red-600">${p.quantity}</td>
        <td class="px-4 py-2 text-right text-gray-500">${p.reorder_level || 0}</td>
        <td class="px-4 py-2 text-right">${App.currency(p.cost_price)}</td>
      </tr>`).join('');
  },

  /* ----- Category Report ----- */
  renderCategoryReport() {
    const head = document.getElementById('rptHead');
    const body = document.getElementById('rptBody');

    head.innerHTML = '<tr><th class="px-4 py-2.5 text-left">Category</th><th class="px-4 py-2.5 text-right"># Items Sold</th><th class="px-4 py-2.5 text-right">Revenue</th></tr>';

    const byCat = {};
    this.sales.forEach(s => {
      (s.items || []).forEach(item => {
        const cat = item.category || 'Uncategorized';
        if (!byCat[cat]) byCat[cat] = { qty: 0, revenue: 0 };
        byCat[cat].qty += item.quantity || 1;
        byCat[cat].revenue += item.line_total || 0;
      });
    });

    const rows = Object.entries(byCat).sort((a, b) => b[1].revenue - a[1].revenue);
    if (rows.length === 0) {
      body.innerHTML = '<tr><td colspan="3" class="px-4 py-8 text-center text-gray-400">No sales data for categories</td></tr>';
      return;
    }

    body.innerHTML = rows.map(([cat, d], i) => `
      <tr class="${i % 2 ? 'bg-gray-50' : 'bg-white'} hover:bg-blue-50">
        <td class="px-4 py-2 font-medium text-gray-700">${esc(cat)}</td>
        <td class="px-4 py-2 text-right">${d.qty}</td>
        <td class="px-4 py-2 text-right font-semibold">${App.currency(d.revenue)}</td>
      </tr>`).join('');
  },

  async viewReceipt(receiptNumber) {
    try {
      const res = await fetch(`/api/sales/${receiptNumber}`);
      const sale = await res.json();
      POS.showReceipt(sale);
    } catch (e) {
      App.toast('Failed to load receipt');
    }
  },
};
