/* ========================================
   Transactions Module — Sales List View
   ======================================== */

const Transactions = {
  allSales: [],
  filtered: [],
  page: 1,
  pageSize: 10,
  sortCol: 'date',
  sortDir: 'desc',

  async init() {
    await this.loadSales();
    this.bindEvents();
    this.applyFilters();
  },

  async loadSales() {
    try {
      const res = await fetch('/api/sales');
      this.allSales = await res.json();
    } catch (e) {
      this.allSales = [];
    }
  },

  bindEvents() {
    // Search button
    document.getElementById('btnTxnSearch').onclick = () => {
      this.page = 1;
      this.applyFilters();
    };

    // Search on Enter
    document.getElementById('txnSearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.page = 1;
        this.applyFilters();
      }
    });

    // Page size
    document.getElementById('txnPageSize').onchange = () => {
      this.pageSize = parseInt(document.getElementById('txnPageSize').value) || 10;
      this.page = 1;
      this.render();
    };

    // Export CSV
    document.getElementById('btnTxnExport').onclick = () => {
      window.location.href = '/api/sales/export';
    };

    // Check-all checkbox
    document.getElementById('txnCheckAll').onchange = (e) => {
      document.querySelectorAll('.txn-check').forEach(cb => cb.checked = e.target.checked);
    };

    // Column sorting
    document.querySelectorAll('#txnTable thead th[data-sort]').forEach(th => {
      th.onclick = () => {
        const col = th.dataset.sort;
        if (this.sortCol === col) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortCol = col;
          this.sortDir = 'desc';
        }
        this.sortData();
        this.render();
      };
    });

    // Set default date range to last 30 days
    const today = new Date().toISOString().split('T')[0];
    const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const fromEl = document.getElementById('txnDateFrom');
    const toEl = document.getElementById('txnDateTo');
    if (fromEl && !fromEl.value) fromEl.value = thirtyAgo;
    if (toEl && !toEl.value) toEl.value = today;
  },

  applyFilters() {
    const q = (document.getElementById('txnSearch')?.value || '').toLowerCase();
    const dateFrom = document.getElementById('txnDateFrom')?.value || '';
    const dateTo = document.getElementById('txnDateTo')?.value || '';
    const payFilter = document.getElementById('txnPayFilter')?.value || '';
    const statusFilter = document.getElementById('txnStatusFilter')?.value || '';

    this.filtered = this.allSales.filter(s => {
      // Date range
      if (dateFrom && (s.date || '') < dateFrom) return false;
      if (dateTo && (s.date || '') > dateTo) return false;

      // Payment method
      if (payFilter && (s.payment_method || '') !== payFilter) return false;

      // Status (all sales are "Complete" in current system)
      const status = this.getStatus(s);
      if (statusFilter && status !== statusFilter) return false;

      // Text search
      if (q) {
        const searchStr = [
          s.receipt_number || '',
          s.cashier || '',
          s.customer_name || '',
          s.customer_phone || '',
          s.payment_method || '',
          String(s.grand_total || ''),
        ].join(' ').toLowerCase();
        if (!searchStr.includes(q)) return false;
      }

      return true;
    });

    this.sortData();
    this.render();
  },

  getStatus(sale) {
    return sale.status || 'Complete';
  },

  getItemCount(sale) {
    return (sale.items || []).reduce((sum, i) => sum + (i.quantity || 1), 0);
  },

  sortData() {
    const dir = this.sortDir === 'asc' ? 1 : -1;
    const col = this.sortCol;

    this.filtered.sort((a, b) => {
      let va, vb;
      switch (col) {
        case 'id':
          va = a.id || 0;
          vb = b.id || 0;
          break;
        case 'receipt':
          va = a.receipt_number || '';
          vb = b.receipt_number || '';
          return va.localeCompare(vb) * dir;
        case 'cashier':
          va = (a.cashier || '').toLowerCase();
          vb = (b.cashier || '').toLowerCase();
          return va.localeCompare(vb) * dir;
        case 'method':
          va = (a.payment_method || '').toLowerCase();
          vb = (b.payment_method || '').toLowerCase();
          return va.localeCompare(vb) * dir;
        case 'items':
          va = this.getItemCount(a);
          vb = this.getItemCount(b);
          break;
        case 'date':
          va = a.timestamp || '';
          vb = b.timestamp || '';
          return va.localeCompare(vb) * dir;
        case 'total':
          va = a.grand_total || 0;
          vb = b.grand_total || 0;
          break;
        default:
          va = a.timestamp || '';
          vb = b.timestamp || '';
          return va.localeCompare(vb) * dir;
      }
      return (va - vb) * dir;
    });
  },

  render() {
    const tbody = document.getElementById('txnTableBody');
    const total = this.filtered.length;
    const start = (this.page - 1) * this.pageSize;
    const end = Math.min(start + this.pageSize, total);
    const pageData = this.filtered.slice(start, end);

    if (total === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="px-4 py-10 text-center text-gray-400 text-sm">No transactions found</td></tr>';
    } else {
      tbody.innerHTML = pageData.map((s, idx) => {
        const globalIdx = start + idx;
        const itemCount = this.getItemCount(s);
        const status = this.getStatus(s);
        const isVoided = status === 'Voided';
        const statusClass = status === 'Complete'
          ? 'bg-green-100 text-green-700'
          : isVoided
            ? 'bg-red-100 text-red-700'
            : 'bg-gray-100 text-gray-600';
        const rowBg = isVoided
          ? 'bg-red-50 opacity-70'
          : (globalIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50');
        const receiptShort = (s.receipt_number || '').replace('INV-', '').replace(/-/g, '');
        const dt = s.timestamp ? new Date(s.timestamp).toLocaleString('en-IN', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }) : '';

        return `
          <tr class="${rowBg} hover:bg-blue-50 transition">
            <td class="px-4 py-2.5"><input type="checkbox" class="txn-check rounded" data-id="${esc(s.receipt_number)}" /></td>
            <td class="px-4 py-2.5 text-gray-500 font-medium">${s.id || globalIdx + 1}</td>
            <td class="px-4 py-2.5">
              <a href="#" onclick="Transactions.viewReceipt('${esc(s.receipt_number)}');return false;"
                 class="text-blue-600 hover:underline font-medium">${esc(receiptShort.slice(-4) || s.receipt_number)}</a>
            </td>
            <td class="px-4 py-2.5 text-gray-700">${esc(s.cashier || 'Staff')}</td>
            <td class="px-4 py-2.5 text-gray-600">${esc(s.payment_method || 'Cash')}</td>
            <td class="px-4 py-2.5 text-right font-medium">${itemCount}</td>
            <td class="px-4 py-2.5 text-gray-600">${esc(dt)}</td>
            <td class="px-4 py-2.5 text-right font-semibold">${App.currency(s.grand_total)}</td>
            <td class="px-4 py-2.5 text-center">
              <span class="px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusClass}">${esc(status)}</span>
            </td>
            <td class="px-4 py-2.5 text-center">
              <div class="flex items-center justify-center gap-1.5">
                <button onclick="Transactions.viewReceipt('${esc(s.receipt_number)}')"
                  class="w-7 h-7 rounded bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center" title="View Receipt">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                </button>
                <button onclick="Transactions.printReceipt('${esc(s.receipt_number)}')"
                  class="w-7 h-7 rounded bg-green-50 hover:bg-green-100 text-green-600 flex items-center justify-center" title="Print Receipt">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                </button>
                ${!isVoided ? `
                <button onclick="Transactions.voidSale('${esc(s.receipt_number)}')"
                  class="w-7 h-7 rounded bg-red-50 hover:bg-red-100 text-red-600 flex items-center justify-center" title="Void Sale">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18.364 5.636l-12.728 12.728M5.636 5.636l12.728 12.728"/></svg>
                </button>` : `
                <span class="w-7 h-7 rounded bg-gray-100 text-gray-400 flex items-center justify-center" title="Already Voided">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18.364 5.636l-12.728 12.728M5.636 5.636l12.728 12.728"/></svg>
                </span>`}
              </div>
            </td>
          </tr>`;
      }).join('');
    }

    // Update info text
    document.getElementById('txnInfo').textContent =
      total === 0
        ? 'No entries found'
        : `Showing ${start + 1} to ${end} of ${total} entries`;

    // Render pagination
    this.renderPagination(total);
  },

  renderPagination(total) {
    const container = document.getElementById('txnPagination');
    const totalPages = Math.ceil(total / this.pageSize);

    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    const btnClass = (active) => active
      ? 'px-3 py-1.5 rounded text-sm font-medium bg-teal-500 text-white'
      : 'px-3 py-1.5 rounded text-sm font-medium bg-white border border-gray-300 text-gray-600 hover:bg-gray-50';

    let html = '';

    // Previous
    html += `<button class="${btnClass(false)} ${this.page <= 1 ? 'opacity-50 cursor-not-allowed' : ''}"
      onclick="Transactions.goPage(${this.page - 1})" ${this.page <= 1 ? 'disabled' : ''}>‹ Prev</button>`;

    // Page numbers (show max 7)
    let startPage = Math.max(1, this.page - 3);
    let endPage = Math.min(totalPages, startPage + 6);
    if (endPage - startPage < 6) startPage = Math.max(1, endPage - 6);

    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="${btnClass(i === this.page)}" onclick="Transactions.goPage(${i})">${i}</button>`;
    }

    // Next
    html += `<button class="${btnClass(false)} ${this.page >= totalPages ? 'opacity-50 cursor-not-allowed' : ''}"
      onclick="Transactions.goPage(${this.page + 1})" ${this.page >= totalPages ? 'disabled' : ''}>Next ›</button>`;

    container.innerHTML = html;
  },

  goPage(p) {
    const totalPages = Math.ceil(this.filtered.length / this.pageSize);
    if (p < 1 || p > totalPages) return;
    this.page = p;
    this.render();
    // Scroll to top of table
    document.getElementById('txnTable')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  async viewReceipt(receiptNumber) {
    try {
      const res = await fetch(`/api/sales/${encodeURIComponent(receiptNumber)}`);
      if (res.ok) {
        const sale = await res.json();
        POS.showReceipt(sale);
      } else {
        App.toast('Receipt not found');
      }
    } catch (e) {
      App.toast('Failed to load receipt');
    }
  },

  async printReceipt(receiptNumber) {
    try {
      const res = await fetch(`/api/sales/${encodeURIComponent(receiptNumber)}`);
      if (res.ok) {
        const sale = await res.json();
        POS.showReceipt(sale);
        // Auto-trigger print after a short delay
        setTimeout(() => {
          document.getElementById('btnPrintReceipt')?.click();
        }, 300);
      } else {
        App.toast('Receipt not found');
      }
    } catch (e) {
      App.toast('Failed to load receipt');
    }
  },

  async voidSale(receiptNumber) {
    const reason = prompt('Reason for voiding this sale (optional):');
    if (reason === null) return; // User cancelled

    if (!confirm(`Are you sure you want to VOID sale ${receiptNumber}?\n\nThis will:\n• Mark the sale as Voided\n• Restore all item quantities to inventory\n\nThis action cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/sales/${encodeURIComponent(receiptNumber)}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || '' }),
      });
      const data = await res.json();

      if (res.ok) {
        App.toast(data.message || 'Sale voided successfully', 3000);
        // Reload sales data and re-render
        await this.loadSales();
        this.applyFilters();
      } else {
        App.toast(data.error || 'Failed to void sale', 3000);
      }
    } catch (e) {
      App.toast('Failed to void sale');
    }
  },
};
