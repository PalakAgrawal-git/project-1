/* ═══════════════════════════════════════════════════════════════
   FinanceFlow — script.js
   Complete Finance Dashboard Logic
   
   Architecture is Firebase-ready:
   - All data operations go through DataStore (swap for Firebase later)
   - UI rendering is decoupled from storage
   - Each section has its own render function
   
   Sections:
   1.  DataStore         — LocalStorage CRUD (swap for Firebase here)
   2.  Utility helpers   — formatting, dates, IDs
   3.  App state         — runtime state (filter, sort, search)
   4.  Summary cards     — render top 4 KPI cards
   5.  Form              — add payment form logic
   6.  Table             — client transaction table
   7.  Analysis cards    — best/worst client, monthly filter
   8.  Chart             — Chart.js line graph
   9.  Navigation        — sidebar + mobile menu
   10. Initialisation    — boot sequence
   ═══════════════════════════════════════════════════════════════ */


/* ─────────────────────────────────────────────────────────────
   1. DATA STORE
   LocalStorage wrapper.  To switch to Firebase later, only edit
   this section — the rest of the app calls these functions.
───────────────────────────────────────────────────────────── */
const DataStore = (() => {
  const KEY = 'financeflow_transactions'; // LocalStorage key

  /** Return all transactions as an array */
  function getAll() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch {
      return [];
    }
  }

  /** Save an array of transactions back to LocalStorage */
  function saveAll(transactions) {
    localStorage.setItem(KEY, JSON.stringify(transactions));
  }

  /** Add one new transaction object, return it with a generated id */
  function add(entry) {
    const transactions = getAll();
    const newEntry = {
      id:        generateId(),
      client:    entry.client.trim(),
      project:   entry.project.trim(),
      payment:   Number(entry.payment),
      expense:   Number(entry.expense),
      profit:    Number(entry.payment) - Number(entry.expense),
      date:      entry.date || todayISO(),
      createdAt: Date.now(),
    };
    transactions.push(newEntry);
    saveAll(transactions);
    return newEntry;
  }

  /** Delete a transaction by id */
  function remove(id) {
    const updated = getAll().filter(t => t.id !== id);
    saveAll(updated);
  }

  /** Wipe everything — used by the Clear Data button */
  function clearAll() {
    localStorage.removeItem(KEY);
  }

  return { getAll, add, remove, clearAll };
})();


/* ─────────────────────────────────────────────────────────────
   2. UTILITY HELPERS
───────────────────────────────────────────────────────────── */

/** Create a short unique id  */
function generateId() {
  return '_' + Math.random().toString(36).slice(2, 10);
}

/** Today as YYYY-MM-DD  */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Format a number as Indian Rupee string: ₹1,00,000  */
function formatINR(amount) {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-IN');
  return '₹' + formatted;
}

/** Format ISO date string to "15 Jan 2025" */
function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun',
                   'Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

