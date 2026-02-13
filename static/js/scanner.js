/* ========================================
   Barcode Scanner Module — Camera-based
   Uses html5-qrcode library
   ======================================== */

const BarcodeScanner = {
  scanner: null,
  isScanning: false,
  context: null,        // 'pos' or 'inventory'
  currentCameraIdx: 0,
  cameras: [],

  init() {
    // Scan button on POS register
    const posScanBtn = document.getElementById('posScanBtn');
    if (posScanBtn) {
      posScanBtn.addEventListener('click', () => this.open('pos'));
    }

    // Scan button on Inventory page
    const invScanBtn = document.getElementById('invScanBtn');
    if (invScanBtn) {
      invScanBtn.addEventListener('click', () => this.open('inventory'));
    }

    // Close button
    const closeBtn = document.getElementById('scannerClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    // Switch camera button
    const switchBtn = document.getElementById('scannerSwitchCam');
    if (switchBtn) {
      switchBtn.addEventListener('click', () => this.switchCamera());
    }

    // Close on backdrop click
    const modal = document.getElementById('scannerModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.close();
      });
    }

    // Manual entry lookup
    const manualBtn = document.getElementById('scannerManualLookup');
    const manualInput = document.getElementById('scannerManualInput');
    if (manualBtn && manualInput) {
      manualBtn.addEventListener('click', () => this._manualLookup());
      manualInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._manualLookup();
      });
    }
  },

  async _manualLookup() {
    const input = document.getElementById('scannerManualInput');
    if (!input) return;
    const code = input.value.trim();
    if (!code) return;

    // Stop camera scanning if active
    if (this.scanner && this.isScanning) {
      try {
        await this.scanner.stop();
        this.isScanning = false;
      } catch (e) { /* ignore */ }
    }

    if (this.context === 'pos') {
      await this._handlePosScan(code);
    } else if (this.context === 'inventory') {
      await this._handleInventoryScan(code);
    }
  },

  async open(context) {
    this.context = context;
    const modal = document.getElementById('scannerModal');
    const resultDiv = document.getElementById('scanResult');

    if (!modal) return;

    // Check if html5-qrcode library is loaded
    if (typeof Html5Qrcode === 'undefined') {
      App.toast('Scanner library not loaded. Please check your connection.');
      return;
    }

    // Reset result area
    resultDiv.classList.add('hidden');
    document.getElementById('scanResultContent').innerHTML = '';

    // Show modal
    modal.classList.remove('hidden');

    // Create scanner instance
    try {
      this.scanner = new Html5Qrcode('barcodeScannerRegion');

      // Get available cameras
      this.cameras = await Html5Qrcode.getCameras();
      if (!this.cameras || this.cameras.length === 0) {
        this._showError('No camera found on this device.');
        return;
      }

      // Prefer back camera (environment facing)
      this.currentCameraIdx = 0;
      for (let i = 0; i < this.cameras.length; i++) {
        const label = (this.cameras[i].label || '').toLowerCase();
        if (label.includes('back') || label.includes('rear') || label.includes('environment')) {
          this.currentCameraIdx = i;
          break;
        }
      }

      await this._startScanning();
    } catch (err) {
      console.error('Scanner error:', err);
      this._showError('Could not access camera. Please allow camera permissions.');
    }
  },

  async _startScanning() {
    if (!this.scanner || this.cameras.length === 0) return;

    const cameraId = this.cameras[this.currentCameraIdx].id;

    const config = {
      fps: 15,
      qrbox: { width: 300, height: 100 },
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.QR_CODE,
      ]
    };

    try {
      await this.scanner.start(
        cameraId,
        config,
        (decodedText, decodedResult) => this._onScanSuccess(decodedText, decodedResult),
        (errorMessage) => { /* Scan error — ignore, keep scanning */ }
      );
      this.isScanning = true;
    } catch (err) {
      console.error('Failed to start scanner:', err);
      this._showError('Failed to start camera. Please try again.');
    }
  },

  async _onScanSuccess(decodedText) {
    // Stop scanning immediately to prevent duplicate scans
    if (this.scanner && this.isScanning) {
      try {
        await this.scanner.stop();
        this.isScanning = false;
      } catch (e) { /* ignore */ }
    }

    const scannedCode = decodedText.trim();

    if (this.context === 'pos') {
      await this._handlePosScan(scannedCode);
    } else if (this.context === 'inventory') {
      await this._handleInventoryScan(scannedCode);
    }
  },

  async _handlePosScan(sku) {
    const resultDiv = document.getElementById('scanResult');
    const resultContent = document.getElementById('scanResultContent');

    // Show loading state
    resultDiv.classList.remove('hidden');
    resultContent.innerHTML = `
      <div class="flex items-center gap-2 text-gray-500">
        <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span class="text-sm">Looking up product...</span>
      </div>`;

    try {
      // Try exact SKU lookup first
      const res = await fetch(`/api/inventory/${encodeURIComponent(sku)}`);
      if (res.ok) {
        const product = await res.json();
        const sym = App._currSym();
        const price = parseFloat(product.selling_price || 0);
        const inStock = product.quantity > 0;

        resultContent.innerHTML = `
          <div class="flex items-center justify-between">
            <div>
              <div class="font-semibold text-gray-800 dark:text-gray-200">${esc(product.name)}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400">Stockcode: ${esc(product.barcode || product.sku)} &bull; ${inStock ? product.quantity + ' in stock' : '<span class="text-red-500">Out of stock</span>'}</div>
            </div>
            <div class="text-right">
              <div class="text-xl font-bold text-teal-600">${sym}${price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            </div>
          </div>
          <div class="mt-3 flex gap-2">
            ${inStock ? `<button onclick="BarcodeScanner._addToCartAndClose('${esc(product.sku)}')" class="flex-1 bg-teal-500 text-white py-2 rounded-lg text-sm font-semibold hover:bg-teal-600 transition">Add to Cart</button>` : ''}
            <button onclick="BarcodeScanner._rescan()" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Scan Again</button>
            <button onclick="BarcodeScanner.close()" class="px-4 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Close</button>
          </div>`;

        return;
      }

      // If exact lookup not found, try search
      const searchRes = await fetch(`/api/inventory?q=${encodeURIComponent(sku)}`);
      const results = await searchRes.json();

      if (results.length === 1) {
        const product = results[0];
        const sym = App._currSym();
        const price = parseFloat(product.selling_price || 0);
        const inStock = product.quantity > 0;

        resultContent.innerHTML = `
          <div class="flex items-center justify-between">
            <div>
              <div class="font-semibold text-gray-800 dark:text-gray-200">${esc(product.name)}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400">Stockcode: ${esc(product.barcode || product.sku)} &bull; ${inStock ? product.quantity + ' in stock' : '<span class="text-red-500">Out of stock</span>'}</div>
            </div>
            <div class="text-right">
              <div class="text-xl font-bold text-teal-600">${sym}${price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            </div>
          </div>
          <div class="mt-3 flex gap-2">
            ${inStock ? `<button onclick="BarcodeScanner._addToCartAndClose('${esc(product.sku)}')" class="flex-1 bg-teal-500 text-white py-2 rounded-lg text-sm font-semibold hover:bg-teal-600 transition">Add to Cart</button>` : ''}
            <button onclick="BarcodeScanner._rescan()" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Scan Again</button>
            <button onclick="BarcodeScanner.close()" class="px-4 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Close</button>
          </div>`;
      } else if (results.length > 1) {
        resultContent.innerHTML = `
          <div class="text-sm text-gray-600 dark:text-gray-300 mb-2">Multiple matches for "<strong>${esc(sku)}</strong>":</div>
          <div class="max-h-40 overflow-y-auto space-y-1">
            ${results.slice(0, 5).map(p => `
              <div class="flex items-center justify-between p-2 rounded-lg hover:bg-teal-50 dark:hover:bg-gray-700 cursor-pointer border border-gray-100 dark:border-gray-600"
                   onclick="BarcodeScanner._addToCartAndClose('${esc(p.sku)}')">
                <div>
                  <div class="font-medium text-sm text-gray-800 dark:text-gray-200">${esc(p.name)}</div>
                  <div class="text-xs text-gray-400">${esc(p.barcode || p.sku)}</div>
                </div>
                <div class="font-bold text-teal-600">${App.currency(p.selling_price)}</div>
              </div>
            `).join('')}
          </div>
          <div class="mt-2 flex gap-2">
            <button onclick="BarcodeScanner._rescan()" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Scan Again</button>
            <button onclick="BarcodeScanner.close()" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Close</button>
          </div>`;
      } else {
        resultContent.innerHTML = `
          <div class="text-center py-2">
            <div class="text-red-500 font-semibold text-sm">Product not found</div>
            <div class="text-xs text-gray-400 mt-1">Scanned: ${esc(sku)}</div>
          </div>
          <div class="mt-2 flex gap-2">
            <button onclick="BarcodeScanner._rescan()" class="flex-1 bg-teal-500 text-white py-2 rounded-lg text-sm font-semibold hover:bg-teal-600 transition">Scan Again</button>
            <button onclick="BarcodeScanner.close()" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Close</button>
          </div>`;
      }
    } catch (err) {
      console.error('POS scan lookup error:', err);
      resultContent.innerHTML = `
        <div class="text-center py-2">
          <div class="text-red-500 font-semibold text-sm">Lookup failed</div>
          <div class="text-xs text-gray-400 mt-1">Please try again</div>
        </div>
        <div class="mt-2 flex gap-2">
          <button onclick="BarcodeScanner._rescan()" class="flex-1 bg-teal-500 text-white py-2 rounded-lg text-sm font-semibold hover:bg-teal-600 transition">Scan Again</button>
          <button onclick="BarcodeScanner.close()" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Close</button>
        </div>`;
    }
  },

  async _handleInventoryScan(sku) {
    const resultDiv = document.getElementById('scanResult');
    const resultContent = document.getElementById('scanResultContent');

    // Show loading
    resultDiv.classList.remove('hidden');
    resultContent.innerHTML = `
      <div class="flex items-center gap-2 text-gray-500">
        <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span class="text-sm">Looking up product...</span>
      </div>`;

    try {
      // Try exact SKU first
      let product = null;
      const res = await fetch(`/api/inventory/${encodeURIComponent(sku)}`);
      if (res.ok) {
        product = await res.json();
      } else {
        // Try search
        const searchRes = await fetch(`/api/inventory?q=${encodeURIComponent(sku)}`);
        const results = await searchRes.json();
        if (results.length >= 1) product = results[0];
      }

      if (product) {
        const sym = App._currSym();
        const price = parseFloat(product.selling_price || 0);
        const cost = parseFloat(product.cost_price || 0);
        const margin = price > 0 ? (((price - cost) / price) * 100).toFixed(1) : '0.0';
        const isLow = product.quantity <= (product.reorder_level || 3);

        resultContent.innerHTML = `
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-semibold text-gray-800 dark:text-gray-200">${esc(product.name)}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">Stockcode: ${esc(product.barcode || product.sku)}${product.category ? ' &bull; ' + esc(product.category) : ''}</div>
              </div>
              <span class="${isLow ? 'stock-low' : 'stock-ok'}">${isLow ? 'Low' : 'OK'}</span>
            </div>
            <div class="grid grid-cols-3 gap-2 text-center">
              <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-2">
                <div class="text-xs text-gray-500 dark:text-gray-400">Price</div>
                <div class="font-bold text-teal-600">${sym}${price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-2">
                <div class="text-xs text-gray-500 dark:text-gray-400">Stock</div>
                <div class="font-bold ${isLow ? 'text-red-600' : 'text-gray-800 dark:text-gray-200'}">${product.quantity}</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-2">
                <div class="text-xs text-gray-500 dark:text-gray-400">Margin</div>
                <div class="font-bold ${parseFloat(margin) >= 40 ? 'text-green-600' : parseFloat(margin) >= 20 ? 'text-amber-600' : 'text-red-600'}">${margin}%</div>
              </div>
            </div>
          </div>
          <div class="mt-3 flex gap-2">
            <button onclick="BarcodeScanner._viewInInventory('${esc(product.sku)}')" class="flex-1 bg-teal-500 text-white py-2 rounded-lg text-sm font-semibold hover:bg-teal-600 transition">View in Inventory</button>
            <button onclick="BarcodeScanner._rescan()" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Scan Again</button>
          </div>`;
      } else {
        resultContent.innerHTML = `
          <div class="text-center py-2">
            <div class="text-red-500 font-semibold text-sm">Product not found</div>
            <div class="text-xs text-gray-400 mt-1">Scanned: ${esc(sku)}</div>
          </div>
          <div class="mt-2 flex gap-2">
            <button onclick="BarcodeScanner._rescan()" class="flex-1 bg-teal-500 text-white py-2 rounded-lg text-sm font-semibold hover:bg-teal-600 transition">Scan Again</button>
            <button onclick="BarcodeScanner.close()" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Close</button>
          </div>`;
      }
    } catch (err) {
      console.error('Inventory scan lookup error:', err);
      resultContent.innerHTML = `
        <div class="text-center py-2">
          <div class="text-red-500 font-semibold text-sm">Lookup failed</div>
          <div class="text-xs text-gray-400 mt-1">Please try again</div>
        </div>
        <div class="mt-2 flex gap-2">
          <button onclick="BarcodeScanner._rescan()" class="flex-1 bg-teal-500 text-white py-2 rounded-lg text-sm font-semibold hover:bg-teal-600 transition">Scan Again</button>
          <button onclick="BarcodeScanner.close()" class="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Close</button>
        </div>`;
    }
  },

  // --- Action helpers ---

  async _addToCartAndClose(sku) {
    try {
      const res = await fetch(`/api/inventory/${encodeURIComponent(sku)}`);
      if (res.ok) {
        const product = await res.json();
        if (typeof POS !== 'undefined') {
          POS.addToCart(product);
          App.toast(`Added ${product.name} to cart`);
        }
      }
    } catch (e) {
      App.toast('Failed to add to cart');
    }
    this.close();
  },

  _viewInInventory(sku) {
    // Close scanner, set search field, trigger search
    this.close();
    const searchInput = document.getElementById('invSearch');
    if (searchInput) {
      searchInput.value = sku;
      // Trigger input event to filter the table
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Also trigger inventory reload if available
    if (typeof Inventory !== 'undefined') {
      Inventory.loadProducts().then(() => Inventory.render());
    }
  },

  async _rescan() {
    const resultDiv = document.getElementById('scanResult');
    resultDiv.classList.add('hidden');
    document.getElementById('scanResultContent').innerHTML = '';

    // Restart scanning
    try {
      await this._startScanning();
    } catch (e) {
      console.error('Rescan error:', e);
    }
  },

  async switchCamera() {
    if (this.cameras.length <= 1) {
      App.toast('Only one camera available');
      return;
    }

    // Stop current scan
    if (this.scanner && this.isScanning) {
      try {
        await this.scanner.stop();
        this.isScanning = false;
      } catch (e) { /* ignore */ }
    }

    // Cycle to next camera
    this.currentCameraIdx = (this.currentCameraIdx + 1) % this.cameras.length;

    // Restart with new camera
    await this._startScanning();
  },

  async close() {
    // Stop scanner
    if (this.scanner && this.isScanning) {
      try {
        await this.scanner.stop();
        this.isScanning = false;
      } catch (e) { /* ignore */ }
    }

    // Clear the scanner region
    try {
      if (this.scanner) {
        this.scanner.clear();
        this.scanner = null;
      }
    } catch (e) { /* ignore */ }

    // Hide modal
    const modal = document.getElementById('scannerModal');
    if (modal) modal.classList.add('hidden');

    // Reset
    this.context = null;
  },

  _showError(message) {
    const resultDiv = document.getElementById('scanResult');
    const resultContent = document.getElementById('scanResultContent');
    resultDiv.classList.remove('hidden');
    resultContent.innerHTML = `
      <div class="text-center py-3">
        <svg class="w-10 h-10 mx-auto text-red-400 mb-2" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
        </svg>
        <div class="text-red-500 font-semibold text-sm">${message}</div>
      </div>
      <div class="mt-2">
        <button onclick="BarcodeScanner.close()" class="w-full bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition">Close</button>
      </div>`;
  }
};
