/* ========================================
   Dashboard Module
   ======================================== */

const Sales = {
  async init() {
    await this.loadDashboard();
  },

  async loadDashboard() {
    try {
      const res = await fetch('/api/sales/dashboard');
      const d = await res.json();

      // Today's Takings
      document.getElementById('dashTodayCount').textContent = d.today_count;
      document.getElementById('dashToday').textContent = App.currency(d.today_total);
      document.getElementById('dashCost').textContent = App.currency(d.total_cost);
      document.getElementById('dashProfit').textContent = App.currency(d.total_profit);
      const voidsEl = document.getElementById('dashVoids');
      const refundsEl = document.getElementById('dashRefunds');
      if (voidsEl) voidsEl.textContent = '0';
      if (refundsEl) refundsEl.textContent = '0';

      // Stats
      const marginPct = d.total_revenue > 0
        ? (((d.total_revenue - d.total_cost) / d.total_revenue) * 100).toFixed(1)
        : '0.0';
      document.getElementById('dashMarginPct').textContent = marginPct + '%';
      document.getElementById('dashMonthSales').textContent = App.currency(d.month_total);

      const totalSales = d.month_count || 1;
      document.getElementById('dashAvgTicket').textContent = App.currency(d.month_total / totalSales);

      const dayOfMonth = new Date().getDate() || 1;
      document.getElementById('dashAvgDaily').textContent = (d.month_count / dayOfMonth).toFixed(1);

      // Inventory grade
      const invGrade = document.getElementById('dashInvGrade');
      if (invGrade) {
        const lowPct = d.low_stock_pct || 0;
        if (lowPct <= 5) invGrade.textContent = 'A+';
        else if (lowPct <= 15) invGrade.textContent = 'A';
        else if (lowPct <= 30) invGrade.textContent = 'B';
        else if (lowPct <= 50) invGrade.textContent = 'C';
        else invGrade.textContent = 'D';
      }
      document.getElementById('dashLowStock').textContent = d.low_stock_count;

      // Top products table
      const topEl = document.getElementById('topProducts');
      if (d.top_products.length === 0) {
        topEl.innerHTML = '<div class="px-4 py-4 text-center text-gray-400 text-xs">No sales yet</div>';
      } else {
        topEl.innerHTML = `
          <table class="w-full text-xs">
            <thead class="bg-gray-50 text-left text-gray-500 uppercase text-[10px]">
              <tr><th class="px-3 py-1.5">#</th><th class="px-3 py-1.5">Name</th><th class="px-3 py-1.5 text-right">Qty</th><th class="px-3 py-1.5 text-right">Value</th></tr>
            </thead>
            <tbody class="divide-y">
              ${d.top_products.map((p, i) => `
                <tr class="hover:bg-gray-50">
                  <td class="px-3 py-1.5 text-gray-400">${i + 1}</td>
                  <td class="px-3 py-1.5 font-medium text-gray-700 truncate max-w-[180px]">${esc(p.name)}</td>
                  <td class="px-3 py-1.5 text-right text-blue-600 font-semibold">${p.qty_sold.toFixed(0)}</td>
                  <td class="px-3 py-1.5 text-right font-medium">${App.currency(p.revenue)}</td>
                </tr>`).join('')}
            </tbody>
          </table>`;
      }

      // Sales chart (last 7 days bar chart)
      this.renderSalesChart(d);

      // Payment mix
      this.renderPaymentMix(d);

    } catch (e) {
      console.error('Dashboard load failed', e);
    }
  },

  async renderSalesChart(dashData) {
    const chartEl = document.getElementById('salesChart');
    if (!chartEl) return;

    try {
      const res = await fetch('/api/sales');
      const sales = await res.json();

      // Build last 7 days
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().split('T')[0]);
      }

      const dailyTotals = {};
      days.forEach(day => dailyTotals[day] = 0);
      sales.forEach(s => {
        if ((s.status || 'Complete') === 'Voided') return; // exclude voided
        const sDate = s.date || (s.timestamp ? s.timestamp.split('T')[0] : '');
        if (dailyTotals[sDate] !== undefined) {
          dailyTotals[sDate] += s.grand_total || 0;
        }
      });

      const values = days.map(d => dailyTotals[d]);
      const max = Math.max(...values, 1);

      // Format currency short (e.g. ₹1.2L, ₹50K, ₹800)
      const shortCur = (v) => {
        if (v >= 100000) return '₹' + (v / 100000).toFixed(1) + 'L';
        if (v >= 1000) return '₹' + (v / 1000).toFixed(1) + 'K';
        return '₹' + Math.round(v);
      };

      // Y-axis gridlines (5 steps)
      const steps = 4;
      let gridHtml = '';
      for (let i = steps; i >= 0; i--) {
        const val = (max / steps) * i;
        const bottom = (i / steps) * 100;
        gridHtml += `<div class="absolute left-0 right-0" style="bottom:${bottom}%">
          <div class="border-t border-gray-100 w-full"></div>
          <span class="absolute -left-1 -translate-x-full text-[9px] text-gray-400 -top-2">${i > 0 ? shortCur(val) : '0'}</span>
        </div>`;
      }

      // Bar chart
      const barWidth = `calc((100% - ${(days.length - 1) * 8}px) / ${days.length})`;
      const barsHtml = values.map((v, i) => {
        const pct = max > 0 ? Math.max((v / max) * 100, 1) : 1;
        const dayLabel = new Date(days[i] + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
        const isToday = i === days.length - 1;
        const barColor = isToday
          ? 'background: linear-gradient(to top, #0d9488, #14b8a6)'
          : 'background: linear-gradient(to top, #3b82f6, #60a5fa)';
        return `
          <div class="flex flex-col items-center" style="width:${barWidth}">
            <div class="w-full flex flex-col items-center justify-end" style="height:160px">
              <span class="text-[9px] font-semibold mb-1 ${isToday ? 'text-teal-700' : 'text-blue-600'}">${v > 0 ? shortCur(v) : ''}</span>
              <div class="w-full max-w-[40px] rounded-t-md shadow-sm" style="height:${pct}%;min-height:3px;${barColor};transition:height 0.6s ease"></div>
            </div>
            <span class="text-[10px] mt-1.5 ${isToday ? 'text-teal-700 font-bold' : 'text-gray-500'}">${dayLabel}</span>
          </div>`;
      }).join('');

      chartEl.innerHTML = `
        <div class="relative pl-10 pr-2 pt-2 pb-0" style="height:200px">
          <div class="relative w-full" style="height:160px">${gridHtml}</div>
        </div>
        <div class="flex items-end justify-between gap-2 pl-10 pr-2" style="margin-top:-160px;height:160px;position:relative;z-index:1">
          ${barsHtml}
        </div>
        <div class="flex justify-between pl-10 pr-2">
          ${values.map((_, i) => {
            const dayLabel = new Date(days[i] + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
            const isToday = i === days.length - 1;
            return `<span class="text-[10px] text-center ${isToday ? 'text-teal-700 font-bold' : 'text-gray-500'}" style="width:${barWidth}">${dayLabel}</span>`;
          }).join('')}
        </div>`;
    } catch (e) {
      chartEl.innerHTML = '<p class="text-gray-400 text-xs text-center w-full">No chart data</p>';
    }
  },

  renderPaymentMix(dashData) {
    const mixEl = document.getElementById('paymentMix');
    if (!mixEl) return;

    // We need payment breakdown — fetch from sales
    fetch('/api/sales').then(r => r.json()).then(sales => {
      const byMethod = {};
      let total = 0;
      sales.forEach(s => {
        const m = s.payment_method || 'Other';
        byMethod[m] = (byMethod[m] || 0) + (s.grand_total || 0);
        total += s.grand_total || 0;
      });

      if (total === 0) {
        mixEl.innerHTML = '<p class="text-gray-400 text-xs">No sales data</p>';
        return;
      }

      const colors = { Cash: '#22c55e', Card: '#3b82f6', UPI: '#f97316', Other: '#a855f7' };
      const methods = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);

      // Build a simple horizontal stacked bar + legend
      const barSegments = methods.map(([m, v]) => {
        const pct = ((v / total) * 100).toFixed(1);
        return `<div style="width:${pct}%;background:${colors[m] || '#6b7280'};height:100%;min-width:2px" title="${m}: ${pct}%"></div>`;
      }).join('');

      const legendItems = methods.map(([m, v]) => {
        const pct = ((v / total) * 100).toFixed(1);
        return `
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-sm flex-shrink-0" style="background:${colors[m] || '#6b7280'}"></div>
            <span class="text-xs text-gray-700 font-medium">${m}</span>
            <span class="text-xs text-gray-400 ml-auto">${pct}%</span>
            <span class="text-xs font-semibold">${App.currency(v)}</span>
          </div>`;
      }).join('');

      mixEl.innerHTML = `
        <div class="w-full">
          <div class="flex h-8 rounded-lg overflow-hidden mb-4 shadow-inner">${barSegments}</div>
          <div class="space-y-2.5">${legendItems}</div>
        </div>`;
    }).catch(() => {
      mixEl.innerHTML = '<p class="text-gray-400 text-xs">Failed to load</p>';
    });
  },
};
