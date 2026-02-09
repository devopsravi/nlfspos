/* ========================================
   Suppliers Module — CRUD + Item Counts
   ======================================== */

const Suppliers = {
  all: [],
  filtered: [],
  page: 1,
  pageSize: 10,
  sortCol: 'name',
  sortDir: 'asc',

  async init() {
    await this.loadSuppliers();
    this.bindEvents();
    this.applyFilters();
  },

  async loadSuppliers() {
    try {
      const res = await fetch('/api/suppliers');
      this.all = await res.json();
    } catch (e) {
      this.all = [];
    }
  },

  bindEvents() {
    // Add supplier
    document.getElementById('btnAddSupplier').onclick = () => this.openModal();

    // Close modal
    document.getElementById('supplierModalClose').onclick = () =>
      document.getElementById('supplierModal').classList.add('hidden');
    document.getElementById('btnCancelSupplier').onclick = () =>
      document.getElementById('supplierModal').classList.add('hidden');

    // Form submit
    document.getElementById('supplierForm').onsubmit = async (e) => {
      e.preventDefault();
      await this.saveSupplier(e.target);
    };

    // Search
    let debounce;
    document.getElementById('supplierSearch').oninput = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { this.page = 1; this.applyFilters(); }, 200);
    };

    // Page size
    document.getElementById('supplierPageSize').onchange = () => {
      this.pageSize = parseInt(document.getElementById('supplierPageSize').value) || 10;
      this.page = 1;
      this.render();
    };

    // Check-all
    document.getElementById('supplierCheckAll').onchange = (e) => {
      document.querySelectorAll('.supplier-check').forEach(cb => cb.checked = e.target.checked);
    };

    // Column sorting
    document.querySelectorAll('#suppliersTable thead th[data-sort]').forEach(th => {
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
    const q = (document.getElementById('supplierSearch')?.value || '').toLowerCase();
    this.filtered = this.all.filter(s => {
      if (!q) return true;
      const str = [s.name || '', s.contact_person || '', s.phone || '', s.email || ''].join(' ').toLowerCase();
      return str.includes(q);
    });
    this.sortData();
    this.render();
  },

  sortData() {
    const dir = this.sortDir === 'asc' ? 1 : -1;
    const col = this.sortCol;
    this.filtered.sort((a, b) => {
      let va, vb;
      switch (col) {
        case 'id':
          return (a.id - b.id) * dir;
        case 'name':
          return (a.name || '').localeCompare(b.name || '') * dir;
        case 'items':
          return ((a.item_count || 0) - (b.item_count || 0)) * dir;
        default:
          return (a.name || '').localeCompare(b.name || '') * dir;
      }
    });
  },

  render() {
    const tbody = document.getElementById('suppliersTableBody');
    const total = this.filtered.length;
    const start = (this.page - 1) * this.pageSize;
    const end = Math.min(start + this.pageSize, total);
    const pageData = this.filtered.slice(start, end);

    if (total === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400 text-xs">No suppliers found</td></tr>';
    } else {
      tbody.innerHTML = pageData.map((s, idx) => {
        const bg = (start + idx) % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        const itemCount = s.item_count || 0;
        return `
          <tr class="${bg} hover:bg-blue-50 transition">
            <td class="px-4 py-2.5"><input type="checkbox" class="supplier-check rounded" data-id="${s.id}" /></td>
            <td class="px-4 py-2.5 text-gray-500 font-medium">${s.id}</td>
            <td class="px-4 py-2.5 font-semibold text-gray-800">${esc(s.name)}</td>
            <td class="px-4 py-2.5 text-gray-600">${esc(s.contact_person || '—')}</td>
            <td class="px-4 py-2.5 text-gray-600">${esc(s.phone || '—')}</td>
            <td class="px-4 py-2.5 text-right">
              <span class="text-blue-600 font-bold cursor-pointer hover:underline" onclick="Suppliers.viewItems('${esc(s.name)}')" title="View items from this supplier">${itemCount}</span>
            </td>
            <td class="px-4 py-2.5 text-center">
              <div class="flex items-center justify-center gap-1.5">
                <button onclick="Suppliers.editSupplier(${s.id})"
                  class="w-7 h-7 rounded bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center" title="Edit">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </button>
                <button onclick="Suppliers.deleteSupplier(${s.id})"
                  class="w-7 h-7 rounded bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center" title="Delete">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              </div>
            </td>
          </tr>`;
      }).join('');
    }

    // Info text
    document.getElementById('supplierInfo').textContent =
      total === 0 ? 'No entries found' : `Showing ${start + 1} to ${end} of ${total} entries`;

    // Pagination
    this.renderPagination(total);
  },

  renderPagination(total) {
    const container = document.getElementById('supplierPagination');
    const totalPages = Math.ceil(total / this.pageSize);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    const btnClass = (active) => active
      ? 'px-3 py-1 rounded text-xs font-medium bg-teal-500 text-white'
      : 'px-3 py-1 rounded text-xs font-medium bg-white border border-gray-300 text-gray-600 hover:bg-gray-50';

    let html = `<button class="${btnClass(false)} ${this.page <= 1 ? 'opacity-50 cursor-not-allowed' : ''}"
      onclick="Suppliers.goPage(${this.page - 1})" ${this.page <= 1 ? 'disabled' : ''}>‹ Prev</button>`;

    let startPage = Math.max(1, this.page - 3);
    let endPage = Math.min(totalPages, startPage + 6);
    if (endPage - startPage < 6) startPage = Math.max(1, endPage - 6);

    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="${btnClass(i === this.page)}" onclick="Suppliers.goPage(${i})">${i}</button>`;
    }

    html += `<button class="${btnClass(false)} ${this.page >= totalPages ? 'opacity-50 cursor-not-allowed' : ''}"
      onclick="Suppliers.goPage(${this.page + 1})" ${this.page >= totalPages ? 'disabled' : ''}>Next ›</button>`;

    container.innerHTML = html;
  },

  goPage(p) {
    const totalPages = Math.ceil(this.filtered.length / this.pageSize);
    if (p < 1 || p > totalPages) return;
    this.page = p;
    this.render();
  },

  openModal(supplier) {
    const modal = document.getElementById('supplierModal');
    const form = document.getElementById('supplierForm');
    const title = document.getElementById('supplierModalTitle');

    title.textContent = supplier ? 'Edit Supplier' : 'Add Supplier';
    form.reset();
    form.elements.supplier_id.value = '';

    if (supplier) {
      form.elements.supplier_id.value = supplier.id;
      form.elements.name.value = supplier.name || '';
      form.elements.contact_person.value = supplier.contact_person || '';
      form.elements.phone.value = supplier.phone || '';
      form.elements.email.value = supplier.email || '';
      form.elements.address.value = supplier.address || '';
      form.elements.notes.value = supplier.notes || '';
    }

    modal.classList.remove('hidden');
  },

  editSupplier(id) {
    const supplier = this.all.find(s => s.id === id);
    if (supplier) this.openModal(supplier);
  },

  async saveSupplier(form) {
    const data = {};
    new FormData(form).forEach((v, k) => { if (k !== 'supplier_id') data[k] = v; });
    const supplierId = form.elements.supplier_id.value;

    try {
      let res;
      if (supplierId) {
        res = await fetch(`/api/suppliers/${supplierId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else {
        res = await fetch('/api/suppliers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      }
      const result = await res.json();
      if (res.ok) {
        App.toast(supplierId ? 'Supplier updated' : 'Supplier added');
        document.getElementById('supplierModal').classList.add('hidden');
        await this.loadSuppliers();
        this.applyFilters();
      } else {
        App.toast(result.error || 'Failed to save supplier');
      }
    } catch (e) {
      App.toast('Failed to save supplier');
    }
  },

  async deleteSupplier(id) {
    const supplier = this.all.find(s => s.id === id);
    if (!supplier) return;
    const ok = await App.confirm(`Delete supplier "${supplier.name}"? This cannot be undone.`);
    if (!ok) return;
    try {
      const res = await fetch(`/api/suppliers/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        App.toast('Supplier deleted');
        await this.loadSuppliers();
        this.applyFilters();
      } else {
        App.toast(data.error || 'Failed to delete supplier');
      }
    } catch (e) {
      App.toast('Failed to delete supplier');
    }
  },

  viewItems(supplierName) {
    // Navigate to inventory and filter by supplier
    App.navigate('inventory');
    setTimeout(() => {
      const search = document.getElementById('invSearch');
      if (search) {
        search.value = supplierName;
        search.dispatchEvent(new Event('input'));
      }
    }, 200);
  },
};
