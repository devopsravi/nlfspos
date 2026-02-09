/* ========================================
   Label Printing Module
   ======================================== */

const Labels = {
  products: [],
  selected: new Set(),

  async init() {
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
      return `
        <div class="label-select-card ${isSelected ? 'selected' : ''}" data-sku="${esc(p.sku)}">
          <div class="lsc-check">${isSelected ? '✓' : ''}</div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">${esc(p.name)}</div>
            <div class="text-xs text-gray-400">${esc(p.sku)} | ${esc(p.category)} | ${App.currency(p.selling_price)}</div>
          </div>
        </div>`;
    }).join('');

    // Click handlers
    container.querySelectorAll('.label-select-card').forEach(card => {
      card.addEventListener('click', () => {
        const sku = card.dataset.sku;
        if (this.selected.has(sku)) {
          this.selected.delete(sku);
        } else {
          this.selected.add(sku);
        }
        this.render();
        this.updatePrintBtn();
      });
    });
  },

  updatePrintBtn() {
    const btn = document.getElementById('btnPrintLabels');
    if (btn) btn.disabled = this.selected.size === 0;
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
        this.products.forEach(p => this.selected.add(p.sku));
      }
      this.render();
      this.updatePrintBtn();
    });

    // Print
    document.getElementById('btnPrintLabels')?.addEventListener('click', () => this.printLabels());
  },

  printLabels() {
    const size = document.getElementById('labelSize')?.value || '3x2';
    const selectedProducts = this.products.filter(p => this.selected.has(p.sku));
    if (selectedProducts.length === 0) return;

    const storeName = App.settings.store_name || 'Store';
    const sym = App.settings.currency_symbol || '₹';

    const preview = document.getElementById('labelPreview');

    // Build label HTML
    preview.innerHTML = selectedProducts.map(p => `
      <div class="print-label size-${size}" style="background:#fff;color:#000;">
        <div class="label-store">${esc(storeName)}</div>
        <div class="label-name">${esc(p.name)}</div>
        <div class="label-price">${esc(sym)}${parseFloat(p.selling_price).toFixed(2)}</div>
        <svg class="barcode barcode-${p.sku.replace(/[^a-zA-Z0-9]/g, '')}"></svg>
        <div class="label-sku">${esc(p.sku)}</div>
        <div class="label-meta">${esc(p.dimensions || '')} ${p.color ? '| ' + esc(p.color) : ''}</div>
      </div>
    `).join('');

    // Show the preview (it's a direct child of body so print CSS will find it)
    preview.classList.remove('hidden');
    preview.style.display = 'flex';
    preview.style.flexWrap = 'wrap';
    preview.style.gap = '8px';
    preview.style.padding = '16px';
    preview.style.background = '#fff';

    // Render barcodes, then print
    setTimeout(() => {
      selectedProducts.forEach(p => {
        const safeClass = p.sku.replace(/[^a-zA-Z0-9]/g, '');
        try {
          JsBarcode(`.barcode-${safeClass}`, p.sku, {
            format: 'CODE128',
            width: 1.2,
            height: size === '2x1' ? 18 : size === '3x2' ? 28 : 34,
            displayValue: false,
            margin: 2,
          });
        } catch (e) {
          console.warn('Barcode render failed for', p.sku, e);
        }
      });

      // Small delay for barcodes to render, then open print dialog
      setTimeout(() => {
        window.print();
        // Clean up after print dialog closes
        preview.classList.add('hidden');
        preview.style.display = '';
        preview.style.padding = '';
        preview.style.background = '';
      }, 300);
    }, 150);
  },
};