/** Return "June 2025" label for an ISO date string */
function monthLabel(iso) {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

/** Return "YYYY-MM" bucket for an ISO date string */
function monthBucket(iso) {
  return iso ? iso.slice(0, 7) : '';
}

/** Get the first initial of a name for the avatar badge  */
function initial(name) {
  return name ? name.trim()[0].toUpperCase() : '?';
}

/** Animate a numeric value ticking up in an element  */
function animateCounter(el, target, prefix = '₹', duration = 700) {
  const start = 0;
  const startTime = performance.now();
  const isNeg = target < 0;
  const absTarget = Math.abs(target);

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(eased * absTarget);
    el.textContent = (isNeg ? '-' : '') + prefix + current.toLocaleString('en-IN');
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/** Show a brief toast message inside the form  */
function showToast(message, type = 'success') {
  const toast = document.getElementById('formToast');
  toast.textContent = message;
  toast.className = `form-toast show ${type}`;
  setTimeout(() => { toast.className = 'form-toast'; }, 3000);
}


/* ─────────────────────────────────────────────────────────────
   3. APP STATE
   Holds runtime filter/search/sort choices (not persisted).
───────────────────────────────────────────────────────────── */
const State = {
  filter:       'all',   // 'all' | 'profit' | 'loss'
  sortByProfit: false,   // true = sort descending by profit
  search:       '',      // current search string
  selectedMonth: '',     // 'YYYY-MM' or '' for all time
};


/* ─────────────────────────────────────────────────────────────
   4. SUMMARY CARDS
───────────────────────────────────────────────────────────── */
function renderSummaryCards() {
  const transactions = DataStore.getAll();

  const totalRevenue  = transactions.reduce((s, t) => s + t.payment, 0);
  const totalExpenses = transactions.reduce((s, t) => s + t.expense, 0);
  const netProfit     = totalRevenue - totalExpenses;
  // Count unique clients by name (case-insensitive)
  const uniqueClients = new Set(
    transactions.map(t => t.client.toLowerCase())
  ).size;

  // Helper to update one card's value with counter animation
  function updateCard(id, value, prefix = '₹') {
    const el = document.getElementById(id);
    if (!el) return;
    // Trigger pop animation
    el.classList.remove('pop');
    void el.offsetWidth; // reflow
    el.classList.add('pop');
    animateCounter(el, value, prefix, 800);
  }

  updateCard('totalRevenue',  totalRevenue);
  updateCard('totalExpenses', totalExpenses);
  updateCard('netProfit',     netProfit);

  // Clients card uses a plain number with no ₹ prefix
  const clientEl = document.getElementById('totalClients');
  if (clientEl) {
    clientEl.classList.remove('pop');
    void clientEl.offsetWidth;
    clientEl.classList.add('pop');
    animateCounter(clientEl, uniqueClients, '', 600);
  }

  // Colour net profit red if negative
  const profitEl = document.getElementById('netProfit');
  if (profitEl) {
    profitEl.style.color = netProfit < 0
      ? 'var(--col-loss)'
      : netProfit > 0 ? 'var(--col-profit)' : '';
  }

  // Sub-labels
  const avgExpense = uniqueClients > 0
    ? Math.round(totalExpenses / uniqueClients) : 0;

  const margin = totalRevenue > 0
    ? Math.round((netProfit / totalRevenue) * 100) : 0;

  const thisMonthBucket = todayISO().slice(0, 7);
  const thisMonthRev = transactions
    .filter(t => monthBucket(t.date) === thisMonthBucket)
    .reduce((s, t) => s + t.payment, 0);
  const pct = totalRevenue > 0
    ? Math.round((thisMonthRev / totalRevenue) * 100) : 0;

  setText('revenueChange',  `${pct}% revenue this month`);
  setText('expensesChange', `${formatINR(avgExpense)} avg / client`);
  setText('profitMargin',   `${margin}% profit margin`);
  setText('clientsActive',  `${transactions.length} total entries`);
}

/** Shorthand — set textContent if element exists  */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}


/* ─────────────────────────────────────────────────────────────
   5. ADD PAYMENT FORM
───────────────────────────────────────────────────────────── */
function initForm() {
  const btn = document.getElementById('addPaymentBtn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const client  = document.getElementById('clientName').value.trim();
    const project = document.getElementById('projectName').value.trim();
    const payment = parseFloat(document.getElementById('paymentAmount').value);
    const expense = parseFloat(document.getElementById('expenseAmount').value);

    // ── Validation ──
    if (!client) {
      showToast('Please enter a client name.', 'error'); return;
    }
    if (!project) {
      showToast('Please enter a project / service name.', 'error'); return;
    }
    if (isNaN(payment) || payment < 0) {
      showToast('Enter a valid payment amount.', 'error'); return;
    }
    if (isNaN(expense) || expense < 0) {
      showToast('Enter a valid expense amount.', 'error'); return;
    }

    // ── Save ──
    DataStore.add({ client, project, payment, expense });

    // ── Clear form ──
    document.getElementById('clientName').value    = '';
    document.getElementById('projectName').value   = '';
    document.getElementById('paymentAmount').value = '';
    document.getElementById('expenseAmount').value = '';

    const profit = payment - expense;
    const msg = profit >= 0
      ? `✓ Added! Profit: ${formatINR(profit)}`
      : `✓ Added! Loss: ${formatINR(Math.abs(profit))}`;
    showToast(msg, profit >= 0 ? 'success' : 'error');

    // ── Re-render everything ──
    renderAll();
  });

  // Allow pressing Enter in the last field
  document.getElementById('expenseAmount')
    ?.addEventListener('keydown', e => {
      if (e.key === 'Enter') btn.click();
    });
}


