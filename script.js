/* ═══════════════════════════════════════════════════════════════
   FinanceFlow — script.js  (v2)

   NEW in v2:
   - Common Expenses store (electricity, rent, subscriptions etc.)
   - Period filters: This Month / Last 3 Months / This Year / All Time
   - Client filter: per-client OR overall view
   - Net Profit = Revenue - Direct Client Expense - Common Expenses (period)
   - Common expenses split equally across active clients in that period
   - Line graph respects both period + client filters
   - Per-client monthly P&L table

   Firebase upgrade: swap DataStore.* methods with Firestore calls.
═══════════════════════════════════════════════════════════════ */


/* ─────────────────────────────────────────────
   1. DATA STORE  (LocalStorage — swap for Firebase here)
───────────────────────────────────────────── */
const DataStore = (() => {
  const TX_KEY  = 'ff_transactions';  // client payments
  const COM_KEY = 'ff_common_exp';    // common expenses

  /* ── Transactions ──
     Each transaction now holds an `expenses` array instead of a single
     amount, so you can log direct expenses for a client payment as they
     come in — weeks or months apart — each with its own amount, category
     and date. `expense` is kept as a derived cached total for anything
     that still reads it directly (summary cards, old records, etc). */
  function getAll() {
    let list;
    try { list = JSON.parse(localStorage.getItem(TX_KEY)) || []; } catch { list = []; }
    let migrated = false;
    list = list.map(t => {
      if (!Array.isArray(t.expenses)) {
        // Legacy record from before multi-expense support — wrap its
        // single amount into the new expenses array (one-time upgrade).
        const legacyAmount = +t.expense || 0;
        t.expenses = legacyAmount > 0
          ? [{ id: uid(), amount: legacyAmount, category: t.expenseCategory || 'Other', date: t.date, createdAt: t.createdAt || Date.now() }]
          : [];
        migrated = true;
      }
      t.expense = t.expenses.reduce((s,e) => s + (+e.amount || 0), 0);
      return t;
    });
    if (migrated) saveAll(list);
    return list;
  }
  function saveAll(d)  { localStorage.setItem(TX_KEY,  JSON.stringify(d)); }

  function addTx(e) {
    const list = getAll();
    const initialAmount = +e.expense || 0;
    const expenses = initialAmount > 0
      ? [{ id: uid(), amount: initialAmount, category: e.expenseCategory || 'Other', date: e.date || isoToday(), createdAt: Date.now() }]
      : [];
    const rec  = {
      id:        uid(),
      client:    e.client.trim(),
      project:   e.project.trim(),
      payment:   +e.payment,
      expenses,
      expense:   expenses.reduce((s,x) => s + x.amount, 0),
      date:      e.date || isoToday(),
      createdAt: Date.now(),
    };
    list.push(rec);
    saveAll(list);
    return rec;
  }

  function removeTx(id) { saveAll(getAll().filter(t => t.id !== id)); }

  /* Add a new expense entry to an existing client payment, any time later */
  function addExpenseToTx(txId, exp) {
    const list = getAll();
    const tx = list.find(t => t.id === txId);
    if (!tx) return null;
    const rec = { id: uid(), amount: +exp.amount || 0, category: exp.category || 'Other', date: exp.date || isoToday(), createdAt: Date.now() };
    tx.expenses.push(rec);
    saveAll(list);
    return rec;
  }

  /* Remove a single expense entry (e.g. to correct a mistake) */
  function removeExpenseFromTx(txId, expenseId) {
    const list = getAll();
    const tx = list.find(t => t.id === txId);
    if (!tx) return;
    tx.expenses = tx.expenses.filter(e => e.id !== expenseId);
    saveAll(list);
  }

  /* ── Common Expenses ── */
  function getCommon()       { try { return JSON.parse(localStorage.getItem(COM_KEY)) || []; } catch { return []; } }
  function saveCommon(d)     { localStorage.setItem(COM_KEY, JSON.stringify(d)); }

  function addCommon(e) {
    const list = getCommon();
    const rec  = {
      id:        uid(),
      name:      e.name.trim(),
      category:  e.category,
      amount:    +e.amount,
      month:     e.month,   // 'YYYY-MM'
      createdAt: Date.now(),
    };
    list.push(rec);
    saveCommon(list);
    return rec;
  }

  function removeCommon(id) { saveCommon(getCommon().filter(c => c.id !== id)); }

  function clearAll() {
    localStorage.removeItem(TX_KEY);
    localStorage.removeItem(COM_KEY);
  }

  return { getAll, addTx, removeTx, addExpenseToTx, removeExpenseFromTx, getCommon, addCommon, removeCommon, clearAll };
})();


/* ─────────────────────────────────────────────
   2. UTILITIES
───────────────────────────────────────────── */
function uid()      { return '_' + Math.random().toString(36).slice(2,10); }
function isoToday() { return new Date().toISOString().slice(0,10); }

function inr(n) {
  const abs = Math.abs(n);
  return '₹' + abs.toLocaleString('en-IN');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${+d} ${mo[+m-1]} ${y}`;
}

function bucket(iso)  { return iso ? iso.slice(0,7) : ''; }  // 'YYYY-MM'

function expenseCategoryLabel(cat) {
  const map = {
    Material:       'Material / Supplies',
    Subcontractor:  'Subcontractor / Freelancer',
    Software:       'Software / Tools',
    Travel:         'Travel / Transport',
    Printing:       'Printing / Stationery',
    Logistics:      'Logistics / Shipping',
    Other:          'Other',
  };
  return map[cat] || 'Other';
}

function expenseSummaryTag(t) {
  const entries = t.expenses || [];
  if (entries.length === 0) return '';
  if (entries.length === 1) return `<span class="expense-tag">${expenseCategoryLabel(entries[0].category)}</span>`;
  return `<span class="expense-tag">${entries.length} expenses</span>`;
}

function monthLabel(yyyymm) {
  if (!yyyymm) return '';
  const [y,m] = yyyymm.split('-');
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${mo[+m-1]} ${y}`;
}

