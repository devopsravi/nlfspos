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
    this._renderQrPreview('instagram_qr', 'instagramQrPreview', 'instagramQrDelete');
    this._renderQrPreview('google_qr', 'googleQrPreview', 'googleQrDelete');
  },

  _renderQrPreview(settingsKey, previewId, deleteId) {
    const preview = document.getElementById(previewId);
    const delBtn = document.getElementById(deleteId);
    if (!preview) return;
    const dataUri = App.settings[settingsKey];
    if (dataUri && dataUri.startsWith('data:')) {
      preview.innerHTML = `<img src="${dataUri}" style="width:100%;height:100%;object-fit:contain;" />`;
      if (delBtn) delBtn.classList.remove('hidden');
    } else {
      preview.innerHTML = '<span class="text-gray-300 text-xs">No image</span>';
      if (delBtn) delBtn.classList.add('hidden');
    }
  },

  _bindQrUpload(fileInputId, settingsKey, previewId, deleteId) {
    const fileInput = document.getElementById(fileInputId);
    const delBtn = document.getElementById(deleteId);
    if (!fileInput) return;

    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('key', settingsKey);
      fd.append('file', file);
      try {
        const res = await fetch('/api/settings/upload-image', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) { App.toast(data.error || 'Upload failed', 'error'); return; }
        App.settings[settingsKey] = data.data_uri;
        this._renderQrPreview(settingsKey, previewId, deleteId);
        App.toast('Image uploaded');
      } catch (e) { App.toast('Upload failed', 'error'); }
      fileInput.value = '';
    };

    if (delBtn) {
      delBtn.onclick = async () => {
        try {
          const res = await fetch('/api/settings/delete-image', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: settingsKey })
          });
          if (!res.ok) { App.toast('Delete failed', 'error'); return; }
          delete App.settings[settingsKey];
          this._renderQrPreview(settingsKey, previewId, deleteId);
          App.toast('Image removed');
        } catch (e) { App.toast('Delete failed', 'error'); }
      };
    }
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
    this._populatePrinterSettings();
    this._populateLabelPrinterSettings();
  },

  /* ----- Printer settings ----- */
  _populatePrinterSettings() {
    const s = App.settings;
    const modeSelect = document.getElementById('printerModeSelect');
    if (!modeSelect) return;

    modeSelect.value = s.printer_mode || 'browser';
    this._togglePrinterUsbSection(modeSelect.value);

    const paperWidth = document.getElementById('receiptPaperWidth');
    if (paperWidth) paperWidth.value = s.receipt_paper_width || '80';

    const autoPrint = document.getElementById('printerAutoPrint');
    const autoCut = document.getElementById('printerAutoCut');
    const cashDrawer = document.getElementById('printerCashDrawer');
    if (autoPrint) autoPrint.checked = s.printer_auto_print === 'true';
    if (autoCut) autoCut.checked = s.printer_auto_cut !== 'false';
    if (cashDrawer) cashDrawer.checked = s.printer_cash_drawer === 'true';

    this._updatePrinterStatus();
  },

  _togglePrinterUsbSection(mode) {
    const section = document.getElementById('printerUsbSection');
    const warning = document.getElementById('printerWebUsbWarning');
    if (!section) return;

    if (mode === 'usb') {
      section.classList.remove('hidden');
      if (warning && !Printer.isSupported()) warning.classList.remove('hidden');
      else if (warning) warning.classList.add('hidden');
    } else {
      section.classList.add('hidden');
      if (warning) warning.classList.add('hidden');
    }
  },

  _updatePrinterStatus() {
    const dot = document.getElementById('printerStatusDot');
    const text = document.getElementById('printerStatusText');
    const testBtn = document.getElementById('btnTestPrint');
    const unpairBtn = document.getElementById('btnUnpairPrinter');
    if (!dot || !text) return;

    text.textContent = Printer.getStatusText();
    if (Printer.connected) {
      dot.className = 'w-2 h-2 rounded-full bg-green-500 inline-block';
      if (testBtn) testBtn.classList.remove('hidden');
      if (unpairBtn) unpairBtn.classList.remove('hidden');
    } else if (Printer.getSavedDevice()) {
      dot.className = 'w-2 h-2 rounded-full bg-amber-400 inline-block';
      if (testBtn) testBtn.classList.add('hidden');
      if (unpairBtn) unpairBtn.classList.remove('hidden');
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-gray-300 inline-block';
      if (testBtn) testBtn.classList.add('hidden');
      if (unpairBtn) unpairBtn.classList.add('hidden');
    }
  },

  /* ----- Label Printer settings ----- */
  _populateLabelPrinterSettings() {
    const s = App.settings;
    const modeSelect = document.getElementById('labelPrinterModeSelect');
    const sizeSelect = document.getElementById('labelDefaultSize');
    if (!modeSelect) return;

    modeSelect.value = s.label_printer_mode || 'browser';
    if (sizeSelect) sizeSelect.value = s.default_label_size || '3x2';
    this._toggleLabelPrinterUsbSection(modeSelect.value);

    const autoPrint = document.getElementById('labelAutoPrint');
    if (autoPrint) autoPrint.checked = s.label_auto_print === 'true';

    this._updateLabelPrinterStatus();
  },

  _toggleLabelPrinterUsbSection(mode) {
    const section = document.getElementById('labelPrinterUsbSection');
    const warning = document.getElementById('labelPrinterWebUsbWarning');
    if (!section) return;

    if (mode === 'usb') {
      section.classList.remove('hidden');
      if (warning && typeof LabelPrinter !== 'undefined' && !LabelPrinter.isSupported()) warning.classList.remove('hidden');
      else if (warning) warning.classList.add('hidden');
    } else {
      section.classList.add('hidden');
      if (warning) warning.classList.add('hidden');
    }
  },

  _updateLabelPrinterStatus() {
    const dot = document.getElementById('labelPrinterStatusDot');
    const text = document.getElementById('labelPrinterStatusText');
    const testBtn = document.getElementById('btnTestLabelPrint');
    const unpairBtn = document.getElementById('btnUnpairLabelPrinter');
    if (!dot || !text || typeof LabelPrinter === 'undefined') return;

    text.textContent = LabelPrinter.getStatusText();
    if (LabelPrinter.connected) {
      dot.className = 'w-2 h-2 rounded-full bg-green-500 inline-block';
      if (testBtn) testBtn.classList.remove('hidden');
      if (unpairBtn) unpairBtn.classList.remove('hidden');
    } else if (LabelPrinter.getSavedDevice()) {
      dot.className = 'w-2 h-2 rounded-full bg-amber-400 inline-block';
      if (testBtn) testBtn.classList.add('hidden');
      if (unpairBtn) unpairBtn.classList.remove('hidden');
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-gray-300 inline-block';
      if (testBtn) testBtn.classList.add('hidden');
      if (unpairBtn) unpairBtn.classList.add('hidden');
    }
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

    // QR image uploads
    this._bindQrUpload('instagramQrFile', 'instagram_qr', 'instagramQrPreview', 'instagramQrDelete');
    this._bindQrUpload('googleQrFile', 'google_qr', 'googleQrPreview', 'googleQrDelete');

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

    // Printer mode toggle
    const printerModeSelect = document.getElementById('printerModeSelect');
    if (printerModeSelect) {
      printerModeSelect.onchange = () => this._togglePrinterUsbSection(printerModeSelect.value);
    }

    // Pair printer button
    const btnPair = document.getElementById('btnPairPrinter');
    if (btnPair) {
      btnPair.onclick = async () => {
        try {
          await Printer.requestDevice();
          App.toast('Printer paired successfully!');
          this._updatePrinterStatus();
        } catch (e) {
          if (e.name !== 'NotFoundError') {
            App.toast(e.message || 'Failed to pair printer');
          }
        }
      };
    }

    // Test print button
    const btnTest = document.getElementById('btnTestPrint');
    if (btnTest) {
      btnTest.onclick = async () => {
        try {
          await Printer.testPrint();
          App.toast('Test print sent!');
        } catch (e) {
          App.toast('Print failed: ' + (e.message || 'Unknown error'));
        }
      };
    }

    // Unpair printer button
    const btnUnpair = document.getElementById('btnUnpairPrinter');
    if (btnUnpair) {
      btnUnpair.onclick = async () => {
        await Printer.disconnect();
        Printer.clearSavedDevice();
        App.toast('Printer unpaired');
        this._updatePrinterStatus();
      };
    }

    // Save printer settings
    const btnSavePrinter = document.getElementById('btnSavePrinterSettings');
    if (btnSavePrinter) {
      btnSavePrinter.onclick = async () => {
        const mode = document.getElementById('printerModeSelect')?.value || 'browser';
        const paperWidth = document.getElementById('receiptPaperWidth')?.value || '80';
        const autoPrint = document.getElementById('printerAutoPrint')?.checked ? 'true' : 'false';
        const autoCut = document.getElementById('printerAutoCut')?.checked ? 'true' : 'false';
        const cashDrawer = document.getElementById('printerCashDrawer')?.checked ? 'true' : 'false';

        const data = {
          ...App.settings,
          printer_mode: mode,
          receipt_paper_width: paperWidth,
          printer_auto_print: autoPrint,
          printer_auto_cut: autoCut,
          printer_cash_drawer: cashDrawer,
        };
        try {
          await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
          App.settings = data;
          App.toast('Printer settings saved');
        } catch (e) { App.toast('Failed to save printer settings'); }
      };
    }

    // --- Label Printer bindings ---
    const labelModeSelect = document.getElementById('labelPrinterModeSelect');
    if (labelModeSelect) {
      labelModeSelect.onchange = () => this._toggleLabelPrinterUsbSection(labelModeSelect.value);
    }

    const btnPairLabel = document.getElementById('btnPairLabelPrinter');
    if (btnPairLabel) {
      btnPairLabel.onclick = async () => {
        try {
          await LabelPrinter.requestDevice();
          App.toast('Label printer paired!');
          this._updateLabelPrinterStatus();
        } catch (e) {
          if (e.name !== 'NotFoundError') App.toast(e.message || 'Failed to pair');
        }
      };
    }

    const btnTestLabel = document.getElementById('btnTestLabelPrint');
    if (btnTestLabel) {
      btnTestLabel.onclick = async () => {
        try {
          await LabelPrinter.testPrint();
          App.toast('Test label sent!');
        } catch (e) { App.toast('Print failed: ' + (e.message || 'Unknown error')); }
      };
    }

    const btnUnpairLabel = document.getElementById('btnUnpairLabelPrinter');
    if (btnUnpairLabel) {
      btnUnpairLabel.onclick = async () => {
        await LabelPrinter.disconnect();
        LabelPrinter.clearSavedDevice();
        App.toast('Label printer unpaired');
        this._updateLabelPrinterStatus();
      };
    }

    const btnSaveLabel = document.getElementById('btnSaveLabelPrinterSettings');
    if (btnSaveLabel) {
      btnSaveLabel.onclick = async () => {
        const mode = document.getElementById('labelPrinterModeSelect')?.value || 'browser';
        const size = document.getElementById('labelDefaultSize')?.value || '3x2';
        const autoPrint = document.getElementById('labelAutoPrint')?.checked ? 'true' : 'false';

        const data = {
          ...App.settings,
          label_printer_mode: mode,
          default_label_size: size,
          label_auto_print: autoPrint,
        };
        try {
          await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
          App.settings = data;
          App.toast('Label printer settings saved');
        } catch (e) { App.toast('Failed to save label settings'); }
      };
    }
  },
};