/* ─────────────────────────────────────────────────────────────
   6. TRANSACTION TABLE
───────────────────────────────────────────────────────────── */
function renderTable() {
  const tbody    = document.getElementById('transactionBody');
  const empty    = document.getElementById('tableEmpty');
  if (!tbody) return;

  let transactions = DataStore.getAll();

  // ── Apply search ──
  if (State.search) {
    const q = State.search.toLowerCase();
    transactions = transactions.filter(t =>
      t.client.toLowerCase().includes(q) ||
      t.project.toLowerCase().includes(q)
    );
  }

  // ── Apply filter ──
  if (State.filter === 'profit') {
    transactions = transactions.filter(t => t.profit >= 0);
  } else if (State.filter === 'loss') {
    transactions = transactions.filter(t => t.profit < 0);
  }

  // ── Apply sort ──
  if (State.sortByProfit) {
    transactions = [...transactions].sort((a, b) => b.profit - a.profit);
  } else {
    // Default: newest first
    transactions = [...transactions].sort((a, b) => b.createdAt - a.createdAt);
  }

  // ── Show/hide empty state ──
  const allData = DataStore.getAll();
  if (allData.length === 0) {
    empty?.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }
  empty?.classList.add('hidden');

  // ── Build rows ──
  tbody.innerHTML = transactions.map((t, idx) => {
    const isProfit = t.profit >= 0;
    const plLabel  = isProfit
      ? `<span class="pl-pill pl-profit">▲ ${formatINR(t.profit)} Profit</span>`
      : `<span class="pl-pill pl-loss">▼ ${formatINR(Math.abs(t.profit))} Loss</span>`;
    const status   = isProfit
      ? `<span class="status-badge status-active">Active</span>`
      : `<span class="status-badge status-warning">Warning</span>`;

    return `
      <tr class="new-row">
        <td>${idx + 1}</td>
        <td class="client-name-cell">
          <span class="client-badge">${initial(t.client)}</span>${t.client}
        </td>
        <td class="project-cell">${t.project}</td>
        <td class="amount-cell">${formatINR(t.payment)}</td>
        <td class="amount-cell">${formatINR(t.expense)}</td>
        <td>${plLabel}</td>
        <td>${formatDate(t.date)}</td>
        <td>${status}</td>
        <td>
          <button class="btn-delete" onclick="deleteEntry('${t.id}')" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14H6L5 6"></path>
              <path d="M10 11v6M14 11v6"></path>
            </svg>
          </button>
        </td>
      </tr>`;
  }).join('');
}

/** Delete a row by id and re-render everything */
function deleteEntry(id) {
  if (!confirm('Delete this transaction?')) return;
  DataStore.remove(id);
  renderAll();
}

/** Wire up search, filter tabs, and sort button */
function initTableControls() {
  // Search
  document.getElementById('searchInput')?.addEventListener('input', e => {
    State.search = e.target.value;
    renderTable();
  });

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.filter = btn.dataset.filter;
      renderTable();
    });
  });

  // Sort button
  document.getElementById('sortBtn')?.addEventListener('click', function () {
    State.sortByProfit = !State.sortByProfit;
    this.classList.toggle('active', State.sortByProfit);
    this.querySelector('svg')?.setAttribute('style',
      State.sortByProfit ? 'transform:rotate(180deg)' : '');
    renderTable();
  });
}


