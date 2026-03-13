/* ========================================
   Categories Module — CRUD management
   ======================================== */

const Categories = {
  all: [],
  filtered: [],
  productCounts: {},

  async init() {
    await this.loadCategories();
    await this.loadProductCounts();
    this.bindEvents();
    this.applyFilters();
  },

  async loadCategories() {
    try {
      const res = await fetch('/api/categories');
      this.all = await res.json();
    } catch (e) {
      this.all = [];
    }
  },

  async loadProductCounts() {
    try {
      const res = await fetch('/api/inventory?limit=99999');
      const data = await res.json();
      const products = data.items || data || [];
      this.productCounts = {};
      products.forEach(p => {
        const cat = p.category || '';
        if (cat) this.productCounts[cat] = (this.productCounts[cat] || 0) + 1;
      });
    } catch (e) {
      this.productCounts = {};
    }
  },

  bindEvents() {
    document.getElementById('btnAddCategory').onclick = () => this.openModal();

    document.getElementById('categoryModalClose').onclick = () =>
      document.getElementById('categoryModal').classList.add('hidden');
    document.getElementById('categoryFormCancel').onclick = () =>
      document.getElementById('categoryModal').classList.add('hidden');

    document.getElementById('categoryForm').onsubmit = async (e) => {
      e.preventDefault();
      await this.saveCategory();
    };

    let debounce;
    document.getElementById('categorySearch').oninput = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => this.applyFilters(), 200);
    };
  },

  applyFilters() {
    const q = (document.getElementById('categorySearch')?.value || '').toLowerCase().trim();
    this.filtered = this.all.filter(c =>
      !q || c.name.toLowerCase().includes(q)
    );
    this.render();
  },

  render() {
    const tbody = document.getElementById('categoriesTableBody');
    if (!tbody) return;

    document.getElementById('categoryCount').textContent = `${this.all.length} categories`;

    if (this.filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-8 text-center text-gray-400 text-xs">No categories found</td></tr>';
      return;
    }

    tbody.innerHTML = this.filtered.map((cat, idx) => {
      const count = this.productCounts[cat.name] || 0;
      return `<tr class="hover:bg-amber-50/50 transition-colors">
        <td class="px-4 py-2.5 text-gray-400 text-xs">${idx + 1}</td>
        <td class="px-4 py-2.5 font-medium">${esc(cat.name)}</td>
        <td class="px-4 py-2.5 text-right">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${count > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}">${count}</span>
        </td>
        <td class="px-4 py-2.5 text-center">
          <div class="flex items-center justify-center gap-1">
            <button onclick="Categories.openModal(${cat.id})" class="p-1.5 hover:bg-amber-100 rounded-lg text-amber-600" title="Edit">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>
            <button onclick="Categories.deleteCategory(${cat.id}, '${esc(cat.name)}')" class="p-1.5 hover:bg-red-100 rounded-lg text-red-500" title="Delete">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');
  },

  openModal(id) {
    const modal = document.getElementById('categoryModal');
    const title = document.getElementById('categoryModalTitle');
    const input = document.getElementById('categoryNameInput');
    const editId = document.getElementById('categoryEditId');

    if (id) {
      const cat = this.all.find(c => c.id === id);
      if (!cat) return;
      title.textContent = 'Edit Category';
      editId.value = id;
      input.value = cat.name;
    } else {
      title.textContent = 'Add Category';
      editId.value = '';
      input.value = '';
    }

    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
  },

  async saveCategory() {
    const editId = document.getElementById('categoryEditId').value;
    const name = document.getElementById('categoryNameInput').value.trim();
    if (!name) return;

    try {
      const url = editId ? `/api/categories/${editId}` : '/api/categories';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) {
        App.toast(data.error || 'Failed to save category', 'error');
        return;
      }
      App.toast(editId ? 'Category updated' : 'Category added');
      document.getElementById('categoryModal').classList.add('hidden');
      await this.loadCategories();
      await this.loadProductCounts();
      this.applyFilters();
      if (typeof Inventory !== 'undefined' && Inventory.loadCategories) {
        Inventory.loadCategories();
      }
    } catch (e) {
      App.toast('Error saving category', 'error');
    }
  },

  async deleteCategory(id, name) {
    const count = this.productCounts[name] || 0;
    if (count > 0) {
      App.toast(`Cannot delete "${name}" — ${count} product(s) use it`, 'error');
      return;
    }

    const ok = await App.confirm(`Delete category "${name}"?`, 'This action cannot be undone.');
    if (!ok) return;

    try {
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        App.toast(data.error || 'Failed to delete', 'error');
        return;
      }
      App.toast('Category deleted');
      await this.loadCategories();
      await this.loadProductCounts();
      this.applyFilters();
      if (typeof Inventory !== 'undefined' && Inventory.loadCategories) {
        Inventory.loadCategories();
      }
    } catch (e) {
      App.toast('Error deleting category', 'error');
    }
  }
};
