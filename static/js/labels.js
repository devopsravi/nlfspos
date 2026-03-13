/* ========================================
   Label Printing Module
   ======================================== */

const Labels = {
  products: [],
  selected: new Set(),
  quantities: {},    // sku -> number of labels to print

  BARCODE_HEIGHTS: {
    '38x25': 12, '50x25': 14, '2x1': 18, '50x30': 18,
    '75x50': 26, '3x2': 30, '100x50': 32, '4x2': 36, '4x6': 50,
  },

  async init() {
    // Apply default label size from settings
    const defaultSize = App.settings.default_label_size;
    const sizeSelect = document.getElementById('labelSize');
    if (defaultSize && sizeSelect) {
      sizeSelect.value = defaultSize;
    }
    await this.loadProducts();
    this.render();
    this.bindEvents();
  },

  async loadProducts() {
    const q = document.getElementById('labelSearch')?.value || '';
    const params = q ? `?q=${encodeURIComponent(q)}` : '';
    try {
      const res = await fetch(`/api/inventory${params}`);
      this.products = await res.json();
    } catch (e) {
      this.products = [];
    }
  },

  render() {
    const container = document.getElementById('labelProductList');
    if (!container) return;

    if (this.products.length === 0) {
      container.innerHTML = '<p class="text-gray-400 text-sm col-span-full text-center mt-4">No products found</p>';
      return;
    }

    container.innerHTML = this.products.map(p => {
      const isSelected = this.selected.has(p.sku);
      const displayCode = p.barcode || p.sku;
      const qty = this.quantities[p.sku] || 1;
      return `
        <div class="label-select-card ${isSelected ? 'selected' : ''}" data-sku="${esc(p.sku)}">
          <div class="lsc-check">${isSelected ? '✓' : ''}</div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">${esc(p.name)}</div>
            <div class="text-xs text-gray-400">${esc(displayCode)} | ${esc(p.category)} | ${App.currency(p.selling_price)}</div>
          </div>
          ${isSelected ? `<input type="number" min="1" max="100" value="${qty}" class="label-qty-input w-12 text-center border rounded-lg px-1 py-1 text-xs" data-sku="${esc(p.sku)}" title="Number of labels" onclick="event.stopPropagation()" />` : ''}
        </div>`;
    }).join('');

    // Click handlers for card selection
    container.querySelectorAll('.label-select-card').forEach(card => {
      card.addEventListener('click', () => {
        const sku = card.dataset.sku;
        if (this.selected.has(sku)) {
          this.selected.delete(sku);
          delete this.quantities[sku];
        } else {
          this.selected.add(sku);
          if (!this.quantities[sku]) this.quantities[sku] = 1;
        }
        this.render();
        this.updatePrintBtn();
      });
    });

    // Quantity input handlers
    container.querySelectorAll('.label-qty-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const sku = e.target.dataset.sku;
        this.quantities[sku] = Math.max(1, Math.min(100, parseInt(e.target.value) || 1));
      });
    });
  },

  updatePrintBtn() {
    const disabled = this.selected.size === 0;
    const btnPrint = document.getElementById('btnPrintLabels');
    const btnPreview = document.getElementById('btnPreviewLabels');
    if (btnPrint) btnPrint.disabled = disabled;
    if (btnPreview) btnPreview.disabled = disabled;
  },

  bindEvents() {
    // Search
    let debounce;
    document.getElementById('labelSearch')?.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        await this.loadProducts();
        this.render();
      }, 300);
    });

    // Select all
    document.getElementById('btnSelectAllLabels')?.addEventListener('click', () => {
      if (this.selected.size === this.products.length) {
        this.selected.clear();
      } else {
        this.products.forEach(p => {
          this.selected.add(p.sku);
          if (!this.quantities[p.sku]) this.quantities[p.sku] = 1;
        });
      }
      this.render();
      this.updatePrintBtn();
    });

    // Preview
    document.getElementById('btnPreviewLabels')?.addEventListener('click', () => this.previewLabels());

    // Print
    document.getElementById('btnPrintLabels')?.addEventListener('click', () => this.printLabels());
  },

  _buildLabelHtml(products, size) {
    const storeName = App.settings.store_name || 'Store';
    const sym = App._currSym();
    return products.map(p => {
      const barcodeValue = p.barcode || p.sku;
      const safeClass = barcodeValue.replace(/[^a-zA-Z0-9]/g, '');
      return `
      <div class="print-label size-${size}" style="background:#fff;color:#000;">
        <div class="label-store">${esc(storeName)}</div>
        <div class="label-price">${esc(sym)}${parseFloat(p.selling_price).toFixed(2)}</div>
        <svg class="barcode barcode-${safeClass}"></svg>
        <div class="label-sku">${esc(barcodeValue)}</div>
      </div>`;
    }).join('');
  },

  _renderBarcodes(products, size) {
    const barcodeH = this.BARCODE_HEIGHTS[size] || 30;
    const isSmall = ['38x25', '50x25'].includes(size);
    products.forEach(p => {
      const barcodeValue = p.barcode || p.sku;
      const safeClass = barcodeValue.replace(/[^a-zA-Z0-9]/g, '');
      try {
        JsBarcode(`.barcode-${safeClass}`, barcodeValue, {
          format: 'CODE128',
          width: isSmall ? 1.2 : 1.8,
          height: barcodeH,
          displayValue: false,
          margin: isSmall ? 2 : 4,
        });
      } catch (e) {
        console.warn('Barcode render failed for', barcodeValue, e);
      }
    });
  },

  _expandWithQuantities(products) {
    const expanded = [];
    products.forEach(p => {
      const qty = this.quantities[p.sku] || 1;
      for (let i = 0; i < qty; i++) expanded.push(p);
    });
    return expanded;
  },

  _showPreview(container) {
    container.classList.remove('hidden');
    container.style.display = 'flex';
    container.style.flexWrap = 'wrap';
    container.style.gap = '8px';
    container.style.padding = '16px';
    container.style.background = '#fff';
  },

  _hidePreview(container) {
    container.classList.add('hidden');
    container.style.display = '';
    container.style.padding = '';
    container.style.background = '';
  },

  previewLabels() {
    const size = document.getElementById('labelSize')?.value || '3x2';
    const selectedProducts = this.products.filter(p => this.selected.has(p.sku));
    if (selectedProducts.length === 0) { App.toast('Select products first'); return; }

    const expanded = this._expandWithQuantities(selectedProducts);
    const preview = document.getElementById('labelPreview');
    preview.innerHTML = this._buildLabelHtml(expanded, size);
    this._showPreview(preview);

    setTimeout(() => this._renderBarcodes(selectedProducts, size), 150);
  },

  printLabels() {
    const size = document.getElementById('labelSize')?.value || '3x2';
    const selectedProducts = this.products.filter(p => this.selected.has(p.sku));
    if (selectedProducts.length === 0) return;

    const expanded = this._expandWithQuantities(selectedProducts);
    const preview = document.getElementById('labelPreview');
    preview.innerHTML = this._buildLabelHtml(expanded, size);
    this._showPreview(preview);

    setTimeout(() => {
      this._renderBarcodes(selectedProducts, size);
      setTimeout(() => {
        window.print();
        this._hidePreview(preview);
      }, 300);
    }, 150);
  },

  printSingleLabel(product) {
    if (!product) return;
    const size = App.settings.default_label_size || '3x2';
    const preview = document.getElementById('labelPreview');

    preview.innerHTML = this._buildLabelHtml([product], size);
    this._showPreview(preview);

    setTimeout(() => {
      this._renderBarcodes([product], size);
      setTimeout(() => {
        window.print();
        this._hidePreview(preview);
      }, 300);
    }, 150);
  },
};