/* ─────────────────────────────────────────────────────────────
   7. ANALYSIS CARDS + MONTHLY FILTER
───────────────────────────────────────────────────────────── */
function renderAnalysis() {
  const transactions = DataStore.getAll();

  // ── Per-client aggregation ──
  const clientMap = {}; // { 'clientName': { revenue, expense, profit } }
  transactions.forEach(t => {
    const key = t.client.toLowerCase();
    if (!clientMap[key]) {
      clientMap[key] = { name: t.client, revenue: 0, expense: 0, profit: 0 };
    }
    clientMap[key].revenue += t.payment;
    clientMap[key].expense += t.expense;
    clientMap[key].profit  += t.profit;
  });

  const clients = Object.values(clientMap);

  // Most profitable
  const best = clients.length
    ? clients.reduce((a, b) => a.profit > b.profit ? a : b)
    : null;

  // Highest loss (most negative profit)
  const lossClients = clients.filter(c => c.profit < 0);
  const worst = lossClients.length
    ? lossClients.reduce((a, b) => a.profit < b.profit ? a : b)
    : null;

  // Best client card
  if (best) {
    setText('bestClientName',   best.name);
    setText('bestClientProfit', `${formatINR(best.profit)} ${best.profit >= 0 ? 'Profit' : 'Loss'}`);
    setText('bestClientMeta',
      `Revenue: ${formatINR(best.revenue)} · Expense: ${formatINR(best.expense)}`);
    const el = document.getElementById('bestClientProfit');
    if (el) el.className = 'analysis-amount ' + (best.profit >= 0 ? 'profit-text' : 'loss-text');
  } else {
    setText('bestClientName',   '—');
    setText('bestClientProfit', '₹0');
    setText('bestClientMeta',   'No data yet');
  }

  // Worst client card
  if (worst) {
    setText('worstClientName', worst.name);
    setText('worstClientLoss', `${formatINR(Math.abs(worst.profit))} Loss`);
    setText('worstClientMeta',
      `Revenue: ${formatINR(worst.revenue)} · Expense: ${formatINR(worst.expense)}`);
  } else {
    setText('worstClientName', '—');
    setText('worstClientLoss', '₹0 Loss');
    setText('worstClientMeta', 'No loss clients');
  }

  // ── Monthly filter ──
  renderMonthFilter(transactions);
}

function renderMonthFilter(transactions) {
  const select = document.getElementById('monthFilter');
  if (!select) return;

  // Build sorted list of unique months
  const buckets = [...new Set(transactions.map(t => monthBucket(t.date)))]
    .filter(Boolean)
    .sort()
    .reverse();

  // Rebuild options only if list changed
  const currentBuckets = [...select.options].map(o => o.value).filter(v => v);
  const newBuckets = buckets;
  if (JSON.stringify(currentBuckets) !== JSON.stringify(newBuckets)) {
    select.innerHTML = '<option value="">All Time</option>';
    newBuckets.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = monthLabel(b + '-01');
      select.appendChild(opt);
    });
    // Restore previous selection if still valid
    if (State.selectedMonth && newBuckets.includes(State.selectedMonth)) {
      select.value = State.selectedMonth;
    }
  }

  // Calculate for selected period
  const filtered = State.selectedMonth
    ? transactions.filter(t => monthBucket(t.date) === State.selectedMonth)
    : transactions;

  const mRevenue  = filtered.reduce((s, t) => s + t.payment, 0);
  const mExpense  = filtered.reduce((s, t) => s + t.expense, 0);
  const mProfit   = mRevenue - mExpense;

  setText('monthRevenue',  formatINR(mRevenue));
  setText('monthExpenses', formatINR(mExpense));

  const profitEl = document.getElementById('monthProfit');
  if (profitEl) {
    profitEl.textContent = formatINR(mProfit);
    profitEl.className   = mProfit >= 0 ? 'profit-text' : 'loss-text';
  }
}

function initMonthFilter() {
  document.getElementById('monthFilter')?.addEventListener('change', e => {
    State.selectedMonth = e.target.value;
    renderMonthFilter(DataStore.getAll());
    renderChart(); // chart also respects month context
  });
}


/* ─────────────────────────────────────────────────────────────
   8. CHART.JS LINE GRAPH
───────────────────────────────────────────────────────────── */
let chartInstance = null; // holds the Chart.js instance so we can destroy/recreate

