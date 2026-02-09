/* ========================================
   Customers Module — CRUD + Order Counts
   ======================================== */

const Customers = {
  all: [],
  filtered: [],
  page: 1,
  pageSize: 10,
  sortCol: 'name',
  sortDir: 'asc',

  async init() {
    await this.loadCustomers();
    this.bindEvents();
    this.applyFilters();
  },

  async loadCustomers() {
    try {
      const res = await fetch('/api/customers');
      this.all = await res.json();
    } catch (e) {
      this.all = [];
    }
  },

  bindEvents() {
    // Add customer
    document.getElementById('btnAddCustomer').onclick = () => this.openModal();

    // Close modal
    document.getElementById('customerModalClose').onclick = () =>
      document.getElementById('customerModal').classList.add('hidden');
    document.getElementById('btnCancelCustomer').onclick = () =>
      document.getElementById('customerModal').classList.add('hidden');

    // Form submit
    document.getElementById('customerForm').onsubmit = async (e) => {
      e.preventDefault();
      await this.saveCustomer(e.target);
    };

    // Search
    let debounce;
    document.getElementById('customerSearch').oninput = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { this.page = 1; this.applyFilters(); }, 200);
    };

    // Page size
    document.getElementById('customerPageSize').onchange = () => {
      this.pageSize = parseInt(document.getElementById('customerPageSize').value) || 10;
      this.page = 1;
      this.render();
    };

    // Check-all
    document.getElementById('customerCheckAll').onchange = (e) => {
      document.querySelectorAll('.customer-check').forEach(cb => cb.checked = e.target.checked);
    };

    // Column sorting
    document.querySelectorAll('#customersTable thead th[data-sort]').forEach(th => {
      th.onclick = () => {
        const col = th.dataset.sort;
        if (this.sortCol === col) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortCol = col;
          this.sortDir = 'asc';
        }
        this.sortData();
        this.render();
      };
    });
  },

  applyFilters() {
    const q = (document.getElementById('customerSearch')?.value || '').toLowerCase();
    this.filtered = this.all.filter(c => {
      if (!q) return true;
      const str = [c.name || '', c.phone || '', c.email || '', c.address || ''].join(' ').toLowerCase();
      return str.includes(q);
    });
    this.sortData();
    this.render();
  },

  sortData() {
    const dir = this.sortDir === 'asc' ? 1 : -1;
    const col = this.sortCol;
    this.filtered.sort((a, b) => {
      switch (col) {
        case 'id':
          return (a.id - b.id) * dir;
        case 'name':
          return (a.name || '').localeCompare(b.name || '') * dir;
        case 'phone':
          return (a.phone || '').localeCompare(b.phone || '') * dir;
        case 'orders':
          return ((a.order_count || 0) - (b.order_count || 0)) * dir;
        case 'spent':
          return ((a.total_spent || 0) - (b.total_spent || 0)) * dir;
        default:
          return (a.name || '').localeCompare(b.name || '') * dir;
      }
    });
  },

  render() {
    const tbody = document.getElementById('customersTableBody');
    const total = this.filtered.length;
    const start = (this.page - 1) * this.pageSize;
    const end = Math.min(start + this.pageSize, total);
    const pageData = this.filtered.slice(start, end);

    if (total === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400 text-xs">No customers found</td></tr>';
    } else {
      tbody.innerHTML = pageData.map((c, idx) => {
        const bg = (start + idx) % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        const orders = c.order_count || 0;
        const spent = c.total_spent || 0;
        return `
          <tr class="${bg} hover:bg-blue-50 transition">
            <td class="px-4 py-2.5"><input type="checkbox" class="customer-check rounded" data-id="${c.id}" /></td>
            <td class="px-4 py-2.5 text-gray-500 font-medium">${c.id}</td>
            <td class="px-4 py-2.5 font-semibold text-gray-800">${esc(c.name || '—')}</td>
            <td class="px-4 py-2.5 text-gray-700 font-mono text-xs">${esc(c.phone)}</td>
            <td class="px-4 py-2.5 text-gray-600">${esc(c.email || '—')}</td>
            <td class="px-4 py-2.5 text-right">
              <span class="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-xs font-bold ${orders > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}">${orders}</span>
            </td>
            <td class="px-4 py-2.5 text-right font-semibold ${spent > 0 ? 'text-green-700' : 'text-gray-400'}">${App.currency(spent)}</td>
            <td class="px-4 py-2.5 text-center">
              <div class="flex items-center justify-center gap-1.5">
                <button onclick="Customers.editCustomer(${c.id})"
                  class="w-7 h-7 rounded bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center" title="Edit">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </button>
                <button onclick="Customers.deleteCustomer(${c.id})"
                  class="w-7 h-7 rounded bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center" title="Delete">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              </div>
            </td>
          </tr>`;
      }).join('');
    }

    // Info text
    document.getElementById('customerInfo').textContent =
      total === 0 ? 'No entries found' : `Showing ${start + 1} to ${end} of ${total} entries`;

    // Pagination
    this.renderPagination(total);
  },

  renderPagination(total) {
    const container = document.getElementById('customerPagination');
    const totalPages = Math.ceil(total / this.pageSize);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    const btnClass = (active) => active
      ? 'px-3 py-1 rounded text-xs font-medium bg-teal-500 text-white'
      : 'px-3 py-1 rounded text-xs font-medium bg-white border border-gray-300 text-gray-600 hover:bg-gray-50';

    let html = `<button class="${btnClass(false)} ${this.page <= 1 ? 'opacity-50 cursor-not-allowed' : ''}"
      onclick="Customers.goPage(${this.page - 1})" ${this.page <= 1 ? 'disabled' : ''}>‹ Prev</button>`;

    let startPage = Math.max(1, this.page - 3);
    let endPage = Math.min(totalPages, startPage + 6);
    if (endPage - startPage < 6) startPage = Math.max(1, endPage - 6);

    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="${btnClass(i === this.page)}" onclick="Customers.goPage(${i})">${i}</button>`;
    }

    html += `<button class="${btnClass(false)} ${this.page >= totalPages ? 'opacity-50 cursor-not-allowed' : ''}"
      onclick="Customers.goPage(${this.page + 1})" ${this.page >= totalPages ? 'disabled' : ''}>Next ›</button>`;

    container.innerHTML = html;
  },

  goPage(p) {
    const totalPages = Math.ceil(this.filtered.length / this.pageSize);
    if (p < 1 || p > totalPages) return;
    this.page = p;
    this.render();
  },

  openModal(customer) {
    const modal = document.getElementById('customerModal');
    const form = document.getElementById('customerForm');
    const title = document.getElementById('customerModalTitle');

    title.textContent = customer ? 'Edit Customer' : 'Add Customer';
    form.reset();
    form.elements.customer_id.value = '';

    if (customer) {
      form.elements.customer_id.value = customer.id;
      form.elements.phone.value = customer.phone || '';
      form.elements.name.value = customer.name || '';
      form.elements.email.value = customer.email || '';
      form.elements.address.value = customer.address || '';
      form.elements.notes.value = customer.notes || '';
    }

    modal.classList.remove('hidden');
  },

  editCustomer(id) {
    const customer = this.all.find(c => c.id === id);
    if (customer) this.openModal(customer);
  },

  async saveCustomer(form) {
    const data = {};
    new FormData(form).forEach((v, k) => { if (k !== 'customer_id') data[k] = v; });
    const customerId = form.elements.customer_id.value;

    try {
      let res;
      if (customerId) {
        res = await fetch(`/api/customers/${customerId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else {
        res = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      }
      const result = await res.json();
      if (res.ok) {
        App.toast(customerId ? 'Customer updated' : 'Customer added');
        document.getElementById('customerModal').classList.add('hidden');
        await this.loadCustomers();
        this.applyFilters();
      } else {
        App.toast(result.error || 'Failed to save customer');
      }
    } catch (e) {
      App.toast('Failed to save customer');
    }
  },

  async deleteCustomer(id) {
    const customer = this.all.find(c => c.id === id);
    if (!customer) return;
    const ok = await App.confirm(`Delete customer "${customer.name || customer.phone}"? This cannot be undone.`);
    if (!ok) return;
    try {
      const res = await fetch(`/api/customers/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        App.toast('Customer deleted');
        await this.loadCustomers();
        this.applyFilters();
      } else {
        App.toast(data.error || 'Failed to delete customer');
      }
    } catch (e) {
      App.toast('Failed to delete customer');
    }
  },
};