function initial(name) { return name ? name.trim()[0].toUpperCase() : '?'; }

function animCount(el, val, pre='₹', dur=700) {
  const abs = Math.abs(val); const neg = val < 0; const t0 = performance.now();
  const step = now => {
    const p = Math.min((now-t0)/dur, 1);
    const e = 1 - Math.pow(1-p, 3);
    el.textContent = (neg?'-':'') + pre + Math.round(e*abs).toLocaleString('en-IN');
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setText(id, txt) { const el=document.getElementById(id); if(el) el.textContent=txt; }

function toast(id, msg, type='success') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `form-toast show ${type}`;
  setTimeout(() => el.className = 'form-toast', 3000);
}


/* ─────────────────────────────────────────────
   3. APP STATE
───────────────────────────────────────────── */
const State = {
  period:       'all',     // 'month' | '3months' | 'year' | 'all' | 'custom'
  customMonth:  '',        // 'YYYY-MM' when period === 'custom'
  clientFilter: 'all',
  tableFilter:  'all',
  sortByProfit: false,
  search:       '',
};


/* ─────────────────────────────────────────────
   4. PERIOD HELPERS
   Returns { start, end } ISO date strings for
   the selected period, used to filter records.
───────────────────────────────────────────── */
function getPeriodRange() {
  const now   = new Date();
  const today = isoToday();

  if (State.period === 'month') {
    const start = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    return { start, end: today };
  }
  if (State.period === '3months') {
    const d = new Date(now); d.setMonth(d.getMonth() - 2); d.setDate(1);
    return { start: d.toISOString().slice(0,10), end: today };
  }
  if (State.period === 'year') {
    return { start: `${now.getFullYear()}-01-01`, end: today };
  }
  // Custom month selected from calendar picker
  if (State.period === 'custom' && State.customMonth) {
    const [y, m] = State.customMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate(); // last day of chosen month
    return {
      start: `${State.customMonth}-01`,
      end:   `${State.customMonth}-${String(lastDay).padStart(2,'0')}`,
    };
  }
  // all — wide range
  return { start: '2000-01-01', end: '2099-12-31' };
}

function inRange(iso, range) {
  return iso >= range.start && iso <= range.end;
}

/** Label for the current period */
function periodLabel() {
  const now = new Date();
  if (State.period === 'month')   return new Date().toLocaleString('en-IN',{month:'long',year:'numeric'});
  if (State.period === '3months') return 'Last 3 Months';
  if (State.period === 'year')    return `Year ${now.getFullYear()}`;
  if (State.period === 'custom' && State.customMonth) return monthLabel(State.customMonth);
  return 'All Time';
}


/* ─────────────────────────────────────────────
   5. CORE CALCULATION ENGINE
   For a given set of transactions + common expenses
   and an optional client filter, returns aggregated
   financial data.
───────────────────────────────────────────── */
function calcStats(allTx, commonList, clientName = 'all', range) {
  /*
    Common expense allocation:
    - Find how many unique clients had activity in the period
    - Split common expenses equally among them
    - Each client's share = totalCommon / activeClients
    - If viewing one client: their share = totalCommon / activeClients
    - If viewing all: full common total is shown

    Revenue is attributed to the period the PAYMENT was received in.
    Direct expenses are attributed to the period each EXPENSE ENTRY was
    actually logged in — since you might add an expense to an old
    client payment weeks or months later, it should count in the month
    you actually spent it, not the month the original payment landed.
  */

  // Active clients in this period = anyone with a payment OR a logged
  // expense entry whose own date falls in range (used for common-split)
  const txInRange  = allTx.filter(t => inRange(t.date, range));
  const expInRange = allTx.flatMap(t => (t.expenses||[]).filter(e => inRange(e.date, range)).map(e => ({...e, client: t.client})));
  const allActiveClients = new Set([
    ...txInRange.map(t => t.client.toLowerCase()),
    ...expInRange.map(e => e.client.toLowerCase()),
  ]).size || 1;

  const totalCommon      = commonList.reduce((s,c) => s + c.amount, 0);
  const commonPerClient  = totalCommon / allActiveClients;

  // Now filter by client if needed
  const revTx  = clientName === 'all' ? txInRange  : txInRange.filter(t => t.client.toLowerCase() === clientName);
  const expFor = clientName === 'all' ? expInRange : expInRange.filter(e => e.client.toLowerCase() === clientName);

  const revenue    = revTx.reduce((s,t) => s + t.payment, 0);
  const directExp  = expFor.reduce((s,e) => s + (+e.amount||0), 0);

  // Common share depends on view
  let commonShare;
  if (clientName === 'all') {
    commonShare = totalCommon;
  } else {
    commonShare = commonPerClient;  // one client's proportional share
  }

  const netProfit  = revenue - directExp - commonShare;
  const uniqueCl   = new Set(revTx.map(t => t.client.toLowerCase())).size;

  return { revenue, directExp, commonShare, netProfit, uniqueCl, count: revTx.length };
}


/* ─────────────────────────────────────────────
   6. SUMMARY CARDS (all-time, always)
───────────────────────────────────────────── */
function renderSummaryCards() {
  const tx  = DataStore.getAll();
  const com = DataStore.getCommon();

  const revenue   = tx.reduce((s,t) => s+t.payment, 0);
  const directExp = tx.reduce((s,t) => s+t.expense, 0);
  const commonExp = com.reduce((s,c) => s+c.amount, 0);
  const net       = revenue - directExp - commonExp;
  const clients   = new Set(tx.map(t=>t.client.toLowerCase())).size;

  function upd(id, val, pre='₹') {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    animCount(el, val, pre, 700);
  }
  upd('totalRevenue',  revenue);
  upd('totalExpenses', directExp);
  upd('totalCommon',   commonExp);
  upd('netProfit',     net);
  upd('totalClients',  clients, '');

  // Colour net profit
  const npEl = document.getElementById('netProfit');
  if (npEl) npEl.style.color = net < 0 ? 'var(--col-loss)' : net > 0 ? 'var(--col-profit)' : '';

  // Common expenses log total badge
  setText('commonExpTotal', `${inr(commonExp)} total`);
}


/* ─────────────────────────────────────────────
   7. PERIOD SUMMARY CARDS (responds to filters)
───────────────────────────────────────────── */
function renderPeriodCards() {
  const range = getPeriodRange();
  const tx    = DataStore.getAll();
  const com   = DataStore.getCommon().filter(c => inRange(c.month+'-01', range));
  const stats = calcStats(tx, com, State.clientFilter, range);

  const pRev = document.getElementById('pRevenue');
  const pDir = document.getElementById('pDirectExp');
  const pCom = document.getElementById('pCommonExp');
  const pNet = document.getElementById('pNetProfit');

  if (pRev) animCount(pRev, stats.revenue);
  if (pDir) animCount(pDir, stats.directExp);
  if (pCom) animCount(pCom, stats.commonShare);
  if (pNet) {
    animCount(pNet, stats.netProfit);
    pNet.style.color = stats.netProfit < 0 ? 'var(--col-loss)' : stats.netProfit > 0 ? 'var(--col-profit)' : '';
  }

  const lbl = periodLabel();
  const who = State.clientFilter === 'all' ? 'All clients' : State.clientFilter;
  setText('pRevenueLabel',  `${who} · ${lbl}`);
  setText('pDirectLabel',   `Direct expenses · ${lbl}`);
  setText('pCommonLabel',   State.clientFilter === 'all' ? `All common costs · ${lbl}` : `Proportional share · ${lbl}`);
  setText('pProfitLabel',   `Revenue - Direct - Common · ${lbl}`);
  setText('clientTablePeriodTag', lbl);
}


/* ─────────────────────────────────────────────
   8. ADD PAYMENT FORM
───────────────────────────────────────────── */
function initClientForm() {
  document.getElementById('addPaymentBtn')?.addEventListener('click', () => {
    const client  = document.getElementById('clientName').value.trim();
    const project = document.getElementById('projectName').value.trim();
    const payment = parseFloat(document.getElementById('paymentAmount').value);
    const expenseRaw = document.getElementById('expenseAmount').value;
    const expense = expenseRaw === '' ? 0 : parseFloat(expenseRaw);
    const expenseCategory = document.getElementById('expenseCategory').value;

    if (!client)              { toast('clientToast','Enter client name.','error'); return; }
    if (!project)             { toast('clientToast','Enter project name.','error'); return; }
    if (isNaN(payment)||payment<0) { toast('clientToast','Enter valid payment.','error'); return; }
    if (isNaN(expense)||expense<0) { toast('clientToast','Direct expense can\'t be negative.','error'); return; }

    DataStore.addTx({ client, project, payment, expense, expenseCategory });

    document.getElementById('clientName').value    = '';
    document.getElementById('projectName').value   = '';
    document.getElementById('paymentAmount').value = '';
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseCategory').value = 'Other';

    const p = payment - expense;
    toast('clientToast', p>=0 ? `✓ Added! Direct profit so far: ${inr(p)}` : `✓ Added! Direct loss so far: ${inr(Math.abs(p))}`, p>=0?'success':'error');
    renderAll();
  });
}


/* ─────────────────────────────────────────────
   9. COMMON EXPENSE FORM
───────────────────────────────────────────── */
function initCommonForm() {
  // Default month to current
  const mi = document.getElementById('commonMonth');
  if (mi) mi.value = isoToday().slice(0,7);

  document.getElementById('addCommonBtn')?.addEventListener('click', () => {
    const name     = document.getElementById('commonName').value.trim();
    const category = document.getElementById('commonCategory').value;
    const amount   = parseFloat(document.getElementById('commonAmount').value);
    const month    = document.getElementById('commonMonth').value;

    if (!name)               { toast('commonToast','Enter expense name.','error'); return; }
    if (isNaN(amount)||amount<=0) { toast('commonToast','Enter valid amount.','error'); return; }
    if (!month)              { toast('commonToast','Select a month.','error'); return; }

    DataStore.addCommon({ name, category, amount, month });

    document.getElementById('commonName').value   = '';
    document.getElementById('commonAmount').value = '';

    toast('commonToast', `✓ ${name} added — ${inr(amount)}`, 'success');
    renderAll();
  });
}


/* ─────────────────────────────────────────────
   10. POPULATE CLIENT FILTER DROPDOWN
───────────────────────────────────────────── */
function renderClientFilterDropdown() {
  const sel = document.getElementById('clientFilter');
  if (!sel) return;

  const clients = [...new Set(DataStore.getAll().map(t => t.client.toLowerCase()))]
    .sort()
    .map(k => DataStore.getAll().find(t => t.client.toLowerCase()===k).client);

  // Rebuild only if changed
  const existing = [...sel.options].map(o=>o.value).filter(v=>v!=='all');
  const same = existing.join(',') === clients.map(c=>c.toLowerCase()).join(',');
  if (same) return;

  sel.innerHTML = '<option value="all">All Clients (Overall)</option>';
  clients.forEach(c => {
    const o = document.createElement('option');
    o.value = c.toLowerCase();
    o.textContent = c;
    sel.appendChild(o);
  });
  sel.value = State.clientFilter;
}


/* ─────────────────────────────────────────────
   11. TRANSACTION TABLE
───────────────────────────────────────────── */
function renderTable() {
  const tbody  = document.getElementById('transactionBody');
  const empty  = document.getElementById('tableEmpty');
  if (!tbody) return;

  const range  = getPeriodRange();
  const com    = DataStore.getCommon().filter(c => inRange(c.month+'-01', range));
  const allTx  = DataStore.getAll().filter(t => inRange(t.date, range));

  // Common per client for this period
  const activeClients  = new Set(allTx.map(t=>t.client.toLowerCase())).size || 1;
  const totalCommonAmt = com.reduce((s,c)=>s+c.amount, 0);
  const sharePerClient = totalCommonAmt / activeClients;

  // Apply client filter
  let txList = State.clientFilter === 'all'
    ? allTx
    : allTx.filter(t => t.client.toLowerCase() === State.clientFilter);

  // Search
  if (State.search) {
    const q = State.search.toLowerCase();
    txList = txList.filter(t => t.client.toLowerCase().includes(q) || t.project.toLowerCase().includes(q));
  }

  // P/L filter (based on net = payment - expense - share)
  txList = txList.map(t => ({
    ...t,
    commonShare: sharePerClient,
    netPL: t.payment - t.expense - sharePerClient,
  }));

  if (State.tableFilter === 'profit') txList = txList.filter(t => t.netPL >= 0);
  if (State.tableFilter === 'loss')   txList = txList.filter(t => t.netPL < 0);

  // Sort
  if (State.sortByProfit) txList = [...txList].sort((a,b) => b.netPL - a.netPL);
  else txList = [...txList].sort((a,b) => b.createdAt - a.createdAt);

  const allData = DataStore.getAll();
  if (allData.length === 0) {
    empty?.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }
  empty?.classList.add('hidden');

  if (txList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--col-text-muted);padding:2rem">No records match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = txList.map((t, i) => {
    const isPL    = t.netPL >= 0;
    const plPill  = isPL
      ? `<span class="pl-pill pl-profit">▲ ${inr(t.netPL)} Profit</span>`
      : `<span class="pl-pill pl-loss">▼ ${inr(Math.abs(t.netPL))} Loss</span>`;
    const status  = isPL
      ? `<span class="status-badge status-active">Active</span>`
      : `<span class="status-badge status-warning">Warning</span>`;

    return `<tr class="new-row">
      <td>${i+1}</td>
      <td><span class="client-name-cell"><span class="client-badge">${initial(t.client)}</span>${t.client}</span></td>
      <td>${t.project}</td>
      <td class="amount-cell">${inr(t.payment)}</td>
      <td class="amount-cell">${inr(t.expense)}</td>
      <td>
        <div class="expense-type-cell">
          ${expenseSummaryTag(t)}
          <button class="btn-add-expense" onclick="openExpenseModal('${t.id}')" title="Add or manage expenses for this client payment">+ Expense</button>
        </div>
      </td>
      <td class="common-share-cell">-${inr(t.commonShare)}</td>
      <td>${plPill}</td>
      <td>${fmtDate(t.date)}</td>
      <td>${status}</td>
      <td><button class="btn-delete" onclick="deleteTx('${t.id}')" title="Delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path>
          <path d="M10 11v6M14 11v6"></path></svg>
      </button></td>
    </tr>`;
  }).join('');
}