function renderChart() {
  const canvas = document.getElementById('financialChart');
  const empty  = document.getElementById('chartEmpty');
  if (!canvas) return;

  const transactions = DataStore.getAll();

  if (transactions.length === 0) {
    empty?.classList.remove('hidden');
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    return;
  }
  empty?.classList.add('hidden');

  // ── Aggregate by month bucket ──
  const bucketMap = {}; // { 'YYYY-MM': { revenue, expense, profit } }

  transactions.forEach(t => {
    const b = monthBucket(t.date);
    if (!bucketMap[b]) bucketMap[b] = { revenue: 0, expense: 0, profit: 0 };
    bucketMap[b].revenue += t.payment;
    bucketMap[b].expense += t.expense;
    bucketMap[b].profit  += t.profit;
  });

  // Sort months chronologically
  const sortedBuckets = Object.keys(bucketMap).sort();

  const labels   = sortedBuckets.map(b => monthLabel(b + '-01'));
  const revenues = sortedBuckets.map(b => bucketMap[b].revenue);
  const expenses = sortedBuckets.map(b => bucketMap[b].expense);
  const profits  = sortedBuckets.map(b => bucketMap[b].profit);

  // ── Chart.js config ──
  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label:           'Revenue',
          data:            revenues,
          borderColor:     '#6366F1',
          backgroundColor: 'rgba(99,102,241,0.08)',
          tension:         0.4,
          fill:            true,
          pointBackgroundColor: '#6366F1',
          pointRadius:     5,
          pointHoverRadius: 7,
          borderWidth:     2.5,
        },
        {
          label:           'Expenses',
          data:            expenses,
          borderColor:     '#F59E0B',
          backgroundColor: 'rgba(245,158,11,0.06)',
          tension:         0.4,
          fill:            true,
          pointBackgroundColor: '#F59E0B',
          pointRadius:     5,
          pointHoverRadius: 7,
          borderWidth:     2.5,
        },
        {
          label:           'Net Profit',
          data:            profits,
          borderColor:     '#10B981',
          backgroundColor: 'rgba(16,185,129,0.07)',
          tension:         0.4,
          fill:            true,
          pointBackgroundColor: '#10B981',
          pointRadius:     5,
          pointHoverRadius: 7,
          borderWidth:     2.5,
        },
      ],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction: {
        mode:      'index',
        intersect: false,
      },
      plugins: {
        legend: { display: false }, // we use our custom legend in HTML
        tooltip: {
          backgroundColor: '#0F172A',
          titleColor:      '#E2E8F0',
          bodyColor:       '#94A3B8',
          padding:         12,
          cornerRadius:    8,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ₹${ctx.parsed.y.toLocaleString('en-IN')}`,
          },
        },
      },
      scales: {
        x: {
          grid:  { display: false },
          ticks: { color: '#94A3B8', font: { size: 11, family: 'Inter' } },
        },
        y: {
          grid:  { color: '#F1F5F9' },
          ticks: {
            color: '#94A3B8',
            font:  { size: 11, family: 'Inter' },
            callback: val => '₹' + (val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val),
          },
          beginAtZero: true,
        },
      },
    },
  };

  // Destroy existing chart before re-creating (avoids canvas re-use warnings)
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  chartInstance = new Chart(canvas, cfg);
}


/* ─────────────────────────────────────────────────────────────
   9. SIDEBAR NAVIGATION + MOBILE MENU
───────────────────────────────────────────────────────────── */
function initNavigation() {
  const pageTitles = {
    dashboard: { title: 'Overview Dashboard', sub: 'Your business at a glance' },
    finance:   { title: 'Finance Dashboard',  sub: 'Track revenue, expenses & profit' },
    clients:   { title: 'Client Management',  sub: 'Manage your client relationships' },
    reports:   { title: 'Reports & Export',   sub: 'Generate financial reports' },
    settings:  { title: 'Settings',           sub: 'Configure your workspace' },
  };

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const page = item.dataset.page;

      // Update active nav link
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      // Show correct page
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-' + page)?.classList.add('active');

      // Update topbar title
      const info = pageTitles[page] || {};
      setText('pageTitle',    info.title || '');
      setText('pageSubtitle', info.sub   || '');

      // Close mobile sidebar
      closeMobileSidebar();
    });
  });

  // Mobile menu toggle
  const menuBtn = document.getElementById('menuToggle');
  const sidebar  = document.getElementById('sidebar');

  // Create overlay for mobile
  let overlay = document.querySelector('.sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }

  menuBtn?.addEventListener('click', () => {
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) {
      closeMobileSidebar();
    } else {
      sidebar.classList.add('open');
      overlay.classList.add('show');
    }
  });

  overlay.addEventListener('click', closeMobileSidebar);

  function closeMobileSidebar() {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('show');
  }
}

/** Clear all data with confirmation */
function initClearButton() {
  document.getElementById('exportBtn')?.addEventListener('click', () => {
    if (!confirm('This will permanently delete all transactions. Are you sure?')) return;
    DataStore.clearAll();
    State.selectedMonth = '';
    State.search        = '';
    State.filter        = 'all';
    State.sortByProfit  = false;

    // Reset filter buttons
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.filter-btn[data-filter="all"]')?.classList.add('active');

    // Clear search input
    const si = document.getElementById('searchInput');
    if (si) si.value = '';

    renderAll();
    showToast('All data cleared.', 'error');
  });
}

/** Set today's date in the topbar */
function renderCurrentDate() {
  const el = document.getElementById('currentDate');
  if (!el) return;
  const now = new Date();
  const opts = { weekday:'short', year:'numeric', month:'short', day:'numeric' };
  el.textContent = now.toLocaleDateString('en-IN', opts);
}


/* ─────────────────────────────────────────────────────────────
   MASTER RENDER — call after every data change
───────────────────────────────────────────────────────────── */
function renderAll() {
  renderSummaryCards();
  renderTable();
  renderAnalysis();
  renderChart();
}


/* ─────────────────────────────────────────────────────────────
   10. INITIALISATION
   Boot sequence: wire up all event listeners then render.
   
   To upgrade to Firebase later:
   1. Replace DataStore.getAll/add/remove with Firestore reads/writes
   2. Call renderAll() inside your Firestore onSnapshot() listener
   3. Remove localStorage key from DataStore
───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  console.log('[FinanceFlow] Dashboard initialising...');

  renderCurrentDate();   // topbar date
  initNavigation();      // sidebar nav + mobile
  initForm();            // add payment form
  initTableControls();   // search / filter / sort
  initMonthFilter();     // month dropdown listener
  initClearButton();     // clear data button

  // ── Seed demo data if this is the first visit ──
  if (DataStore.getAll().length === 0) {
    seedDemoData();
  }

  // First full render
  renderAll();

  console.log('[FinanceFlow] Ready. Transactions:', DataStore.getAll().length);
});


/* ─────────────────────────────────────────────────────────────
   DEMO DATA SEEDER
   Populates realistic sample transactions on first load
   so the dashboard looks great right away.
   Remove this function or the if-block above when going live.
───────────────────────────────────────────────────────────── */
function seedDemoData() {
  const today  = new Date();
  const month  = (n) => {
    const d = new Date(today);
    d.setMonth(d.getMonth() - n);
    return d.toISOString().slice(0, 10);
  };

  const samples = [
    { client:'ABC Technologies',  project:'Website Redesign',       payment:95000,  expense:45000,  date: month(0) },
    { client:'XYZ Marketing Co.', project:'Social Media Campaign',  payment:60000,  expense:72000,  date: month(0) },
    { client:'Patel Enterprises', project:'Brand Identity',         payment:120000, expense:55000,  date: month(0) },
    { client:'Green Leaf Foods',  project:'E-Commerce Platform',    payment:200000, expense:130000, date: month(1) },
    { client:'ABC Technologies',  project:'SEO & Analytics Setup',  payment:40000,  expense:18000,  date: month(1) },
    { client:'Nova Startups',     project:'Mobile App MVP',         payment:180000, expense:195000, date: month(1) },
    { client:'Bright Solar Ltd',  project:'Digital Marketing',      payment:75000,  expense:32000,  date: month(2) },
    { client:'XYZ Marketing Co.', project:'Content Strategy',       payment:45000,  expense:28000,  date: month(2) },
    { client:'Patel Enterprises', project:'Annual Audit Support',   payment:90000,  expense:41000,  date: month(3) },
    { client:'Mehta & Sons',      project:'ERP Integration',        payment:250000, expense:180000, date: month(3) },
    { client:'ClearView Optics',  project:'Product Photography',    payment:35000,  expense:52000,  date: month(4) },
    { client:'Bright Solar Ltd',  project:'Website Maintenance',    payment:30000,  expense:12000,  date: month(4) },
  ];

  samples.forEach(s => DataStore.add(s));
}
