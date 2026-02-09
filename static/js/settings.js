/* ========================================
   Settings Module — sub-sections & user mgmt
   ======================================== */

const Settings = {
  users: [],
  editingUserId: null,
  currentSub: 'staff',

  async init(sub) {
    this.currentSub = sub || 'staff';
    this.showSub(this.currentSub);
    if (this.currentSub === 'staff') await this.loadUsers();
    if (this.currentSub === 'store') this.populateStore();
    if (this.currentSub === 'pos') this.populatePOS();
    this.bindEvents();
  },

  /* ----- Sub-section switching ----- */
  showSub(sub) {
    document.querySelectorAll('.settings-sub').forEach(el => el.classList.add('hidden'));
    const el = document.getElementById(`settings-${sub}`);
    if (el) el.classList.remove('hidden');

    // Highlight active sub-link
    document.querySelectorAll('.sub-link').forEach(l => l.classList.remove('active','text-white'));
    const active = document.querySelector(`.sub-link[data-sub="${sub}"]`);
    if (active) { active.classList.add('active','text-white'); }
  },

  /* ----- Store settings form ----- */
  populateStore() {
    const form = document.getElementById('settingsForm');
    if (!form) return;
    const s = App.settings;
    Object.keys(s).forEach(key => {
      const input = form.elements[key];
      if (input) input.value = s[key] ?? '';
    });
  },

  /* ----- POS settings form ----- */
  populatePOS() {
    const form = document.getElementById('posSettingsForm');
    if (!form) return;
    const s = App.settings;
    Object.keys(s).forEach(key => {
      const input = form.elements[key];
      if (input) input.value = s[key] ?? '';
    });
  },

  /* ----- Users ----- */
  async loadUsers() {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        this.users = await res.json();
      } else {
        this.users = [];
      }
    } catch (e) {
      this.users = [];
    }
    this.renderUsers();
  },

  renderUsers() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    const q = (document.getElementById('userSearch')?.value || '').toLowerCase();

    let list = this.users;
    if (q) {
      list = list.filter(u => u.username.toLowerCase().includes(q) || (u.name||'').toLowerCase().includes(q));
    }

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400 text-xs">No users found</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((u, idx) => {
      const roleBadge = {
        admin: 'bg-red-100 text-red-700',
        manager: 'bg-amber-100 text-amber-700',
        staff: 'bg-blue-100 text-blue-700',
      }[u.role] || 'bg-gray-100 text-gray-700';

      const statusBadge = u.active !== false
        ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">Active</span>'
        : '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-200 text-gray-500">Disabled</span>';

      const bg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
      return `
        <tr class="${bg} hover:bg-blue-50 transition">
          <td class="px-3 py-2 font-mono text-gray-500">${esc(u.id)}</td>
          <td class="px-3 py-2 font-medium text-gray-800">${esc(u.username)}</td>
          <td class="px-3 py-2 text-gray-700">${esc(u.name || '')}</td>
          <td class="px-3 py-2"><span class="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${roleBadge}">${esc(u.role)}</span></td>
          <td class="px-3 py-2 text-gray-600">${esc(u.phone || '—')}</td>
          <td class="px-3 py-2 text-center">${statusBadge}</td>
          <td class="px-3 py-2 text-center">
            <div class="flex items-center justify-center gap-1">
              <button onclick="Settings.editUser('${esc(u.id)}')" class="w-6 h-6 rounded bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center" title="Edit">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button onclick="Settings.deleteUser('${esc(u.id)}')" class="w-6 h-6 rounded bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center" title="Delete">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  },

  openUserModal(user) {
    this.editingUserId = user ? user.id : null;
    const modal = document.getElementById('userModal');
    const form = document.getElementById('userForm');
    const title = document.getElementById('userModalTitle');

    title.textContent = user ? 'Edit User' : 'Add User';
    form.reset();
    form.elements.user_id.value = '';

    if (user) {
      form.elements.user_id.value = user.id;
      form.elements.username.value = user.username;
      form.elements.username.readOnly = true;
      form.elements.name.value = user.name || '';
      form.elements.phone.value = user.phone || '';
      form.elements.role.value = user.role;
      form.elements.active.value = user.active !== false ? 'true' : 'false';
      document.getElementById('pwLabel').textContent = 'Password (leave blank to keep)';
      form.elements.password.required = false;
    } else {
      form.elements.username.readOnly = false;
      document.getElementById('pwLabel').textContent = 'Password *';
      form.elements.password.required = true;
    }

    this.updatePermPreview(form.elements.role.value);
    modal.classList.remove('hidden');
  },

  updatePermPreview(role) {
    const perms = {
      admin:   { dash:'Full Access', pos:'Full Access', inv:'Full Access', label:'Full Access', settings:'Full Access' },
      manager: { dash:'View Only', pos:'Full Access', inv:'View Only', label:'View Only', settings:'No Access' },
      staff:   { dash:'No Access', pos:'Full Access', inv:'No Access', label:'No Access', settings:'No Access' },
    }[role] || {};

    const colorMap = { 'Full Access':'text-green-600 font-semibold', 'View Only':'text-amber-600', 'No Access':'text-red-500' };

    document.querySelectorAll('#permPreview td.perm-dash').forEach(td => { td.innerHTML = `<span class="${colorMap[perms.dash]||''}">${perms.dash||'—'}</span>`; });
    document.querySelectorAll('#permPreview td.perm-pos').forEach(td => { td.innerHTML = `<span class="${colorMap[perms.pos]||''}">${perms.pos||'—'}</span>`; });
    document.querySelectorAll('#permPreview td.perm-inv').forEach(td => { td.innerHTML = `<span class="${colorMap[perms.inv]||''}">${perms.inv||'—'}</span>`; });
    document.querySelectorAll('#permPreview td.perm-label').forEach(td => { td.innerHTML = `<span class="${colorMap[perms.label]||''}">${perms.label||'—'}</span>`; });
    document.querySelectorAll('#permPreview td.perm-settings').forEach(td => { td.innerHTML = `<span class="${colorMap[perms.settings]||''}">${perms.settings||'—'}</span>`; });
  },

  async editUser(id) {
    const user = this.users.find(u => u.id === id);
    if (user) this.openUserModal(user);
  },

  async deleteUser(id) {
    const user = this.users.find(u => u.id === id);
    if (!user) return;
    const ok = await App.confirm(`Delete user "${user.username}"? This cannot be undone.`);
    if (!ok) return;
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        App.toast('User deleted');
        await this.loadUsers();
      } else {
        App.toast(data.error || 'Failed to delete user');
      }
    } catch (e) {
      App.toast('Failed to delete user');
    }
  },

  /* ----- Events ----- */
  bindEvents() {
    // Add user button
    document.getElementById('btnAddUser').onclick = () => this.openUserModal();

    // Close user modal
    document.getElementById('userModalClose').onclick = () => document.getElementById('userModal').classList.add('hidden');
    document.getElementById('btnCancelUser').onclick = () => document.getElementById('userModal').classList.add('hidden');

    // Role change → update permission preview
    const roleSelect = document.querySelector('#userForm select[name="role"]');
    if (roleSelect) {
      roleSelect.onchange = () => this.updatePermPreview(roleSelect.value);
    }

    // User form submit
    document.getElementById('userForm').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = {};
      new FormData(form).forEach((v, k) => { if (k !== 'user_id') data[k] = v; });
      data.active = data.active === 'true';
      const userId = form.elements.user_id.value;

      try {
        let res;
        if (userId) {
          // Edit: don't send empty password
          if (!data.password) delete data.password;
          res = await fetch(`/api/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
        } else {
          res = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
        }
        const result = await res.json();
        if (res.ok) {
          App.toast(userId ? 'User updated' : 'User created');
          document.getElementById('userModal').classList.add('hidden');
          await this.loadUsers();
        } else {
          App.toast(result.error || 'Failed to save user');
        }
      } catch (err) {
        App.toast('Failed to save user');
      }
    };

    // User search
    let debounce;
    document.getElementById('userSearch').oninput = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => this.renderUsers(), 200);
    };

    // Store settings form
    document.getElementById('settingsForm').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = { ...App.settings };
      new FormData(form).forEach((v, k) => { data[k] = v; });
      ['tax_rate'].forEach(f => { data[f] = parseFloat(data[f]) || 0; });
      ['low_stock_threshold'].forEach(f => { data[f] = parseInt(data[f]) || 0; });
      try {
        await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        App.settings = data;
        App.updateHeader();
        App.toast('Store settings saved');
      } catch (err) { App.toast('Failed to save settings'); }
    };

    // POS settings form
    document.getElementById('posSettingsForm').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const data = { ...App.settings };
      new FormData(form).forEach((v, k) => { data[k] = v; });
      try {
        await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        App.settings = data;
        App.updateHeader();
        App.toast('POS settings saved');
      } catch (err) { App.toast('Failed to save settings'); }
    };
  },
};