function deleteTx(id) {
  if (!confirm('Delete this transaction?')) return;
  DataStore.removeTx(id);
  renderAll();
}


/* ─────────────────────────────────────────────
   11b. EXPENSE MANAGER MODAL
   Lets you add direct expenses to an existing
   client payment any time later — weeks or
   months after the original payment was logged.
───────────────────────────────────────────── */
let activeExpenseTxId = null;

function openExpenseModal(txId) {
  activeExpenseTxId = txId;
  const overlay = document.getElementById('expenseModalOverlay');
  if (!overlay) return;

  const dateInput = document.getElementById('newExpenseDate');
  if (dateInput) dateInput.value = isoToday();
  const amtInput = document.getElementById('newExpenseAmount');
  if (amtInput) amtInput.value = '';
  const catInput = document.getElementById('newExpenseCategory');
  if (catInput) catInput.value = 'Other';
  setText('expenseModalToast', '');

  renderExpenseModalList();
  overlay.classList.add('open');
}

function closeExpenseModal() {
  activeExpenseTxId = null;
  document.getElementById('expenseModalOverlay')?.classList.remove('open');
}

function renderExpenseModalList() {
  const tx = DataStore.getAll().find(t => t.id === activeExpenseTxId);
  const listEl  = document.getElementById('expenseModalList');
  const emptyEl = document.getElementById('expenseModalEmpty');
  if (!tx || !listEl) { closeExpenseModal(); return; }

  setText('expenseModalTitle', `Expenses — ${tx.client}`);
  setText('expenseModalSub', tx.project);

  const entries = [...(tx.expenses||[])].sort((a,b) => (b.date||'').localeCompare(a.date||''));

  if (entries.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
  } else {
    emptyEl.classList.add('hidden');
    listEl.innerHTML = entries.map(e => `
      <div class="expense-entry-row">
        <div class="expense-entry-info">
          <span class="expense-entry-amount">${inr(e.amount)}</span>
          <span class="expense-entry-meta">${expenseCategoryLabel(e.category)} · ${fmtDate(e.date)}</span>
        </div>
        <button class="expense-entry-delete" onclick="deleteExpenseEntry('${e.id}')" title="Remove this expense">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path>
          </svg>
        </button>
      </div>`).join('');
  }

  const total = entries.reduce((s,e) => s + (+e.amount||0), 0);
  setText('expenseModalTotal', `Total: ${inr(total)}`);
}

