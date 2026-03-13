/* ========================================
   Thermal Printer Module — ESC/POS + WebUSB
   ======================================== */

const Printer = {
  device: null,
  interfaceNumber: 0,
  endpointOut: null,
  connected: false,
  _reconnecting: false,

  VENDOR_IDS: [
    0x04b8, // Epson
    0x0519, // Star Micronics
    0x1504, // BIXOLON
    0x0dd4, // Custom
    0x0fe6, // ICS / generic
    0x0483, // STMicroelectronics (many generic printers)
    0x1a86, // QinHeng (CH340 — very common in generic printers)
    0x0416, // WinChipHead
    0x1fc9, // NXP (some POS printers)
    0x20d1, // Xprinter
    0x0525, // PLX / Netchip (USB gadget printers)
    0x154f, // SNBC
  ],

  /* ========== WebUSB Support Detection ========== */

  isSupported() {
    return !!navigator.usb;
  },

  /* ========== Connection Management ========== */

  async requestDevice() {
    if (!this.isSupported()) {
      throw new Error('WebUSB is not supported in this browser. Use Chrome or Edge.');
    }
    const filters = this.VENDOR_IDS.map(v => ({ vendorId: v }));
    this.device = await navigator.usb.requestDevice({ filters });
    await this._openDevice();
    this._saveDeviceInfo();
    return this.device;
  },

  async _openDevice() {
    const dev = this.device;
    await dev.open();

    if (dev.configuration === null) {
      await dev.selectConfiguration(1);
    }

    const iface = dev.configuration.interfaces.find(i =>
      i.alternates.some(a => a.endpoints.some(e => e.direction === 'out'))
    );
    if (!iface) throw new Error('No suitable printer interface found on device.');

    this.interfaceNumber = iface.interfaceNumber;
    await dev.claimInterface(this.interfaceNumber);

    const alt = iface.alternates.find(a =>
      a.endpoints.some(e => e.direction === 'out')
    );
    this.endpointOut = alt.endpoints.find(e => e.direction === 'out');
    this.connected = true;
  },

  async disconnect() {
    if (this.device) {
      try {
        await this.device.releaseInterface(this.interfaceNumber);
        await this.device.close();
      } catch (e) { /* already closed */ }
    }
    this.device = null;
    this.connected = false;
    this.endpointOut = null;
  },

  _saveDeviceInfo() {
    if (!this.device) return;
    const info = {
      vendorId: this.device.vendorId,
      productId: this.device.productId,
      name: this.device.productName || 'Thermal Printer',
    };
    localStorage.setItem('nlf_printer_device', JSON.stringify(info));
  },

  getSavedDevice() {
    try {
      const raw = localStorage.getItem('nlf_printer_device');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  clearSavedDevice() {
    localStorage.removeItem('nlf_printer_device');
    this.connected = false;
    this.device = null;
  },

  /* ========== USB Events ========== */

  setupUsbListeners() {
    if (!this.isSupported()) return;
    navigator.usb.addEventListener('disconnect', (e) => {
      if (this.device && e.device === this.device) {
        this.connected = false;
        this.device = null;
        this.endpointOut = null;
        console.warn('[Printer] USB device disconnected');
        if (typeof Settings !== 'undefined' && Settings._updatePrinterStatus) {
          Settings._updatePrinterStatus();
        }
      }
    });
    navigator.usb.addEventListener('connect', () => {
      if (!this.connected && this.getSavedDevice()) {
        this.autoReconnect().then(ok => {
          if (ok && typeof Settings !== 'undefined' && Settings._updatePrinterStatus) {
            Settings._updatePrinterStatus();
          }
        });
      }
    });
  },

  /* ========== Auto-Reconnect ========== */

  async autoReconnect() {
    if (!this.isSupported() || this._reconnecting) return false;
    const saved = this.getSavedDevice();
    if (!saved) return false;

    this._reconnecting = true;
    try {
      const devices = await navigator.usb.getDevices();
      const match = devices.find(d =>
        d.vendorId === saved.vendorId && d.productId === saved.productId
      );
      if (match) {
        this.device = match;
        await this._openDevice();
        this._reconnecting = false;
        return true;
      }
    } catch (e) {
      console.warn('[Printer] Auto-reconnect failed:', e.message);
    }
    this._reconnecting = false;
    return false;
  },

  /* ========== Data Sending ========== */

  async _send(data) {
    if (!this.connected || !this.device || !this.endpointOut) {
      throw new Error('Printer not connected');
    }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const CHUNK = 64;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const chunk = bytes.slice(i, i + CHUNK);
      await this.device.transferOut(this.endpointOut.endpointNumber, chunk);
    }
  },

  /* ========== ESC/POS Command Builder ========== */

  _encoder() {
    const buf = [];
    const push = (...bytes) => bytes.forEach(b => buf.push(b));
    const textEncoder = new TextEncoder();

    const self = {
      init()        { push(0x1B, 0x40); return self; },                  // ESC @
      text(str)     { const e = textEncoder.encode(str); buf.push(...e); return self; },
      newline()     { push(0x0A); return self; },                         // LF
      bold(on)      { push(0x1B, 0x45, on ? 1 : 0); return self; },      // ESC E n
      underline(on) { push(0x1B, 0x2D, on ? 1 : 0); return self; },      // ESC - n
      doubleHeight(on) { push(0x1B, 0x21, on ? 0x10 : 0x00); return self; }, // ESC ! n
      alignLeft()   { push(0x1B, 0x61, 0); return self; },               // ESC a 0
      alignCenter() { push(0x1B, 0x61, 1); return self; },               // ESC a 1
      alignRight()  { push(0x1B, 0x61, 2); return self; },               // ESC a 2

      line(char, len) {
        self.text((char || '-').repeat(len || 42));
        return self.newline();
      },

      row(left, right, width) {
        width = width || 42;
        const r = String(right);
        const maxLeft = width - r.length - 1;
        let l = String(left);
        if (l.length > maxLeft) l = l.substring(0, maxLeft);
        const spaces = width - l.length - r.length;
        self.text(l + ' '.repeat(Math.max(spaces, 1)) + r);
        return self.newline();
      },

      columns(cols, widths) {
        let line = '';
        cols.forEach((col, i) => {
          const w = widths[i] || 10;
          let s = String(col);
          if (s.length > w) s = s.substring(0, w);
          else s = s + ' '.repeat(w - s.length);
          line += s;
        });
        self.text(line.trimEnd());
        return self.newline();
      },

      feed(lines)   { for (let i = 0; i < (lines || 3); i++) push(0x0A); return self; },
      cut()         { push(0x1D, 0x56, 0x00); return self; },            // GS V 0 (full cut)
      partialCut()  { push(0x1D, 0x56, 0x01); return self; },            // GS V 1
      openDrawer()  { push(0x1B, 0x70, 0x00, 0x19, 0xFA); return self; }, // ESC p 0

      build() { return new Uint8Array(buf); },
    };
    return self;
  },

  /* ========== Receipt Formatter ========== */

  formatReceipt(sale) {
    const s = App.settings;
    const is58 = (s.receipt_paper_width || '80') === '58';
    const W = is58 ? 32 : 42;
    const enc = this._encoder().init();

    // Store header
    enc.alignCenter().bold(true).doubleHeight(true);
    enc.text(s.store_name || 'Store').newline();
    enc.doubleHeight(false).bold(false);

    if (s.address) enc.text(s.address).newline();
    const contactParts = [];
    if (s.phone) contactParts.push(s.phone);
    if (s.email) contactParts.push(s.email);
    if (contactParts.length) enc.text(contactParts.join(' | ')).newline();
    if (s.gstin) enc.text('GSTIN: ' + s.gstin).newline();

    enc.alignLeft().line('-', W);

    // Receipt meta
    enc.row('Receipt:', sale.receipt_number, W);
    enc.row('Date:', new Date(sale.timestamp).toLocaleString(), W);
    enc.row('Cashier:', sale.cashier || 'Staff', W);
    if (sale.customer_name) {
      enc.row('Customer:', sale.customer_name + (sale.customer_phone ? ' ' + sale.customer_phone : ''), W);
    }

    enc.line('-', W);

    // Items header — adjust column widths for paper size
    const colW = is58 ? [14, 4, 7, 7] : [22, 5, 8, 7];
    enc.bold(true);
    enc.columns(['Item', 'Qty', 'Price', 'Total'], colW);
    enc.bold(false);
    enc.line('-', W);

    // Items
    const items = sale.items || [];
    const nameMax = colW[0];
    items.forEach(item => {
      const name = item.name || 'Item';
      const qty = String(item.quantity);
      const price = this._fmtNum(item.unit_price);
      const total = this._fmtNum(item.final_total || item.line_total);

      if (name.length <= nameMax) {
        enc.columns([name, qty, price, total], colW);
      } else {
        enc.text(name).newline();
        enc.columns(['', qty, price, total], colW);
      }
      if (item.hsn_code) {
        enc.text('  HSN: ' + item.hsn_code).newline();
      }
      if (item.discount_amount > 0) {
        const discLabel = item.discount_type === 'percent'
          ? `  Disc: ${item.discount_value}%`
          : `  Disc: -${this._fmtNum(item.discount_amount)}`;
        enc.text(discLabel).newline();
      }
    });

    enc.line('-', W);

    // Totals
    if (sale.discount_amount > 0) {
      enc.row('Subtotal', this._fmtNum(sale.subtotal), W);
      enc.row('Discount', '-' + this._fmtNum(sale.discount_amount), W);
    }
    const taxableValue = sale.subtotal - (sale.discount_amount || 0);
    enc.row('Taxable Value', this._fmtNum(taxableValue), W);

    const taxRate = parseFloat(s.tax_rate) || 0;
    const halfRate = taxRate / 2;
    const cgst = sale.cgst_amount || sale.tax_amount / 2;
    const sgst = sale.sgst_amount || sale.tax_amount / 2;
    enc.row(`CGST (${halfRate}%)`, this._fmtNum(cgst), W);
    enc.row(`SGST (${halfRate}%)`, this._fmtNum(sgst), W);

    enc.line('=', W);
    enc.bold(true).doubleHeight(true);
    enc.row('TOTAL', this._fmtNum(sale.grand_total), W);
    enc.doubleHeight(false).bold(false);
    enc.line('=', W);

    enc.row('Paid via', sale.payment_method, W);

    enc.line('-', W);

    // Footer
    enc.alignCenter();
    enc.text(s.receipt_footer || 'Thank you!').newline();
    enc.feed(4);

    return enc;
  },

  _fmtNum(n) {
    return Number(n || 0).toFixed(2);
  },

  /* ========== Print Methods ========== */

  async printReceipt(sale) {
    const enc = this.formatReceipt(sale);
    const autoCut = App.settings.printer_auto_cut !== 'false';
    const cashDrawer = App.settings.printer_cash_drawer === 'true';

    if (cashDrawer) enc.openDrawer();
    if (autoCut) enc.partialCut();
    else enc.feed(5);

    await this._send(enc.build());
  },

  async printRaw(text) {
    const enc = this._encoder().init().text(text).feed(4).partialCut();
    await this._send(enc.build());
  },

  /* ========== Test Print ========== */

  async testPrint() {
    const enc = this._encoder().init();
    enc.alignCenter().bold(true).doubleHeight(true);
    enc.text('NLF POS').newline();
    enc.doubleHeight(false).bold(false);
    enc.text('Printer Test').newline();
    enc.line('-', 42);
    enc.alignLeft();
    enc.text('If you can read this, your').newline();
    enc.text('thermal printer is working!').newline();
    enc.line('-', 42);
    enc.alignCenter();
    enc.text(new Date().toLocaleString()).newline();
    enc.feed(4).partialCut();
    await this._send(enc.build());
  },

  /* ========== Status Helpers ========== */

  getStatusText() {
    if (!this.isSupported()) return 'WebUSB not supported';
    if (this.connected && this.device) return `Connected: ${this.device.productName || 'Printer'}`;
    const saved = this.getSavedDevice();
    if (saved) return `Paired: ${saved.name} (disconnected)`;
    return 'No printer paired';
  },

  getMode() {
    return App.settings.printer_mode || 'browser';
  },

  isAutoPrint() {
    return App.settings.printer_auto_print === 'true';
  },
};

/* ========================================
   Label Printer Module — WebUSB for label printers
   ======================================== */

const LabelPrinter = {
  device: null,
  interfaceNumber: 0,
  endpointOut: null,
  connected: false,
  _reconnecting: false,

  VENDOR_IDS: [
    0x04b8, // Epson
    0x0a5f, // Zebra
    0x1203, // TSC
    0x1504, // BIXOLON
    0x04f9, // Brother
    0x0922, // DYMO
    0x1d90, // Godex
    0x0dd4, // Custom
    0x0483, // STMicroelectronics (generic)
    0x1a86, // QinHeng (CH340)
    0x20d1, // Xprinter
    0x154f, // SNBC
    0x0fe6, // ICS / generic
  ],

  isSupported() {
    return !!navigator.usb;
  },

  async requestDevice() {
    if (!this.isSupported()) {
      throw new Error('WebUSB is not supported in this browser. Use Chrome or Edge.');
    }
    const filters = this.VENDOR_IDS.map(v => ({ vendorId: v }));
    this.device = await navigator.usb.requestDevice({ filters });
    await this._openDevice();
    this._saveDeviceInfo();
    return this.device;
  },

  async _openDevice() {
    const dev = this.device;
    await dev.open();
    if (dev.configuration === null) await dev.selectConfiguration(1);

    const iface = dev.configuration.interfaces.find(i =>
      i.alternates.some(a => a.endpoints.some(e => e.direction === 'out'))
    );
    if (!iface) throw new Error('No suitable printer interface found on device.');

    this.interfaceNumber = iface.interfaceNumber;
    await dev.claimInterface(this.interfaceNumber);

    const alt = iface.alternates.find(a => a.endpoints.some(e => e.direction === 'out'));
    this.endpointOut = alt.endpoints.find(e => e.direction === 'out');
    this.connected = true;
  },

  async disconnect() {
    if (this.device) {
      try {
        await this.device.releaseInterface(this.interfaceNumber);
        await this.device.close();
      } catch (e) { /* already closed */ }
    }
    this.device = null;
    this.connected = false;
    this.endpointOut = null;
  },

  _saveDeviceInfo() {
    if (!this.device) return;
    const info = {
      vendorId: this.device.vendorId,
      productId: this.device.productId,
      name: this.device.productName || 'Label Printer',
    };
    localStorage.setItem('nlf_label_printer_device', JSON.stringify(info));
  },

  getSavedDevice() {
    try {
      const raw = localStorage.getItem('nlf_label_printer_device');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  clearSavedDevice() {
    localStorage.removeItem('nlf_label_printer_device');
    this.connected = false;
    this.device = null;
  },

  setupUsbListeners() {
    if (!this.isSupported()) return;
    navigator.usb.addEventListener('disconnect', (e) => {
      if (this.device && e.device === this.device) {
        this.connected = false;
        this.device = null;
        this.endpointOut = null;
        if (typeof Settings !== 'undefined' && Settings._updateLabelPrinterStatus) {
          Settings._updateLabelPrinterStatus();
        }
      }
    });
    navigator.usb.addEventListener('connect', () => {
      if (!this.connected && this.getSavedDevice()) {
        this.autoReconnect().then(ok => {
          if (ok && typeof Settings !== 'undefined' && Settings._updateLabelPrinterStatus) {
            Settings._updateLabelPrinterStatus();
          }
        });
      }
    });
  },

  async autoReconnect() {
    if (!this.isSupported() || this._reconnecting) return false;
    const saved = this.getSavedDevice();
    if (!saved) return false;

    this._reconnecting = true;
    try {
      const devices = await navigator.usb.getDevices();
      const match = devices.find(d =>
        d.vendorId === saved.vendorId && d.productId === saved.productId
      );
      if (match) {
        this.device = match;
        await this._openDevice();
        this._reconnecting = false;
        return true;
      }
    } catch (e) {
      console.warn('[LabelPrinter] Auto-reconnect failed:', e.message);
    }
    this._reconnecting = false;
    return false;
  },

  async _send(data) {
    if (!this.connected || !this.device || !this.endpointOut) {
      throw new Error('Label printer not connected');
    }
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const CHUNK = 64;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const chunk = bytes.slice(i, i + CHUNK);
      await this.device.transferOut(this.endpointOut.endpointNumber, chunk);
    }
  },

  async testPrint() {
    const enc = Printer._encoder().init();
    enc.alignCenter().bold(true);
    enc.text('NLF POS').newline();
    enc.bold(false);
    enc.text('Label Printer Test').newline();
    enc.line('-', 32);
    enc.text(new Date().toLocaleString()).newline();
    enc.feed(3).partialCut();
    await this._send(enc.build());
  },

  getStatusText() {
    if (!this.isSupported()) return 'WebUSB not supported';
    if (this.connected && this.device) return `Connected: ${this.device.productName || 'Label Printer'}`;
    const saved = this.getSavedDevice();
    if (saved) return `Paired: ${saved.name} (disconnected)`;
    return 'No label printer paired';
  },

  getMode() {
    return App.settings.label_printer_mode || 'browser';
  },

  isAutoPrint() {
    return App.settings.label_auto_print === 'true';
  },
};