function deleteExpenseEntry(expenseId) {
  if (!activeExpenseTxId) return;
  if (!confirm('Remove this expense entry?')) return;
  DataStore.removeExpenseFromTx(activeExpenseTxId, expenseId);
  renderExpenseModalList();
  renderAll();
}

function initExpenseModal() {
  document.getElementById('expenseModalClose')?.addEventListener('click', closeExpenseModal);

  // Click outside the card (on the dark backdrop) to close
  document.getElementById('expenseModalOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'expenseModalOverlay') closeExpenseModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeExpenseModal();
  });

  document.getElementById('addExpenseEntryBtn')?.addEventListener('click', () => {
    if (!activeExpenseTxId) return;
    const amount   = parseFloat(document.getElementById('newExpenseAmount').value);
    const category = document.getElementById('newExpenseCategory').value;
    const date     = document.getElementById('newExpenseDate').value || isoToday();

    if (isNaN(amount) || amount <= 0) {
      toast('expenseModalToast', 'Enter a valid amount.', 'error');
      return;
    }

    DataStore.addExpenseToTx(activeExpenseTxId, { amount, category, date });

    document.getElementById('newExpenseAmount').value = '';
    document.getElementById('newExpenseCategory').value = 'Other';
    document.getElementById('newExpenseDate').value = isoToday();

    toast('expenseModalToast', `✓ Added ${inr(amount)} expense.`, 'success');
    renderExpenseModalList();
    renderAll();
  });
}


/* ─────────────────────────────────────────────
   12. COMMON EXPENSES TABLE
───────────────────────────────────────────── */
function renderCommonTable() {
  const tbody = document.getElementById('commonBody');
  const empty = document.getElementById('commonEmpty');
  if (!tbody) return;

  const list = DataStore.getCommon().sort((a,b) => b.createdAt - a.createdAt);

  if (list.length === 0) {
    empty?.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }
  empty?.classList.add('hidden');

  tbody.innerHTML = list.map((c,i) => `
    <tr class="new-row">
      <td>${i+1}</td>
      <td style="font-weight:600;color:var(--col-text-primary)">${c.name}</td>
      <td><span class="status-badge" style="background:rgba(139,92,246,0.1);color:var(--col-common)">${c.category}</span></td>
      <td class="amount-cell">${inr(c.amount)}</td>
      <td>${monthLabel(c.month)}</td>
      <td><button class="btn-delete" onclick="deleteCommon('${c.id}')" title="Delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path>
          <path d="M10 11v6M14 11v6"></path></svg>
      </button></td>
    </tr>`).join('');

  setText('commonExpTotal', `${inr(list.reduce((s,c)=>s+c.amount,0))} total`);
}

function deleteCommon(id) {
  if (!confirm('Delete this common expense?')) return;
  DataStore.removeCommon(id);
  renderAll();
}


/* ─────────────────────────────────────────────
   13. CHART — Line graph (period + client aware)
───────────────────────────────────────────── */
let chartInst = null;

function renderChart() {
  const canvas = document.getElementById('financialChart');
  const empty  = document.getElementById('chartEmpty');
  if (!canvas) return;

  // Chart.js loads from a CDN. If it's blocked (slow network, an ad-blocker,
  // a firewall, etc.) `Chart` will be undefined and `new Chart(...)` below
  // would throw — which previously broke the rest of renderAll() (including
  // the month-picker's own re-render) on every click. Bail out safely instead.
  if (typeof Chart === 'undefined') {
    console.warn('[FinanceFlow] Chart.js failed to load — skipping chart render.');
    empty?.classList.remove('hidden');
    return;
  }

  const range  = getPeriodRange();
  const allTxFull = DataStore.getAll();                                   // unfiltered — needed to find expense entries dated in range even if the parent payment isn't
  const allTx  = allTxFull.filter(t => inRange(t.date, range));            // payments that landed in this period
  const allExp = allTxFull.flatMap(t => (t.expenses||[]).filter(e => inRange(e.date, range)).map(e => ({...e, client: t.client}))); // expense entries logged in this period
  const allCom = DataStore.getCommon().filter(c => inRange(c.month+'-01', range));

  if (allTx.length === 0 && allExp.length === 0) {
    empty?.classList.remove('hidden');
    if (chartInst) { chartInst.destroy(); chartInst = null; }
    return;
  }
  empty?.classList.add('hidden');

  // Build per-month buckets
  const monthSet = new Set([
    ...allTx.map(t => bucket(t.date)),
    ...allExp.map(e => bucket(e.date)),
    ...allCom.map(c => c.month),
  ]);
  const months = [...monthSet].sort();

  const activeClients = new Set([
    ...allTx.map(t=>t.client.toLowerCase()),
    ...allExp.map(e=>e.client.toLowerCase()),
  ]).size || 1;

  const revData    = [];
  const dirExpData = [];
  const comExpData = [];
  const netData    = [];

  months.forEach(mo => {
    const moTx  = allTx.filter(t => bucket(t.date) === mo);
    const moExp = allExp.filter(e => bucket(e.date) === mo);
    const moCom = allCom.filter(c => c.month === mo);

    // Apply client filter
    const filtTx  = State.clientFilter === 'all' ? moTx  : moTx.filter(t => t.client.toLowerCase() === State.clientFilter);
    const filtExp = State.clientFilter === 'all' ? moExp : moExp.filter(e => e.client.toLowerCase() === State.clientFilter);

    const rev    = filtTx.reduce((s,t)=>s+t.payment, 0);
    const dirExp = filtExp.reduce((s,e)=>s+(+e.amount||0), 0);
    const moComTotal = moCom.reduce((s,c)=>s+c.amount, 0);
    const comShare   = State.clientFilter === 'all'
      ? moComTotal
      : moComTotal / activeClients;

    revData.push(rev);
    dirExpData.push(dirExp);
    comExpData.push(Math.round(comShare));
    netData.push(Math.round(rev - dirExp - comShare));
  });

  const labels = months.map(m => monthLabel(m));

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Revenue',
          data: revData,
          borderColor: '#6366F1',
          backgroundColor: 'rgba(99,102,241,0.08)',
          tension: 0.4, fill: true, spanGaps: true,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#6366F1',
          pointBorderWidth: 2.5,
          pointRadius: 6, pointHoverRadius: 9,
          borderWidth: 3,
        },
        {
          label: 'Direct Expense',
          data: dirExpData,
          borderColor: '#F59E0B',
          backgroundColor: 'rgba(245,158,11,0.06)',
          tension: 0.4, fill: true, spanGaps: true,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#F59E0B',
          pointBorderWidth: 2.5,
          pointRadius: 6, pointHoverRadius: 9,
          borderWidth: 2.5,
        },
        {
          label: 'Common Expense',
          data: comExpData,
          borderColor: '#8B5CF6',
          backgroundColor: 'rgba(139,92,246,0.05)',
          tension: 0.4, fill: true, spanGaps: true,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#8B5CF6',
          pointBorderWidth: 2,
          pointRadius: 5, pointHoverRadius: 8,
          borderWidth: 2,
          borderDash: [6, 3],
        },
        {
          label: 'Net Profit',
          data: netData,
          borderColor: '#10B981',
          backgroundColor: 'rgba(16,185,129,0.08)',
          tension: 0.4, fill: true, spanGaps: true,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#10B981',
          pointBorderWidth: 2.5,
          pointRadius: 6, pointHoverRadius: 9,
          borderWidth: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 600, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: false }, // using custom HTML legend
        tooltip: {
          backgroundColor: '#0F172A',
          titleColor: '#F1F5F9',
          bodyColor: '#94A3B8',
          padding: 14,
          cornerRadius: 10,
          displayColors: true,
          boxWidth: 10, boxHeight: 10,
          callbacks: {
            title: items => items[0].label,
            label: ctx => {
              const val = ctx.parsed.y;
              const sign = val < 0 ? '-' : '';
              return `  ${ctx.dataset.label}: ${sign}₹${Math.abs(val).toLocaleString('en-IN')}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: '#94A3B8',
            font: { size: 12, family: 'Inter', weight: '500' },
            padding: 8,
          },
        },
        y: {
          grid: { color: '#F1F5F9', drawBorder: false },
          border: { display: false, dash: [4, 4] },
          ticks: {
            color: '#94A3B8',
            font: { size: 11, family: 'Inter' },
            padding: 10,
            callback: v => {
              if (Math.abs(v) >= 100000) return '₹' + (v/100000).toFixed(1) + 'L';
              if (Math.abs(v) >= 1000)   return '₹' + (v/1000).toFixed(0) + 'k';
              return '₹' + v;
            },
          },
          beginAtZero: true,
        },
      },
    },
  };

  if (chartInst) { chartInst.destroy(); chartInst = null; }
  try {
    chartInst = new Chart(canvas, cfg);
  } catch (err) {
    console.error('[FinanceFlow] Failed to render chart:', err);
  }
}


/* ─────────────────────────────────────────────
   14a. MONTH PICKER
───────────────────────────────────────────── */
function initMonthPicker() {
  const popup    = document.getElementById('monthPickerPopup');
  const btn      = document.getElementById('pickMonthBtn');
  const yearEl   = document.getElementById('mpYear');
  const grid     = document.getElementById('mpGrid');
  const labelEl  = document.getElementById('pickMonthLabel');
  const prevBtn  = document.getElementById('mpPrevYear');
  const nextBtn  = document.getElementById('mpNextYear');

  if (!popup || !btn) return;

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec'];

  // Picker's internal year (navigation state)
  let pickerYear = new Date().getFullYear();

  // Which months have actual data
  function getDataMonths() {
    const all = DataStore.getAll();
    const tx  = all.map(t => t.date.slice(0,7));
    const exp = all.flatMap(t => (t.expenses||[]).map(e => e.date.slice(0,7)));
    const com = DataStore.getCommon().map(c => c.month);
    return new Set([...tx, ...exp, ...com]);
  }

  // Render the 12 month buttons for pickerYear
  function renderGrid() {
    yearEl.textContent = pickerYear;
    const now       = new Date();
    const curYM     = isoToday().slice(0,7);          // today's YYYY-MM
    const dataSet   = getDataMonths();

    grid.innerHTML = MONTHS.map((mo, i) => {
      const ym    = `${pickerYear}-${String(i+1).padStart(2,'0')}`;
      const isCur = ym === curYM;
      const isSel = ym === State.customMonth && State.period === 'custom';
      const hasDa = dataSet.has(ym);
      let cls = 'mp-month-btn';
      if (isCur) cls += ' current-month';
      if (isSel) cls += ' selected';
      if (hasDa) cls += ' has-data';
      return `<button class="${cls}" data-ym="${ym}">${mo}</button>`;
    }).join('');

    // Click a month button
    grid.querySelectorAll('.mp-month-btn').forEach(b => {
      b.addEventListener('click', () => {
        const ym = b.dataset.ym;
        State.period      = 'custom';
        State.customMonth = ym;

        // Update the Pick Month button label
        const [y,m] = ym.split('-');
        labelEl.textContent = `${MONTHS[+m-1]} ${y}`;

        // Mark all period-btn inactive, then activate pick-month-btn
        document.querySelectorAll('.period-btn').forEach(pb => pb.classList.remove('active'));
        btn.classList.add('active');

        closePopup();
        renderAll();
        renderGrid(); // refresh selection highlight
      });
    });
  }

  function openPopup() {
    // Sync picker year to current custom selection or today
    if (State.customMonth) {
      pickerYear = parseInt(State.customMonth.split('-')[0]);
    } else {
      pickerYear = new Date().getFullYear();
    }
    renderGrid();
    popup.classList.add('open');
  }

  function closePopup() {
    popup.classList.remove('open');
  }

  // Toggle popup on button click
  btn.addEventListener('click', e => {
    e.stopPropagation();
    popup.classList.contains('open') ? closePopup() : openPopup();
  });

  // Year navigation
  prevBtn?.addEventListener('click', e => {
    e.stopPropagation();
    pickerYear--;
    renderGrid();
  });
  nextBtn?.addEventListener('click', e => {
    e.stopPropagation();
    pickerYear++;
    renderGrid();
  });

  // Close when clicking outside
  document.addEventListener('click', e => {
    if (!popup.contains(e.target) && e.target !== btn) {
      closePopup();
    }
  });

  // Expose re-render so renderAll can refresh data dots
  window._refreshMonthPicker = renderGrid;
}


/* ─────────────────────────────────────────────
   14. FILTER CONTROLS INIT
───────────────────────────────────────────── */
function initFilters() {
  // Period buttons (excluding the custom pick-month button which has its own handler)
  document.querySelectorAll('.period-btn:not(#pickMonthBtn)').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      State.period = btn.dataset.period;
      // Reset custom month label when switching away
      const lbl = document.getElementById('pickMonthLabel');
      if (lbl) lbl.textContent = 'Pick Month';
      renderAll();
    });
  });

  // Client dropdown
  document.getElementById('clientFilter')?.addEventListener('change', e => {
    State.clientFilter = e.target.value;
    renderAll();
  });

  // Table search
  document.getElementById('searchInput')?.addEventListener('input', e => {
    State.search = e.target.value;
    renderTable();
  });

  // Table filter tabs
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      State.tableFilter = btn.dataset.filter;
      renderTable();
    });
  });

  // Sort
  document.getElementById('sortBtn')?.addEventListener('click', function() {
    State.sortByProfit = !State.sortByProfit;
    this.classList.toggle('active', State.sortByProfit);
    renderTable();
  });
}


/* ─────────────────────────────────────────────
   15. NAVIGATION
───────────────────────────────────────────── */
function initNavigation() {
  const pages = {
    finance:   { title:'Finance Dashboard',   sub:'Revenue, expenses & profit' },
    dashboard: { title:'Overview Dashboard',  sub:'Business at a glance' },
    clients:   { title:'Client Management',   sub:'Manage client relationships' },
    reports:   { title:'Reports & Export',    sub:'Generate financial reports' },
    settings:  { title:'Settings',            sub:'Configure your workspace' },
  };

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const page = item.dataset.page;
      document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
      document.getElementById('page-'+page)?.classList.add('active');
      const info = pages[page]||{};
      setText('pageTitle',    info.title||'');
      setText('pageSubtitle', info.sub||'');
      closeSidebar();
    });
  });

  // Mobile menu
  const sidebar = document.getElementById('sidebar');
  let overlay   = document.querySelector('.sidebar-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.className='sidebar-overlay'; document.body.appendChild(overlay); }
  document.getElementById('menuToggle')?.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : (sidebar.classList.add('open'), overlay.classList.add('show'));
  });
  overlay.addEventListener('click', closeSidebar);
  function closeSidebar() { sidebar?.classList.remove('open'); overlay?.classList.remove('show'); }
}

function initClearBtn() {
  document.getElementById('clearBtn')?.addEventListener('click', () => {
    if (!confirm('Delete ALL transactions and common expenses? This cannot be undone.')) return;
    DataStore.clearAll();
    State.period='all'; State.customMonth=''; State.clientFilter='all'; State.tableFilter='all';
    State.sortByProfit=false; State.search='';
    document.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active'));
    document.querySelector('.period-btn[data-period="all"]')?.classList.add('active');
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
    document.querySelector('.filter-btn[data-filter="all"]')?.classList.add('active');
    const si=document.getElementById('searchInput'); if(si) si.value='';
    renderAll();
  });
}

function renderDate() {
  const el=document.getElementById('currentDate');
  if(el) el.textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',year:'numeric',month:'short',day:'numeric'});
}


/* ─────────────────────────────────────────────
   MASTER RENDER
───────────────────────────────────────────── */
function renderAll() {
  renderClientFilterDropdown();
  renderSummaryCards();
  renderPeriodCards();
  renderTable();
  renderCommonTable();
  renderChart();
  // Refresh data-dots on month picker if open
  if (typeof window._refreshMonthPicker === 'function') {
    window._refreshMonthPicker();
  }
}


/* ─────────────────────────────────────────────
   16. BOOT
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  renderDate();
  initNavigation();
  initClientForm();
  initCommonForm();
  initExpenseModal();
  initMonthPicker();   // calendar month picker
  initFilters();
  initClearBtn();

  // Seed demo data on first visit
  if (DataStore.getAll().length === 0 && DataStore.getCommon().length === 0) {
    seedDemo();
  }

  renderAll();
  console.log('[FinanceFlow v2] Ready.');
});


/* ─────────────────────────────────────────────
   DEMO DATA SEEDER
   Remove seedDemo() call above when going live.
───────────────────────────────────────────── */
function seedDemo() {
  const now = new Date();
  // mo(n) = date n months ago (mid-month so it reads cleanly)
  const mo  = (n, day=15) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - n);
    d.setDate(day);
    return d.toISOString().slice(0,10);
  };
  const ym = n => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - n);
    return d.toISOString().slice(0,7);
  };

  /*  6 months of client payments across 6 clients
      so the chart shows clear multi-month trend lines  */
  const payments = [
    // Current month
    {client:'ABC Technologies',  project:'Website Redesign',      payment:95000,  expense:42000, date:mo(0,5)},
    {client:'Patel Enterprises', project:'Brand Identity',         payment:120000, expense:55000, date:mo(0,12)},
    {client:'XYZ Marketing',     project:'Social Media Q2',        payment:60000,  expense:72000, date:mo(0,18)},

    // 1 month ago
    {client:'Green Leaf Foods',  project:'E-Commerce Platform',    payment:200000, expense:130000,date:mo(1,8)},
    {client:'ABC Technologies',  project:'SEO & Analytics',        payment:55000,  expense:22000, date:mo(1,14)},
    {client:'Nova Startups',     project:'Mobile App MVP',         payment:180000, expense:195000,date:mo(1,20)},

    // 2 months ago
    {client:'Bright Solar',      project:'Digital Marketing',      payment:75000,  expense:32000, date:mo(2,6)},
    {client:'XYZ Marketing',     project:'Content Strategy',       payment:45000,  expense:28000, date:mo(2,16)},
    {client:'Mehta & Sons',      project:'Cloud Migration',        payment:160000, expense:98000, date:mo(2,22)},

    // 3 months ago
    {client:'Patel Enterprises', project:'Annual Audit Support',   payment:90000,  expense:41000, date:mo(3,9)},
    {client:'Mehta & Sons',      project:'ERP Integration',        payment:250000, expense:180000,date:mo(3,17)},
    {client:'ClearView Optics',  project:'Product Photography',    payment:35000,  expense:52000, date:mo(3,24)},

    // 4 months ago
    {client:'Bright Solar',      project:'Website Maintenance',    payment:30000,  expense:12000, date:mo(4,7)},
    {client:'ABC Technologies',  project:'UI/UX Overhaul',         payment:85000,  expense:38000, date:mo(4,15)},
    {client:'Green Leaf Foods',  project:'Inventory System',       payment:110000, expense:75000, date:mo(4,21)},

    // 5 months ago
    {client:'Nova Startups',     project:'Landing Page Design',    payment:40000,  expense:18000, date:mo(5,10)},
    {client:'ClearView Optics',  project:'Brand Refresh',          payment:65000,  expense:44000, date:mo(5,16)},
    {client:'XYZ Marketing',     project:'Email Campaign',         payment:32000,  expense:20000, date:mo(5,22)},
  ];
  payments.forEach(t => DataStore.addTx(t));

  /*  Common expenses every month for 6 months
      so they show up consistently on the chart  */
  const common = [
    // Current month
    {name:'Electricity Bill',      category:'Utilities',     amount:8500,  month:ym(0)},
    {name:'Adobe Creative Cloud',  category:'Subscriptions', amount:4200,  month:ym(0)},
    {name:'Office Rent',           category:'Rent',          amount:25000, month:ym(0)},
    // 1 month ago
    {name:'Electricity Bill',      category:'Utilities',     amount:7800,  month:ym(1)},
    {name:'Zoom & Slack',          category:'Subscriptions', amount:3100,  month:ym(1)},
    {name:'Office Rent',           category:'Rent',          amount:25000, month:ym(1)},
    // 2 months ago
    {name:'Internet + Electricity',category:'Utilities',     amount:9200,  month:ym(2)},
    {name:'AWS Hosting',           category:'Subscriptions', amount:6400,  month:ym(2)},
    {name:'Office Rent',           category:'Rent',          amount:25000, month:ym(2)},
    // 3 months ago
    {name:'Electricity Bill',      category:'Utilities',     amount:8100,  month:ym(3)},
    {name:'Adobe + Figma',         category:'Subscriptions', amount:5500,  month:ym(3)},
    {name:'Office Rent',           category:'Rent',          amount:25000, month:ym(3)},
    // 4 months ago
    {name:'Electricity Bill',      category:'Utilities',     amount:9400,  month:ym(4)},
    {name:'Office Rent',           category:'Rent',          amount:25000, month:ym(4)},
    {name:'Google Workspace',      category:'Subscriptions', amount:2800,  month:ym(4)},
    // 5 months ago
    {name:'Electricity Bill',      category:'Utilities',     amount:7600,  month:ym(5)},
    {name:'Office Rent',           category:'Rent',          amount:25000, month:ym(5)},
    {name:'Slack + Notion',        category:'Subscriptions', amount:3300,  month:ym(5)},
  ];
  common.forEach(c => DataStore.addCommon(c));
}
