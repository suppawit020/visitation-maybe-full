// ═══════════════════════════════════════════
//  CONFIG & STATE
// ═══════════════════════════════════════════
const TEAM_CONFIG = {
  'Admin': ['Admin'],
  'Horeca': ['BKK', 'EAST'],
  'On Premise': ['BKK', 'EAST', 'North+Northeast'],
  'Southern': ['Phuket-HRC', 'Phuket-OP', 'Samui-HRC', 'Samui-OP']
};
const ADMIN_PW = '123456';
const S_KEY = 'erp_admin_session';
const R_KEY = 'erp_admin_remember';
let SUPA_URL = '', SUPA_KEY = '';

// ============================================================
// CRYPTO UTILITIES
// ============================================================
async function sha256(text) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
let allVisits = [], allRequests = [], allCustomers = [], allUsers = [];
let allContracts = [], allOrders = [], allProducts = [], allPrices = [];
let allVisitation = [], allActivity = [];
let visFilter = 'active', reqFilter = 'all', conFilter = 'all';
let visPage = 0; const VIS_PER_PAGE = 20; let visTotalCount = 0;
let ordPage = 0; const ORD_PER_PAGE = 20; let ordTotalCount = 0;
let custPage = 0; const CUST_PER_PAGE = 20; let custTotalCount = 0;
let usrPage = 0; const USR_PER_PAGE = 20; let usrTotalCount = 0;
let selectedVisits = new Set();
let pendingAction = null;
let editingUserId = null, editingCustomerId = null, editingContractId = null;
let editingProductId = null, editingPriceId = null;
let areaChart = null, posChart = null;
let bdeCustomerCounts = {};

window.loadBdeCounts = async function () {
  try {
    const res = await supa('customer_information?select=bde&limit=10000');
    bdeCustomerCounts = {};
    if (res.data) {
      res.data.forEach(c => {
        if (c.bde) bdeCustomerCounts[c.bde] = (bdeCustomerCounts[c.bde] || 0) + 1;
      });
    }
  } catch (e) { console.warn('Failed to load BDE counts', e); }
};

window.ensureUsersLoaded = async function () {
  if (allUsers.length === 0) {
    try {
      const uRes = await supa('user_information?select=user_id,name,team,sub_team,level');
      allUsers = uRes.data || [];
    } catch (e) { console.warn('Failed to load users for dropdown', e); }
  }
};

// ─── THEME ───
function initTheme() {
  const saved = localStorage.getItem('erp_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) applyTheme('dark');
  else applyTheme('light');
}
function applyTheme(t) {
  document.body.classList.toggle('dark', t === 'dark');
  const sunPath = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  const moonPath = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  const icon = t === 'dark' ? sunPath : moonPath;
  document.querySelectorAll('#theme-icon-login, #theme-icon-app').forEach(el => el.innerHTML = icon);
}
window.toggleTheme = function () {
  const isDark = document.body.classList.contains('dark');
  const next = isDark ? 'light' : 'dark';
  localStorage.setItem('erp_theme', next);
  applyTheme(next);
  if (areaChart || posChart) setTimeout(renderDashboard, 50);
};

// ─── SIDEBAR (mobile) ───
window.toggleSidebar = function () {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-backdrop').classList.toggle('open');
};

// ─── SUPABASE CLIENT ───
async function supa(path, opts = {}) {
  const res = await fetch(SUPA_URL + '/rest/v1/' + path, {
    ...opts, cache: 'no-store',
    headers: {
      'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || 'return=representation',
      ...opts.headers
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${text.substring(0, 150)}`);
  return { data: text ? JSON.parse(text) : null, headers: res.headers };
}

// ─── UTILS & HELPERS ───
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } }
function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
function fmtCurr(n) { return n == null ? '—' : '฿' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0 }); }
function initials(s) { return (s || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
function daysFromNow(d) { if (!d) return null; return Math.ceil((new Date(d) - new Date()) / 86400000); }
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  let iconHtml = '';
  if (type === 'success') {
    iconHtml = '<polyline points="20 6 9 17 4 12"/>';
  } else if (type === 'error') {
    iconHtml = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';
  } else {
    iconHtml = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
  }
  el.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${iconHtml}</svg> ${esc(msg)}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}
function escapeCSV(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}
function formatInClause(ids) {
  if (!ids.length) return '()';
  return `('${ids.map(id => String(id).replace(/'/g, "''")).join("','")}')`;
}

// ─── DROPDOWN LOGIC ───
window.updateSubTeamDropdown = function (mainTeam, selectedSub = '') {
  const subSelect = document.getElementById('um-sub-team');
  if (!subSelect) return;
  subSelect.innerHTML = '<option value="">-- Select Area --</option>';
  if (TEAM_CONFIG[mainTeam]) {
    TEAM_CONFIG[mainTeam].forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub;
      opt.textContent = sub;
      if (sub === selectedSub) opt.selected = true;
      subSelect.appendChild(opt);
    });
  }
};

window.onCustTeamFilterChange = function () {
  const team = document.getElementById('cust-team-filter').value;
  const areaSelect = document.getElementById('cust-area-filter');
  const bdeSelect = document.getElementById('cust-bde-filter');

  if (areaSelect) areaSelect.innerHTML = '<option value="">All Areas</option>';
  if (bdeSelect) bdeSelect.innerHTML = '<option value="">All BDE</option>';

  if (team && TEAM_CONFIG[team] && areaSelect) {
    TEAM_CONFIG[team].forEach(area => {
      const opt = document.createElement('option');
      opt.value = area;
      opt.textContent = area;
      areaSelect.appendChild(opt);
    });
  }

  if (typeof resetAndLoadCustomers === 'function') resetAndLoadCustomers();
};

window.onCustAreaFilterChange = async function () {
  await window.ensureUsersLoaded();
  const team = document.getElementById('cust-team-filter').value;
  const area = document.getElementById('cust-area-filter').value;
  const bdeSelect = document.getElementById('cust-bde-filter');

  if (bdeSelect) bdeSelect.innerHTML = '<option value="">All BDE</option>';

  if (team) {
    let filteredUsers = allUsers.filter(u => u.team === team);
    if (area) {
      filteredUsers = filteredUsers.filter(u => u.sub_team === area);
    }
    filteredUsers.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.name;
      opt.textContent = `${u.name} (${u.sub_team || '—'})`;
      if (bdeSelect) bdeSelect.appendChild(opt);
    });
  }
  if (typeof resetAndLoadCustomers === 'function') resetAndLoadCustomers();
};

window.updateBdeDropdown = async function (team, selectedBde = '') {
  await window.ensureUsersLoaded();
  const bdeSelect = document.getElementById('cm-bde');
  if (!bdeSelect) return;
  bdeSelect.innerHTML = '<option value="">-- Select BDE --</option>';
  if (team) {
    const teamUsers = allUsers.filter(u => u.team === team);
    teamUsers.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.name;
      opt.textContent = `${u.name} (${u.sub_team || u.level || 'No Area'})`;
      if (u.name === selectedBde) opt.selected = true;
      bdeSelect.appendChild(opt);
    });
  }
};

// ─── LOGIN ───
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  const raw = sessionStorage.getItem(S_KEY) || localStorage.getItem(R_KEY);
  if (raw) {
    try {
      const d = JSON.parse(raw);
      if (d?.url && d?.key) { SUPA_URL = d.url; SUPA_KEY = d.key; await bootApp(); return; }
    } catch (e) { console.warn('Invalid session:', e); }
  }
});

window.doLogin = async function () {
  const urlIn = document.getElementById('inp-url');
  const keyIn = document.getElementById('inp-key');
  const passIn = document.getElementById('inp-pass');
  const btn = document.querySelector('.btn-login');

  const url = urlIn.value.trim().replace(/\/+$/, '');
  const key = keyIn.value.trim();
  const pass = passIn.value;
  const rem = document.getElementById('inp-remember').checked;

  if (!url || !key || !pass) return toast('Please fill all fields', 'error');
  if (pass !== ADMIN_PW) return toast('Wrong password', 'error');

  btn.classList.add('loading');
  try {
    SUPA_URL = url.startsWith('http') ? url : 'https://' + url;
    SUPA_KEY = key;
    const payload = JSON.stringify({ url: SUPA_URL, key: SUPA_KEY });
    if (rem) { localStorage.setItem(R_KEY, payload); sessionStorage.removeItem(S_KEY); }
    else { sessionStorage.setItem(S_KEY, payload); localStorage.removeItem(R_KEY); }
    await bootApp();
  } catch (e) {
    toast('Connection failed: ' + e.message, 'error');
  } finally {
    btn.classList.remove('loading');
  }
};

window.doLogout = function () {
  teardownAdminRealtime();
  sessionStorage.removeItem(S_KEY); localStorage.removeItem(R_KEY); location.reload();
};

async function bootApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  showPage('dashboard');
  setupAdminRealtime();
}

// ─── PAGE NAV ───
let currentFieldTab = 'visits';
window.showPage = function (name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const nav = document.getElementById('nav-' + name);
  if (nav) nav.classList.add('active');
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');

  const loaders = {
    dashboard: loadDashboard,
    field: () => switchFieldTab(currentFieldTab),
    activity: loadActivity,
    customers: loadCustomers,
    contracts: loadContracts,
    offtake: loadOrders,
    products: loadProducts,
    price: loadPrices,
    users: loadUsers,
  };
  if (loaders[name]) loaders[name]();
};

window.switchFieldTab = function (tab) {
  currentFieldTab = tab;
  ['visits', 'visitation'].forEach(t => {
    const el = document.getElementById('field-tab-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('#page-field > .pill-group .pill').forEach(b => b.classList.remove('active'));
  const activePill = document.getElementById('ftab-' + tab);
  if (activePill) activePill.classList.add('active');
  const expBtn = document.getElementById('field-export-btn');
  if (expBtn) expBtn.style.display = tab === 'visits' ? '' : 'none';
  if (tab === 'visits') resetAndLoadVisits();
  else if (tab === 'visitation') loadVisitation();
};

// ─── CONFIRM MODAL ───
function showConfirm(title, body, okLabel, okClass, action) {
  pendingAction = action;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-body').innerHTML = body;
  const btn = document.getElementById('confirm-ok-btn');
  btn.textContent = okLabel;
  btn.className = 'btn ' + okClass;
  document.getElementById('confirm-overlay').classList.add('open');
}

window.closeConfirm = function () {
  document.getElementById('confirm-overlay').classList.remove('open');
  pendingAction = null;
};

window.doConfirm = async function () {
  const action = pendingAction; // 1. ดึงคำสั่ง (ลบ) มาเก็บไว้ในตัวแปรก่อน
  document.getElementById('confirm-overlay').classList.remove('open'); // 2. ปิดหน้าต่าง Popup
  pendingAction = null; // 3. เคลียร์ค่าที่ค้างอยู่

  if (action) {
    await action(); // 4. รันคำสั่งลบข้อมูล
  }
};

// ═══════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════
async function loadDashboard() {
  try {
    const [vRes, rRes, cRes, conRes, ordRes, uRes, actRes] = await Promise.allSettled([
      supa('visitation?select=id,name_of_outlet,customer_id,team,bde,date_visit,is_deleted,req_status,created_at&order=created_at.desc&limit=200'),
      supa('delete_requests?select=id,status&order=created_at.desc'),
      supa('customer_information?select=customer_id,outlet_name,status&limit=1', { prefer: 'count=exact' }),
      supa('contract?select=contract_id,customer_id,end_date,contract_type&order=end_date.asc&limit=100'),
      supa('orders?select=order_id&limit=1', { prefer: 'count=exact' }),
      supa('users?select=id,is_active'),
      supa('activity_log?select=log_id,customer_id,date_type,note,created_at,customers!activity_log_customer_id_fkey(outlet_name)&order=created_at.desc&limit=5'),
    ]);

    allVisits = vRes.status === 'fulfilled' ? (vRes.value.data || []) : [];
    allRequests = rRes.status === 'fulfilled' ? (rRes.value.data || []) : [];
    allContracts = conRes.status === 'fulfilled' ? (conRes.value.data || []) : [];
    allActivity = actRes.status === 'fulfilled' ? (actRes.value.data || []) : [];

    const custCount = cRes.status === 'fulfilled' ? parseInt(cRes.value.headers.get('content-range')?.split('/')[1] || '0') : 0;
    const ordCount = ordRes.status === 'fulfilled' ? parseInt(ordRes.value.headers.get('content-range')?.split('/')[1] || '0') : 0;
    const uData = uRes.status === 'fulfilled' ? (uRes.value.data || []) : [];
    const activeUsers = uData.filter(u => u.is_active).length;

    const active = allVisits.filter(v => !v.is_deleted && v.req_status !== 'pending');
    const pending = allRequests.filter(r => r.status === 'pending');
    const now = new Date(); const in30 = new Date(); in30.setDate(now.getDate() + 30);
    const expiringCons = allContracts.filter(c => c.end_date && new Date(c.end_date) <= in30 && new Date(c.end_date) >= now);

    if (pending.length > 0) {
      document.getElementById('notif-dot').style.display = 'block';
      const rb = document.getElementById('req-badge');
      if (rb) { rb.textContent = pending.length; rb.style.display = 'inline-block'; }
      const rp = document.getElementById('req-badge-pending');
      if (rp) { rp.textContent = pending.length; rp.style.display = 'inline'; }
    }

    document.getElementById('dash-stats').innerHTML = `
      <div class="stat-card"><div class="stat-label">Active Visits</div><div class="stat-value clr-green">${active.length}</div><div class="stat-foot">${new Set(active.map(v => v.team || '—')).size} teams covered</div></div>
      <div class="stat-card amber"><div class="stat-label">Pending Delete</div><div class="stat-value clr-amber">${pending.length}</div><div class="stat-foot">Awaiting review</div></div>
      <div class="stat-card red"><div class="stat-label">Total Customers</div><div class="stat-value clr-red">${custCount.toLocaleString()}</div><div class="stat-foot">In customer master</div></div>
      <div class="stat-card blue"><div class="stat-label">Expiring Contracts</div><div class="stat-value clr-blue">${expiringCons.length}</div><div class="stat-foot">Within 30 days</div></div>
      <div class="stat-card"><div class="stat-label">Total Orders</div><div class="stat-value">${ordCount.toLocaleString()}</div><div class="stat-foot">All off-take records</div></div>
      <div class="stat-card"><div class="stat-label">Active Users</div><div class="stat-value">${activeUsers}</div><div class="stat-foot">App login accounts</div></div>
    `;

    document.getElementById('dash-updated').textContent = `Updated at ${new Date().toLocaleTimeString('en-US')}`;
    renderDashboard();

    document.getElementById('dash-contracts-expiring').innerHTML = expiringCons.slice(0, 5).map(c => {
      const days = daysFromNow(c.end_date);
      return `<div class="recent-item"><div class="recent-avatar" style="background:var(--amber-dim);color:var(--amber);">${days}d</div><div class="recent-info"><div class="recent-name">${esc(c.contract_id)}</div><div class="recent-sub">Customer: ${esc(c.customer_id)} · ${esc(c.contract_type || '—')}</div></div><div class="recent-right"><div class="recent-date">${fmtDate(c.end_date)}</div></div></div>`;
    }).join('') || '<div class="empty-state" style="padding:1.5rem;"><p>No expiring contracts</p></div>';

    document.getElementById('dash-activity').innerHTML = allActivity.slice(0, 5).map(a => `
      <div class="activity-item"><div class="activity-dot"></div><div><div style="font-size:13px;"><strong>${esc(a.customer_information?.outlet_name || a.customer_id)}</strong> — ${esc(a.date_type || '—')}</div><div class="activity-meta">${esc(a.note || '—')} · ${fmtDate(a.created_at)}</div></div></div>
    `).join('') || '<div style="padding:1.5rem;text-align:center;color:var(--text-3);">No activity</div>';
  } catch (e) { toast('Dashboard load error: ' + e.message, 'error'); }
}
window.refreshDashboard = loadDashboard;

function renderDashboard() {
  const isDark = document.body.classList.contains('dark');
  const tc = isDark ? '#606058' : '#9A9A90';
  if (typeof Chart !== 'undefined') Chart.defaults.color = tc;
  const active = allVisits.filter(v => !v.is_deleted && v.req_status !== 'pending');

  document.getElementById('dash-recent').innerHTML = active.slice(0, 8).map(v =>
    `<div class="recent-item"><div class="recent-avatar">${initials(v.name_of_outlet || v.customer_id)}</div><div class="recent-info"><div class="recent-name">${esc(v.name_of_outlet || v.customer_id)}</div><div class="recent-sub">${esc(v.team || '—')} · ${esc(v.bde || '—')}</div></div><div class="recent-right"><div class="recent-date">${fmtDate(v.date_visit)}</div></div></div>`
  ).join('') || '<div style="padding:1.5rem;text-align:center;color:var(--text-3);">No visits</div>';

  const palette = ['#2D6A4F', '#B5A042', '#52B788', '#C0392B', '#2563EB', '#9B59B6', '#E67E22', '#1ABC9C'];
  const teamCounts = {};
  active.forEach(v => { const a = v.team || 'Unknown'; teamCounts[a] = (teamCounts[a] || 0) + 1; });

  if (areaChart) areaChart.destroy();
  const ctxA = document.getElementById('areaChart').getContext('2d');
  areaChart = new Chart(ctxA, {
    type: 'doughnut',
    data: { labels: Object.keys(teamCounts), datasets: [{ data: Object.values(teamCounts), backgroundColor: palette, borderWidth: isDark ? 0 : 2, borderColor: isDark ? 'transparent' : '#fff' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: tc, font: { family: 'IBM Plex Sans Thai', size: 12 }, padding: 14 } } } }
  });

  const bdeCounts = {};
  active.forEach(v => { const p = v.bde || 'Unknown'; bdeCounts[p] = (bdeCounts[p] || 0) + 1; });
  const sortedP = Object.entries(bdeCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  if (posChart) posChart.destroy();
  const ctxP = document.getElementById('posChart').getContext('2d');
  posChart = new Chart(ctxP, {
    type: 'bar',
    data: { labels: sortedP.map(i => i[0]), datasets: [{ data: sortedP.map(i => i[1]), backgroundColor: '#2D6A4F', borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, color: tc }, grid: { color: isDark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)' } }, x: { ticks: { color: tc }, grid: { display: false } } }, plugins: { legend: { display: false } } }
  });
}

// ═══════════════════════════════════════════
//  VISITS & PAGINATION
// ═══════════════════════════════════════════
window.filterVis = function (f, btn) {
  visFilter = f;
  document.querySelectorAll('#vis-pill-group .pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  resetAndLoadVisits();
};
window.resetAndLoadVisits = function () { visPage = 0; selectedVisits.clear(); updateBulkBar(); loadVisits(); };

async function loadVisits(page = 0) {
  visPage = page;
  const dateF = document.getElementById('vis-date-range').value;
  const srch = document.getElementById('vis-search').value.trim();
  document.getElementById('vis-tbody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-3);">Loading...</td></tr>';

  let q = 'visitation?select=id,name_of_outlet,customer_id,company,team,bde,date_visit,visit_report,visit_result,target,actual,is_deleted,req_status,user_id,status,created_at,delete_reason';
  if (visFilter === 'active') q += '&is_deleted=is.false&or=(req_status.is.null,req_status.eq.rejected)';
  else if (visFilter === 'pending') q += '&or=(req_status.eq.pending,and(is_deleted.is.true,req_status.is.null))';
  else if (visFilter === 'deleted') q += '&req_status=eq.approved';

  if (srch) q += `&name_of_outlet=ilike.*${encodeURIComponent(srch)}*`;
  const now = new Date();
  if (dateF === '7days') { const d = new Date(); d.setDate(d.getDate() - 7); q += `&date_visit=gte.${d.toISOString().split('T')[0]}`; }
  else if (dateF === 'this_month') { q += `&date_visit=gte.${new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]}`; }
  else if (dateF === 'last_month') { q += `&date_visit=gte.${new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]}&date_visit=lte.${new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]}`; }

  const start = page * VIS_PER_PAGE;
  q += `&order=created_at.desc&limit=${VIS_PER_PAGE}&offset=${start}`;

  try {
    const [visRes, reqRes] = await Promise.all([
      supa(q, { prefer: 'count=exact' }),
      visFilter === 'pending' ? supa('delete_requests?select=*&status=eq.pending&order=created_at.desc') : Promise.resolve({ data: [] })
    ]);
    const cr = visRes.headers.get('content-range');
    visTotalCount = cr ? parseInt(cr.split('/')[1]) : 0;
    allVisits = visRes.data || [];
    allRequests = reqRes.data || [];
    const metaEl = document.getElementById('vis-meta');
    if (metaEl) metaEl.textContent = `${visTotalCount} records`;
    renderVisHead(); renderVisits(); renderVisPagination();
  } catch (e) { toast('Load visits failed', 'error'); }
}

function getVisStatus(v) {
  if (v.req_status === 'approved') return 'approved';
  if (v.req_status === 'pending') return 'pending';
  if (v.is_deleted && v.req_status == null) return 'pending';
  return 'active';
}

function renderVisHead() {
  const showCb = visFilter === 'pending';
  let cols = '';
  if (showCb) cols += '<th style="width:36px;"><input type="checkbox" id="cb-all" onchange="toggleSelectAll(this)"></th>';
  cols += '<th>Date</th><th>Outlet / Team</th><th>BDE</th>';
  if (visFilter === 'pending') cols += '<th>Reason</th><th>Requested By</th><th>Action</th>';
  else if (visFilter === 'deleted') cols += '<th>Reason</th><th>Status</th><th>Action</th>';
  else cols += '<th>Status</th>';
  document.getElementById('vis-thead').innerHTML = `<tr>${cols}</tr>`;
}

function renderVisits() {
  const showCb = visFilter === 'pending';
  if (!allVisits.length) {
    document.getElementById('vis-tbody').innerHTML = '<tr><td colspan="8"><div class="empty-state"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><h3>No records found</h3><p>Try adjusting your filters</p></div></td></tr>';
    return;
  }
  document.getElementById('vis-tbody').innerHTML = allVisits.map(v => {
    const st = getVisStatus(v);
    const isChk = selectedVisits.has(v.id) ? 'checked' : '';
    const baseRow = `${showCb ? `<td onclick="event.stopPropagation()"><input type="checkbox" class="cb-row" value="${v.id}" onchange="toggleSelect(this)" ${isChk}></td>` : ''}<td style="white-space:nowrap;" class="td-mono">${fmtDate(v.date_visit)}</td><td><div style="font-weight:600;">${esc(v.name_of_outlet || v.customer_id)}</div><span class="badge badge-outline" style="margin-top:3px;">${esc(v.team || '—')}</span></td><td><div>${esc(v.bde || '—')}</div><div class="td-muted">${esc(v.user_id || '—')}</div></td>`;

    let extraCols = '';
    if (visFilter === 'pending') {
      const req = allRequests.find(r => r.visit_id === v.id);
      const reason = req?.reason || v.delete_reason || '—';
      const reqBy = req ? `${esc(req.requested_by_name || '—')}<div class="td-muted">${esc(req.requested_by_email || '')}</div>` : '—';
      const reqId = req?.id || '';
      extraCols = `<td style="max-width:180px;font-size:12px;color:var(--text-2);">${esc(reason.substring(0, 80))}${reason.length > 80 ? '…' : ''}</td><td>${reqBy}</td><td onclick="event.stopPropagation()"><div style="display:flex;gap:6px;"><button class="btn btn-success btn-sm" onclick="doRequest('approve','${reqId}','${v.id}')">Approve</button><button class="btn btn-danger btn-sm" onclick="doRequest('reject','${reqId}','${v.id}')">Reject</button></div></td>`;
    } else if (visFilter === 'deleted') {
      extraCols = `<td style="max-width:180px;font-size:12px;color:var(--text-2);">${esc((v.delete_reason || '').substring(0, 80))}${(v.delete_reason || '').length > 80 ? '…' : ''}</td><td><span class="badge badge-grey">Archived</span></td><td onclick="event.stopPropagation()"><button class="btn btn-danger btn-sm" onclick="hardDeleteVisit('${v.id}')">Delete Forever</button></td>`;
    } else {
      extraCols = `<td><span class="badge badge-green">Active</span></td>`;
    }
    return `<tr style="cursor:pointer;" onclick="openDetail('${v.id}')">${baseRow}${extraCols}</tr>`;
  }).join('');
}

function renderVisPagination() {
  const total = Math.ceil(visTotalCount / VIS_PER_PAGE);
  const el = document.getElementById('vis-pagination');
  if (total <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `<button class="pg-btn" ${visPage === 0 ? 'disabled' : ''} onclick="loadVisits(${visPage - 1})">← Prev</button><span class="pg-info">Page ${visPage + 1} of ${total}</span><button class="pg-btn" ${visPage >= total - 1 ? 'disabled' : ''} onclick="loadVisits(${visPage + 1})">Next →</button>`;
}

window.openDetail = function (id) {
  const v = allVisits.find(x => String(x.id) === String(id)); if (!v) return;
  document.getElementById('detail-title').textContent = v.name_of_outlet || v.customer_id || 'Visit Detail';
  document.getElementById('detail-sub').textContent = fmtDate(v.date_visit) + ' · ' + (v.team || '');
  const imgUrl = v.image_capture || v.visit_capture || '';
  document.getElementById('detail-body').innerHTML = `<div class="detail-section"><div class="detail-section-title">Outlet Information</div><div class="info-grid"><div class="info-item"><label>Outlet</label><span>${esc(v.name_of_outlet || '—')}</span></div><div class="info-item"><label>Customer ID</label><span>${esc(v.customer_id)}</span></div><div class="info-item"><label>Company</label><span>${esc(v.company || '—')}</span></div><div class="info-item"><label>Team</label><span>${esc(v.team || '—')}</span></div><div class="info-item"><label>Status</label><span>${esc(v.status || '—')}</span></div><div class="info-item"><label>Date Visit</label><span>${fmtDate(v.date_visit)}</span></div><div class="info-item"><label>Created</label><span>${fmtDate(v.created_at)}</span></div></div></div><div class="detail-section"><div class="detail-section-title">BDE / User</div><div class="info-grid"><div class="info-item"><label>BDE</label><span>${esc(v.bde || '—')}</span></div><div class="info-item"><label>User ID</label><span>${esc(v.user_id || '—')}</span></div></div></div><div class="detail-section"><div class="detail-section-title">Visit Details</div><div class="detail-field"><label>Visit Report</label><div class="detail-field-val">${esc(v.visit_report || '—').replace(/\n/g, '<br>')}</div></div><div class="detail-field"><label>Visit Result</label><div class="detail-field-val">${esc(v.visit_result || '—').replace(/\n/g, '<br>')}</div></div>${v.target != null ? `<div class="detail-field"><label>Target</label><div class="detail-field-val">${esc(v.target)}</div></div>` : ''}${v.actual != null ? `<div class="detail-field"><label>Actual</label><div class="detail-field-val">${esc(v.actual)}</div></div>` : ''}</div>${v.delete_reason ? `<div class="detail-section"><div class="detail-section-title" style="color:var(--amber);">Delete Request</div><div class="detail-field"><label>Reason</label><div class="detail-field-val">${esc(v.delete_reason)}</div></div></div>` : ''}${imgUrl ? `<div class="detail-section"><div class="detail-section-title">Photos</div><div class="photo-grid"><div class="photo-thumb" onclick="openLightbox('${esc(imgUrl)}')"><img src="${esc(imgUrl)}" alt="" loading="lazy"></div></div></div>` : ''}`;
  document.getElementById('detail-panel').classList.add('open');
  document.getElementById('detail-backdrop').style.display = 'block';
};

window.closeDetail = function () {
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('detail-backdrop').style.display = 'none';
};

async function hardDeleteVisit(id) {
  try {
    await supa(`delete_requests?visit_id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
    await supa(`visitation?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
    toast('Permanently deleted');
    await loadVisits(visPage);
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}

// BULK
window.toggleSelectAll = function (el) {
  document.querySelectorAll('.cb-row').forEach(cb => { cb.checked = el.checked; el.checked ? selectedVisits.add(cb.value) : selectedVisits.delete(cb.value); });
  updateBulkBar();
};
window.toggleSelect = function (el) { el.checked ? selectedVisits.add(el.value) : selectedVisits.delete(el.value); updateBulkBar(); };
function updateBulkBar() {
  const bar = document.getElementById('vis-bulk-bar');
  if (bar) {
    document.getElementById('vis-bulk-count').textContent = selectedVisits.size;
    bar.classList.toggle('show', selectedVisits.size > 0);
  }
}
window.askBulkAction = function (type) {
  if (selectedVisits.size === 0) return toast('No items selected', 'error');
  doBulk(type);
};
async function doBulk(type) {
  const ids = Array.from(selectedVisits);
  const idList = formatInClause(ids);
  try {
    if (type === 'approve') {
      await supa(`visitation?id=in.${idList}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true, req_status: 'approved' }), prefer: 'return=minimal' });
      await supa(`delete_requests?visit_id=in.${idList}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved', reviewed_by: 'Admin', reviewed_at: new Date().toISOString() }), prefer: 'return=minimal' });
    } else {
      await supa(`visitation?id=in.${idList}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: false, req_status: 'rejected' }), prefer: 'return=minimal' });
      await supa(`delete_requests?visit_id=in.${idList}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected', reviewed_by: 'Admin', reviewed_at: new Date().toISOString() }), prefer: 'return=minimal' });
    }
    toast(`Bulk ${type} done!`); selectedVisits.clear(); updateBulkBar(); await loadVisits(visPage);
  } catch (e) { toast('Bulk action failed', 'error'); }
}

window.exportVisits = function () {
  const headers = ['id', 'customer_id', 'name_of_outlet', 'company', 'team', 'bde', 'date_visit', 'visit_report', 'visit_result', 'target', 'actual', 'created_at'];
  const csv = [headers.join(','), ...allVisits.map(v => headers.map(h => escapeCSV(v[h])).join(','))].join('\n');
  dlCSV(csv, 'visitation_export.csv');
};
window.exportSelected = function () {
  const data = allVisits.filter(v => selectedVisits.has(v.id));
  const headers = ['id', 'customer_id', 'name_of_outlet', 'team', 'bde', 'date_visit', 'delete_reason'];
  const csv = [headers.join(','), ...data.map(v => headers.map(h => escapeCSV(v[h])).join(','))].join('\n');
  dlCSV(csv, 'visitation_selected.csv');
};

function dlCSV(csv, fname) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); a.download = fname; a.click();
}

window.doRequest = async function (action, reqId, visitId) {
  try {
    if (action === 'approve') {
      await supa(`visitation?id=eq.${visitId}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: true, req_status: 'approved' }), prefer: 'return=minimal' });
      if (reqId) await supa(`delete_requests?id=eq.${reqId}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved', reviewed_by: 'Admin', reviewed_at: new Date().toISOString() }), prefer: 'return=minimal' });
      toast('Visit approved and deleted');
    } else {
      await supa(`visitation?id=eq.${visitId}`, { method: 'PATCH', body: JSON.stringify({ is_deleted: false, req_status: 'rejected' }), prefer: 'return=minimal' });
      if (reqId) await supa(`delete_requests?id=eq.${reqId}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected', reviewed_by: 'Admin', reviewed_at: new Date().toISOString() }), prefer: 'return=minimal' });
      toast('Request rejected');
    }
    // รีโหลดตารางและอัปเดต badge pending พร้อมกัน
    await loadVisits(visPage);
    refreshPendingBadge();
  } catch (e) { toast('Action failed: ' + e.message, 'error'); }
};

async function refreshPendingBadge() {
  try {
    const res = await supa('delete_requests?select=id&status=eq.pending');
    const count = (res.data || []).length;
    const dot = document.getElementById('notif-dot');
    const rb = document.getElementById('req-badge');
    const rp = document.getElementById('req-badge-pending');
    if (count > 0) {
      if (dot) dot.style.display = 'block';
      if (rb) { rb.textContent = count; rb.style.display = 'inline-block'; }
      if (rp) { rp.textContent = count; rp.style.display = 'inline'; }
    } else {
      if (dot) dot.style.display = 'none';
      if (rb) rb.style.display = 'none';
      if (rp) rp.style.display = 'none';
    }
  } catch (e) { console.warn('Failed to refresh badge', e); }
}

// ═══════════════════════════════════════════
//  VISITATION REPORT
// ═══════════════════════════════════════════
let vtMode = 'daily';
window.filterVisitation = function (mode, btn) {
  vtMode = mode;
  document.querySelectorAll('[id^="vt-pill-"]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadVisitation();
};
async function loadVisitation() {
  document.getElementById('vt-tbody').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-3);">Loading...</td></tr>';
  const team = document.getElementById('visit-team-filter').value;
  const dateVal = document.getElementById('vt-date').value;
  let q = 'visitation?select=*,customer_information!visitation_customer_id_fkey(outlet_name)&order=date_visit.desc&limit=100';
  if (team) q += `&team=eq.${encodeURIComponent(team)}`;
  if (dateVal) q += `&date_visit=eq.${dateVal}`;
  try {
    const res = await supa(q);
    allVisitation = res.data || [];
    if (!allVisitation.length) { document.getElementById('vt-tbody').innerHTML = '<tr><td colspan="6"><div class="empty-state"><h3>No visitation data</h3></div></td></tr>'; return; }
    document.getElementById('vt-tbody').innerHTML = allVisitation.map(v => `<tr><td><strong>${esc(v.customer_information?.outlet_name || v.name_of_outlet || v.customer_id)}</strong><div class="td-muted td-mono">${esc(v.customer_id)}</div></td><td><span class="badge badge-outline">${esc(v.team || '—')}</span></td><td>${esc(v.bde || '—')}</td><td><div style="max-width:200px;font-size:12px;">${esc((v.visit_report || '').substring(0, 60))}...</div></td><td><div style="max-width:200px;font-size:12px;">${esc((v.visit_result || '').substring(0, 60))}...</div></td><td class="td-mono">${fmtDate(v.date_visit)}</td></tr>`).join('');
  } catch (e) { toast('Load visitation failed', 'error'); }
}

// ═══════════════════════════════════════════
//  CUSTOMERS MASTER DATA (Cleaned & Paginated)
// ═══════════════════════════════════════════
window.resetAndLoadCustomers = function () {
  custPage = 0;
  loadCustomers();
};

async function loadCustomers(page = 0) {
  custPage = page;
  const tbody = document.getElementById('cust-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-3);">Loading...</td></tr>';

  try {
    await window.ensureUsersLoaded();
    const srch = (document.getElementById('cust-search')?.value || '').trim();
    const stF = document.getElementById('cust-status-filter')?.value;
    const teamF = document.getElementById('cust-team-filter')?.value;
    const bdeF = document.getElementById('cust-bde-filter')?.value;

    // Query customers table (master) joined with customer_information (detail)
    // customers has: outlet_name, province, region, segment, region_code, pv_code, group_code, outlet_code
    // customer_information has: outlet_code, no, soi, road, sub_district, district, province, post_code, address, status, bde, user_id
    let q = 'customers?select=id,customer_id,outlet_name,status,province,region,segment,region_code,pv_code,group_code,outlet_code,regions_ana,is_active,customer_information!customer_info_customer_id_fkey(id,bde,user_id,outlet_code,no,soi,road,sub_district,district,post_code,address,status),user_information!customers_customer_id_fkey(name,team,sub_team)';

    // fallback simpler query if FK hint fails
    // use customers join to customer_information via customer_id
    q = 'customers?select=id,customer_id,outlet_name,status,province,region,segment,region_code,pv_code,group_code,outlet_code,regions_ana,is_active';

    if (srch) q += `&or=(outlet_name.ilike.*${encodeURIComponent(srch)}*,customer_id.ilike.*${encodeURIComponent(srch)}*)`;
    if (stF) q += `&status=eq.${encodeURIComponent(stF)}`;

    const start = page * CUST_PER_PAGE;
    q += `&order=customer_id.asc&limit=${CUST_PER_PAGE}&offset=${start}`;

    const [custRes, infoRes] = await Promise.all([
      supa(q, { prefer: 'count=exact' }),
      supa('customer_information?select=customer_id,id,bde,user_id,outlet_code,no,soi,road,sub_district,district,post_code,address,status&order=customer_id.asc&limit=10000')
    ]);

    const cr = custRes.headers.get('content-range');
    custTotalCount = cr ? parseInt(cr.split('/')[1]) : 0;

    // merge customer_information into customers by customer_id
    const infoMap = {};
    (infoRes.data || []).forEach(ci => { infoMap[ci.customer_id] = ci; });

    allCustomers = (custRes.data || []).map(c => ({
      ...c,
      _info: infoMap[c.customer_id] || {},
    }));

    // apply team/bde filter (from user_information via bde name)
    let filtered = allCustomers;
    if (teamF || bdeF) {
      filtered = allCustomers.filter(c => {
        const bdeUser = allUsers.find(u => u.name === c._info.bde);
        if (teamF && (!bdeUser || bdeUser.team !== teamF)) return false;
        if (bdeF && c._info.bde !== bdeF) return false;
        return true;
      });
    }
    allCustomers = filtered;

    const metaEl = document.getElementById('cust-meta');
    if (metaEl) metaEl.textContent = `${custTotalCount} customers`;

    renderCustomers();
    renderCustPagination();
  } catch (e) { toast('Load customers failed: ' + e.message, 'error'); }
}

function renderCustomers() {
  const tbody = document.getElementById('cust-tbody');
  if (!tbody) return;
  if (!allCustomers.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><h3>No customers found</h3></div></td></tr>';
    return;
  }

  tbody.innerHTML = allCustomers.map(c => {
    const info = c._info || {};
    const bdeUser = allUsers.find(u => u.name === info.bde);
    const team = bdeUser?.team || '—';
    const stCls = c.status === 'ACTIVE' || !c.status ? 'badge-green' : c.status === 'PROSPECT' ? 'badge-blue' : 'badge-grey';
    return `<tr>
      <td class="td-mono" style="font-size:11px;">${esc(c.outlet_code || c.customer_id)}</td>
      <td><strong>${esc(c.outlet_name || '—')}</strong><div class="td-muted">${esc(c.province || '—')} · ${esc(c.segment || '—')}</div></td>
      <td>${esc(c.region || '—')}</td>
      <td><span class="badge badge-outline">${esc(team)}</span></td>
      <td>${esc(info.bde || '—')}</td>
      <td>${esc(c.group_code || '—')}</td>
      <td><span class="badge ${stCls}">${esc(c.status || 'ACTIVE')}</span></td>
      <td><div style="display:flex;gap:6px;">
        <button class="btn btn-outline btn-sm" onclick="openCustomerModal('${info.id || c.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="showConfirm('Delete Customer','Delete <strong>${esc(c.outlet_name)}</strong>? This cannot be undone.','Delete','btn-danger',()=>deleteCustomer('${info.id || c.id}','${c.customer_id}'))">Del</button>
      </div></td>
    </tr>`;
  }).join('');
}

function renderCustPagination() {
  const total = Math.ceil(custTotalCount / CUST_PER_PAGE);
  const el = document.getElementById('cust-pagination');
  if (!el) return;
  if (total <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `<button class="pg-btn" ${custPage === 0 ? 'disabled' : ''} onclick="loadCustomers(${custPage - 1})">← Prev</button><span class="pg-info">Page ${custPage + 1} of ${total}</span><button class="pg-btn" ${custPage >= total - 1 ? 'disabled' : ''} onclick="loadCustomers(${custPage + 1})">Next →</button>`;
}

const TEAM_CODES = {
  'Admin': 'ADM',
  'Horeca': 'HRC',
  'On Premise': 'OP',
  'Southern': 'STH'
};

const AREA_CODES = {
  'Admin': 'ADM',
  'BKK': 'BKK',
  'EAST': 'EST',
  'North+Northeast': 'NNE',
  'Phuket-HRC': 'PKH',
  'Phuket-OP': 'PKO',
  'Samui-HRC': 'SMH',
  'Samui-OP': 'SMO'
};

window.updateAreaDropdownForCustomer = function (team) {
  const areaSelect = document.getElementById('cm-area');
  const bdeSelect = document.getElementById('cm-bde');
  if (!areaSelect || !bdeSelect) return;

  areaSelect.innerHTML = '<option value="">-- Select Area --</option>';
  bdeSelect.innerHTML = '<option value="">-- Select Area First --</option>';

  if (TEAM_CONFIG[team]) {
    TEAM_CONFIG[team].forEach(area => {
      const opt = document.createElement('option');
      opt.value = area;
      opt.textContent = area;
      areaSelect.appendChild(opt);
    });
  }
  generateOutletCode();
};

window.updateBdeDropdownByArea = async function () {
  await window.ensureUsersLoaded();
  await window.loadBdeCounts();
  const team = document.getElementById('cm-team').value;
  const area = document.getElementById('cm-area').value;
  const bdeSelect = document.getElementById('cm-bde');
  if (!bdeSelect) return;

  bdeSelect.innerHTML = '<option value="">-- Select BDE --</option>';

  if (team && area) {
    const availableUsers = allUsers.filter(u => u.team === team && u.sub_team === area);
    availableUsers.forEach(u => {
      let count = 0;
      if (u.team === 'Admin') {
        // ถ้าเป็น Admin ให้จับจำนวนร้านของทุกคนมาบวกรวมกัน
        count = Object.values(bdeCustomerCounts).reduce((sum, val) => sum + val, 0);
      } else {
        // ถ้าเป็น BDE ปกติ ให้นับเฉพาะร้านในชื่อตัวเอง
        count = bdeCustomerCounts[u.name] || 0;
      }
      const opt = document.createElement('option');
      opt.value = u.name;
      opt.textContent = `${u.name} (Handling ${count} outlets)`;
      bdeSelect.appendChild(opt);
    });
  }
  generateOutletCode();
};

let originalCustomerTeam = '';
let originalCustomerArea = '';

// ── Province map by Region code ──
const PROVINCE_BY_REGION = {
  '1': [{ code: '10', name: 'Bangkok' }],
  '2': [
    { code: '11', name: 'Samut Prakan' }, { code: '20', name: 'Chonburi' },
    { code: '21', name: 'Rayong' }, { code: '22', name: 'Chanthaburi' },
    { code: '23', name: 'Trat' }, { code: '24', name: 'Chachoengsao' },
    { code: '25', name: 'Prachinburi' }, { code: '26', name: 'Nakhon Nayok' },
    { code: '27', name: 'Sa Kaeo' }
  ],
  '3': [
    { code: '50', name: 'Chiang Mai' }, { code: '51', name: 'Lamphun' },
    { code: '52', name: 'Lampang' }, { code: '53', name: 'Uttaradit' },
    { code: '54', name: 'Phrae' }, { code: '55', name: 'Nan' },
    { code: '56', name: 'Phayao' }, { code: '57', name: 'Chiang Rai' },
    { code: '58', name: 'Mae Hong Son' }, { code: '30', name: 'Nakhon Ratchasima' },
    { code: '31', name: 'Buri Ram' }, { code: '32', name: 'Surin' },
    { code: '33', name: 'Si Saket' }, { code: '34', name: 'Ubon Ratchathani' },
    { code: '35', name: 'Yasothon' }, { code: '36', name: 'Chaiyaphum' },
    { code: '37', name: 'Amnat Charoen' }, { code: '38', name: 'Bueng Kan' },
    { code: '39', name: 'Nong Bua Lamphu' }, { code: '40', name: 'Khon Kaen' },
    { code: '41', name: 'Udon Thani' }, { code: '42', name: 'Loei' },
    { code: '43', name: 'Nong Khai' }, { code: '44', name: 'Maha Sarakham' },
    { code: '45', name: 'Roi Et' }, { code: '46', name: 'Kalasin' },
    { code: '47', name: 'Sakon Nakhon' }, { code: '48', name: 'Nakhon Phanom' },
    { code: '49', name: 'Mukdahan' }
  ],
  '4': [
    { code: '12', name: 'Nonthaburi' }, { code: '13', name: 'Pathum Thani' },
    { code: '14', name: 'Phra Nakhon Si Ayutthaya' }, { code: '15', name: 'Ang Thong' },
    { code: '16', name: 'Lopburi' }, { code: '17', name: 'Singburi' },
    { code: '18', name: 'Chainat' }, { code: '19', name: 'Saraburi' },
    { code: '60', name: 'Nakhon Sawan' }, { code: '61', name: 'Uthai Thani' },
    { code: '62', name: 'Kamphaeng Phet' }, { code: '63', name: 'Tak' },
    { code: '64', name: 'Sukhothai' }, { code: '65', name: 'Phitsanulok' },
    { code: '66', name: 'Phichit' }, { code: '67', name: 'Phetchabun' }
  ],
  '5': [
    { code: '80', name: 'Nakhon Si Thammarat' }, { code: '81', name: 'Krabi' },
    { code: '82', name: 'Phang Nga' }, { code: '83', name: 'Phuket' },
    { code: '84', name: 'Surat Thani' }, { code: '85', name: 'Ranong' },
    { code: '86', name: 'Chumphon' }, { code: '90', name: 'Songkhla' },
    { code: '91', name: 'Satun' }, { code: '92', name: 'Trang' },
    { code: '93', name: 'Phatthalung' }, { code: '94', name: 'Pattani' },
    { code: '95', name: 'Yala' }, { code: '96', name: 'Narathiwat' }
  ],
  '6': [
    { code: '70', name: 'Ratchaburi' }, { code: '71', name: 'Kanchanaburi' },
    { code: '72', name: 'Suphanburi' }, { code: '73', name: 'Nakhon Pathom' },
    { code: '74', name: 'Samut Sakhon' }, { code: '75', name: 'Samut Songkhram' },
    { code: '76', name: 'Phetchaburi' }, { code: '77', name: 'Prachuap Khiri Khan' }
  ],
  '7': [
    { code: '30', name: 'Nakhon Ratchasima' }, { code: '31', name: 'Buri Ram' },
    { code: '32', name: 'Surin' }, { code: '33', name: 'Si Saket' },
    { code: '34', name: 'Ubon Ratchathani' }, { code: '35', name: 'Yasothon' },
    { code: '36', name: 'Chaiyaphum' }, { code: '37', name: 'Amnat Charoen' },
    { code: '38', name: 'Bueng Kan' }, { code: '39', name: 'Nong Bua Lamphu' },
    { code: '40', name: 'Khon Kaen' }, { code: '41', name: 'Udon Thani' },
    { code: '42', name: 'Loei' }, { code: '43', name: 'Nong Khai' },
    { code: '44', name: 'Maha Sarakham' }, { code: '45', name: 'Roi Et' },
    { code: '46', name: 'Kalasin' }, { code: '47', name: 'Sakon Nakhon' },
    { code: '48', name: 'Nakhon Phanom' }, { code: '49', name: 'Mukdahan' }
  ]
};

// ── All Groups from ref_groups ──
const ALL_GROUPS = [
  { code: 'UNC', name: 'UNCATEGORIZED' }, { code: 'ACC', name: 'ACCOR' },
  { code: 'AKA', name: 'AKARA GROUP' }, { code: 'BDD', name: 'BUDDY GROUP' },
  { code: 'CAP', name: 'CAPELLA' }, { code: 'CEN', name: 'CENTARA' },
  { code: 'CPH', name: 'COMPASS HOSPITALITY' }, { code: 'ERW', name: 'THE ERAWAN GROUP' },
  { code: 'FCP', name: 'FOODCOOP' }, { code: 'GGN', name: 'GAGGAN' },
  { code: 'HTW', name: 'HILTON WORLDWIDE' }, { code: 'IHG', name: 'IHG GROUP' },
  { code: 'ITL', name: 'ITALTHAI' }, { code: 'IVW', name: 'MOON SOON' },
  { code: 'LAB', name: 'THE LAB' }, { code: 'LMT', name: 'LAMONITA' },
  { code: 'MAR', name: 'MARRIOTT BONVOY' }, { code: 'MIN', name: 'MINOR' },
  { code: 'MPR', name: 'MAGPIE ROOM' }, { code: 'PPP', name: 'PAPER PLANE' },
  { code: 'PTR', name: 'PANTHERA' }, { code: 'SGR', name: 'SUGARRAY' },
  { code: 'SOH', name: 'SOHO HOSPITALITY' }, { code: 'SWL', name: 'SIWILAI' },
  { code: 'WAL', name: 'THE WALL 865' }, { code: 'WTM', name: 'WATERMELON GROUP' },
  { code: 'YOL', name: 'YOLO GROUP' }, { code: 'DST', name: 'DUSIT INTERNATIONAL' },
  { code: 'SOG', name: 'SOHO GROUP' }, { code: 'ONY', name: 'ONYX' },
  { code: 'TLP', name: 'TALAY PAILIN' }, { code: 'KCD', name: 'KORN CAN DO' },
  { code: 'SAI', name: 'SAII' }, { code: 'NOE', name: 'NUMBER EIGHT' },
  { code: 'PJR', name: 'PROJECT RUN GOOD' }, { code: 'FAC', name: 'FAT CHILL' },
  { code: 'THM', name: 'THE MALL' }, { code: 'MAN', name: 'MARNI' },
  { code: 'ECL', name: 'ECHELON' }, { code: 'KNG', name: 'KING GROUP' },
  { code: 'FRA', name: 'FIRA GROUP' }, { code: 'MBK', name: 'MBK GROUP' },
  { code: 'MKB', name: 'MARKABI' }, { code: 'CTD', name: 'COCKTAIL DESIGN' },
  { code: 'POL', name: 'PLAY ONLINE (BAN PUEN GROUP)' }, { code: 'COT', name: 'COCOTTE' },
  { code: 'SMG', name: 'SUGAR MARINA GROUP' }, { code: 'BBH', name: 'BAAN BORAN HOSPITALITY' },
  { code: 'BMB', name: 'BAMBOO BEACH CLUB' }, { code: 'ASM', name: 'AMARI KOH SAMUI' },
  { code: 'PPG', name: 'HOTEL 24 / PPG HEALS' }, { code: 'MAB', name: 'MAYA GROUP' },
  { code: 'HAB', name: 'HOLEY ARTISAN' }, { code: 'TMK', name: 'THREE MONKEY GROUP' }
];

// populate group dropdown on page load
(function populateGroupDropdown() {
  document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('cm-group-code');
    if (!sel) return;
    ALL_GROUPS.forEach(g => {
      const o = document.createElement('option');
      o.value = g.code;
      o.textContent = `${g.code} — ${g.name}`;
      sel.appendChild(o);
    });
  });
})();

// when region changes → update province dropdown
window.onCmRegionChange = function () {
  const regionCode = document.getElementById('cm-region').value;
  const pvSel = document.getElementById('cm-province');
  pvSel.innerHTML = '<option value="">-- Select Province --</option>';
  (PROVINCE_BY_REGION[regionCode] || []).forEach(p => {
    const o = document.createElement('option');
    o.value = p.code;
    o.textContent = `${p.code} — ${p.name}`;
    pvSel.appendChild(o);
  });
  generateOutletCode();
};

// regenerate outlet code when any ref field changes
window.onCmRefChange = function () { generateOutletCode(); };

window.generateOutletCode = async function () {
  const segment = document.getElementById('cm-segment').value;
  const region = document.getElementById('cm-region').value;
  const pvCode = document.getElementById('cm-province').value;
  const groupCode = document.getElementById('cm-group-code').value;
  const outInput = document.getElementById('cm-outlet-code');
  if (!outInput) return;

  // 1. แสดงข้อความเริ่มต้นเมื่อยังไม่มีการเลือกข้อมูลใดๆ
  if (!segment && !region && !pvCode && !groupCode) {
    outInput.value = 'Select fields below to generate...';
    return;
  }

  // 2. แสดงโครงสร้าง Preview หากข้อมูลยังเลือกไม่ครบ 4 ส่วน
  if (!segment || !region || !pvCode || !groupCode) {
    outInput.value = `${segment || '?'}-${region || '?'}-${pvCode || '??'}-XXXX-${groupCode || '???'}`;
    return;
  }

  // 3. เริ่มทำงานเพื่อดึง Running Number เมื่อฟิลด์ครบ
  outInput.value = 'Generating...';
  try {
    const prefix = `${segment}-${region}-${pvCode}-`;
    const res = await supa(`customers?select=outlet_code&outlet_code=like.${encodeURIComponent(prefix)}*&order=outlet_code.desc&limit=1`);

    let nextRun = 1001;
    if (res.data && res.data.length > 0 && res.data[0].outlet_code) {
      const last = res.data[0].outlet_code;
      const parts = last.split('-');
      if (parts.length >= 4) {
        const parsed = parseInt(parts[3], 10);
        if (!isNaN(parsed)) nextRun = parsed + 1;
      }
    }

    const generatedCode = `${segment}-${region}-${pvCode}-${nextRun}-${groupCode}`;
    outInput.value = generatedCode;
  } catch (e) {
    outInput.value = `${segment}-${region}-${pvCode}-???-${groupCode}`;
    console.warn('generateOutletCode error', e);
  }
};

window.openCustomerModal = async function (id = null) {
  editingCustomerId = id;

  // --- ส่วนที่แก้ไข: เช็คและ Sync ข้อมูลเข้า Searchable UI ของ Group Code ---
  const optsGrp = document.getElementById('opts-cm-group-code');
  if (optsGrp && optsGrp.children.length <= 1) {
    if (typeof window._origPopulateGroupCmSearch === 'function') {
      window._origPopulateGroupCmSearch();
    }
  }

  if (id) {
    // id here is customer_information.id (from _info.id)
    const c = allCustomers.find(x => x._info?.id === id || x.id === id);
    if (!c) return;
    const info = c._info || {};
    document.getElementById('cust-modal-title').textContent = 'Edit Customer';
    document.getElementById('cm-id').value = info.id || '';

    // classification from customers table
    const parts = (c.outlet_code || '').split('-');
    const segVal = parts[0] || '';
    const regVal = parts[1] || '';
    const pvVal = parts[2] || '';
    const grpVal = parts[4] || '';

    document.getElementById('cm-segment').value = segVal;
    const pvSel = document.getElementById('cm-province');
    pvSel.innerHTML = '<option value="">-- Select Province --</option>';
    (PROVINCE_BY_REGION[regVal] || []).forEach(p => {
      const o = document.createElement('option');
      o.value = p.code; o.textContent = `${p.code} — ${p.name}`;
      pvSel.appendChild(o);
    });
    document.getElementById('cm-region').value = regVal;
    pvSel.value = pvVal;
    document.getElementById('cm-group-code').value = grpVal;
    document.getElementById('cm-outlet-code').value = c.outlet_code || '';
    document.getElementById('cm-regions-ana').value = c.regions_ana || '';

    // outlet info
    document.getElementById('cm-name').value = c.outlet_name || '';
    document.getElementById('cm-status').value = c.status || 'ACTIVE';
    document.getElementById('cm-tax').value = info.tax_id || '';

    // team/area/bde — look up from user
    const bdeUser = allUsers.find(u => u.name === info.bde);
    document.getElementById('cm-team').value = bdeUser?.team || '';
    updateAreaDropdownForCustomer(bdeUser?.team || '');
    originalCustomerTeam = bdeUser?.team || '';
    originalCustomerArea = bdeUser?.sub_team || '';
    await updateBdeDropdownByArea();
    document.getElementById('cm-bde').value = info.bde || '';
    // sync searchable dropdowns display
    setTimeout(() => window.syncCmSearchableDisplay(), 50);

    // address from customer_information
    document.getElementById('cm-phone').value = info.phone || '';
    document.getElementById('cm-email').value = info.email || '';
  } else {
    document.getElementById('cust-modal-title').textContent = 'Add Customer';
    // clear all
    ['cm-id', 'cm-name', 'cm-regions-ana', 'cm-tax', 'cm-phone', 'cm-email'
    ].forEach(fid => { const el = document.getElementById(fid); if (el) el.value = ''; });
    document.getElementById('cm-segment').value = '';
    document.getElementById('cm-region').value = '';
    document.getElementById('cm-province').innerHTML = '<option value="">-- Select Region First --</option>';
    document.getElementById('cm-group-code').value = '';
    document.getElementById('cm-outlet-code').value = '';
    document.getElementById('cm-status').value = 'ACTIVE';
    document.getElementById('cm-team').value = '';
    updateAreaDropdownForCustomer('');
    originalCustomerTeam = '';
    originalCustomerArea = '';
  }
  document.getElementById('cust-overlay').classList.add('open');
};

// helper: rebuild province dropdown silently (no generate call)
function onCmRegionChange_silent(regionCode) {
  const pvSel = document.getElementById('cm-province');
  if (!pvSel) return;
  pvSel.innerHTML = '<option value="">-- Select Province --</option>';
  (PROVINCE_BY_REGION[regionCode] || []).forEach(p => {
    const o = document.createElement('option');
    o.value = p.code; o.textContent = `${p.code} — ${p.name}`;
    pvSel.appendChild(o);
  });
}

// ── Searchable dropdown helpers ──
window.toggleCmSearch = function (id) {
  const drop = document.getElementById('drop-' + id);
  const allDrops = document.querySelectorAll('.cm-search-dropdown');
  allDrops.forEach(d => { if (d !== drop) { d.classList.remove('open'); } });
  drop.classList.toggle('open');
  if (drop.classList.contains('open')) {
    const inp = drop.querySelector('.cm-search-input');
    if (inp) { inp.value = ''; filterCmOptions(inp, id); inp.focus(); }
  }
};

window.filterCmOptions = function (input, id) {
  const q = input.value.toLowerCase();
  const opts = document.querySelectorAll('#opts-' + id + ' .cm-opt');
  opts.forEach(o => {
    o.style.display = o.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
};

window.selectCmOpt = function (id, val, label) {
  // update hidden select
  const sel = document.getElementById(id);
  if (sel) { sel.value = val; sel.dispatchEvent(new Event('change')); }
  // update display
  const valEl = document.getElementById('val-' + id);
  if (valEl) valEl.textContent = label || '-- Select --';
  // close dropdown
  const drop = document.getElementById('drop-' + id);
  if (drop) drop.classList.remove('open');
};

// Sync province searchable dropdown when region changes
window._origOnCmRegionChange = window.onCmRegionChange;
window.onCmRegionChange = function () {
  if (window._origOnCmRegionChange) window._origOnCmRegionChange();
  // rebuild province options in searchable UI after a tick
  setTimeout(() => {
    const sel = document.getElementById('cm-province');
    const optsEl = document.getElementById('opts-cm-province');
    const valEl = document.getElementById('val-cm-province');
    if (!sel || !optsEl) return;
    optsEl.innerHTML = '';
    Array.from(sel.options).forEach(o => {
      const div = document.createElement('div');
      div.className = 'cm-opt';
      div.dataset.val = o.value;
      div.textContent = o.textContent;
      div.onclick = () => selectCmOpt('cm-province', o.value, o.textContent);
      optsEl.appendChild(div);
    });
    if (valEl) valEl.textContent = '-- Select Province --';
  }, 50);
};

// Sync group code searchable dropdown when groups are loaded
window._origPopulateGroupCmSearch = function () {
  const sel = document.getElementById('cm-group-code');
  const optsEl = document.getElementById('opts-cm-group-code');
  if (!sel || !optsEl) return;
  optsEl.innerHTML = '';
  Array.from(sel.options).forEach(o => {
    const div = document.createElement('div');
    div.className = 'cm-opt';
    div.dataset.val = o.value;
    div.textContent = o.textContent;
    div.onclick = () => selectCmOpt('cm-group-code', o.value, o.textContent);
    optsEl.appendChild(div);
  });
};

// Sync cm-segment and cm-region display values when set programmatically (edit mode)
window.syncCmSearchableDisplay = function () {
  ['cm-segment', 'cm-region', 'cm-province', 'cm-group-code'].forEach(id => {
    const sel = document.getElementById(id);
    const valEl = document.getElementById('val-' + id);
    if (!sel || !valEl) return;
    const selected = sel.options[sel.selectedIndex];
    valEl.textContent = selected && selected.value ? selected.textContent : valEl.textContent;
  });
};

// Close dropdowns on outside click
document.addEventListener('click', function (e) {
  if (!e.target.closest('.cm-searchable-wrap')) {
    document.querySelectorAll('.cm-search-dropdown').forEach(d => d.classList.remove('open'));
  }
});

window.closeCustomerModal = function () {
  document.getElementById('cust-overlay').classList.remove('open');
  editingCustomerId = null;
  originalCustomerTeam = '';
  originalCustomerArea = '';
};

window.saveCustomer = async function () {
  // collect values
  const outletCode = document.getElementById('cm-outlet-code').value.trim();
  const outletName = document.getElementById('cm-name').value.trim();
  const segment = document.getElementById('cm-segment').value;
  const regionCode = document.getElementById('cm-region').value;
  const pvCode = document.getElementById('cm-province').value;
  const groupCode = document.getElementById('cm-group-code').value;
  const regionsAna = document.getElementById('cm-regions-ana').value.trim();
  const team = document.getElementById('cm-team').value;
  const bde = document.getElementById('cm-bde').value;
  const status = document.getElementById('cm-status').value;
  const phone = document.getElementById('cm-phone').value.trim();
  const email = document.getElementById('cm-email').value.trim();

  // resolve province name from code
  const pvList = PROVINCE_BY_REGION[regionCode] || [];
  const pvObj = pvList.find(p => p.code === pvCode);
  const pvName = pvObj ? pvObj.name : pvCode;

  // resolve region name
  const REGION_NAMES = { '1': 'Bangkok', '2': 'East', '3': 'North', '4': 'West', '5': 'South', '6': 'Central', '7': 'Northeastern' };
  const regionName = REGION_NAMES[regionCode] || regionCode;

  // resolve group name
  const grpObj = ALL_GROUPS.find(g => g.code === groupCode);
  const groupName = grpObj ? grpObj.name : groupCode;

  // validation
  const required = [
    { val: segment, label: 'Segment' },
    { val: regionCode, label: 'Region' },
    { val: pvCode, label: 'Province' },
    { val: groupCode, label: 'Group Code' },
    { val: outletCode, label: 'Outlet Code' },
    { val: outletName, label: 'Outlet Name' },
    { val: team, label: 'Team' },
    { val: bde, label: 'BDE' },
  ];
  for (const r of required) {
    if (!r.val || r.val.startsWith('Fill') || r.val.startsWith('Generating')) {
      toast(`Please fill in: ${r.label}`, 'error'); return;
    }
  }

  const bdeUser = allUsers.find(u => u.name === bde);

  try {
    if (editingCustomerId) {
      // ── UPDATE ──
      // 1. update customers table
      await supa(`customers?outlet_code=eq.${encodeURIComponent(outletCode)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          outlet_name: outletName, status, province: pvName,
          region: regionName, regions_ana: regionsAna, segment,
          region_code: regionCode, pv_code: pvCode, group_code: groupCode,
          outlet_code: outletCode,
        }),
        prefer: 'return=minimal'
      });
      // 2. update customer_information
      await supa(`customer_information?id=eq.${editingCustomerId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          outlet_name: outletName, outlet_code: outletCode,
          status, bde, user_id: bdeUser?.user_id || null,
          province: pvName,
        }),
        prefer: 'return=minimal'
      });
      toast('Customer updated');

    } else {
      // ── INSERT ──
      // 1. insert into customers (master)
      await supa('customers', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: outletCode,
          outlet_name: outletName,
          status,
          province: pvName,
          region: regionName,
          regions_ana: regionsAna,
          segment,
          region_code: regionCode,
          pv_code: pvCode,
          group_code: groupCode,
          outlet_code: outletCode,
          is_active: status === 'ACTIVE',
        }),
        prefer: 'return=minimal'
      });

      // 2. insert into customer_information
      await supa('customer_information', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: outletCode,
          outlet_code: outletCode,
          outlet_name: outletName,
          status,
          bde,
          user_id: bdeUser?.user_id || null,
          province: pvName,
        }),
        prefer: 'return=minimal'
      });
      toast('✅ Customer added successfully');
    }

    closeCustomerModal();
    await loadCustomers(custPage);
  } catch (e) { toast('Error: ' + e.message, 'error'); }
};

window.deleteCustomer = async function (infoId, customerId) {
  try {
    if (infoId) await supa(`customer_information?id=eq.${infoId}`, { method: 'DELETE' });
    if (customerId) await supa(`customers?customer_id=eq.${customerId}`, { method: 'DELETE' });
    toast('Customer deleted');
    await loadCustomers(custPage);
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════
//  USERS MANAGEMENT (With Pagination & Relocated PW Button)
// ═══════════════════════════════════════════
window.resetAndLoadUsers = function () {
  usrPage = 0;
  loadUsers();
};

async function loadUsers(page = 0) {
  usrPage = page;
  const tbody = document.getElementById('usr-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-3);">Loading...</td></tr>';

  try {
    await window.loadBdeCounts();
    const srch = (document.getElementById('usr-search')?.value || '').trim();
    const teamF = document.getElementById('usr-team-filter')?.value;

    let q = 'user_information?select=*,users(id,password_hash,is_active,position)';
    if (srch) q += `&or=(name.ilike.*${encodeURIComponent(srch)}*,username.ilike.*${encodeURIComponent(srch)}*,user_id.ilike.*${encodeURIComponent(srch)}*)`;
    if (teamF) q += `&team=eq.${encodeURIComponent(teamF)}`;

    const start = page * USR_PER_PAGE;
    q += `&order=user_id.asc&limit=${USR_PER_PAGE}&offset=${start}`;

    const res = await supa(q, { prefer: 'count=exact' });
    const cr = res.headers.get('content-range');
    usrTotalCount = cr ? parseInt(cr.split('/')[1]) : 0;

    allUsers = res.data || [];
    const metaEl = document.getElementById('usr-meta');
    if (metaEl) metaEl.textContent = `${usrTotalCount} users found`;

    renderUsers();
    renderUsrPagination();
  } catch (e) { toast('Load users failed: ' + e.message, 'error'); }
}

function renderUsers() {
  const tbody = document.getElementById('usr-tbody');
  if (!tbody) return;
  if (!allUsers.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><h3>No users found</h3></div></td></tr>';
    return;
  }

  tbody.innerHTML = allUsers.map((u) => {
    const isActive = u.users ? u.users.is_active : false;

    // 🌟 โค้ดนับร้านค้า (บวกให้ Admin ทุกร้าน)
    let count = 0;
    if (u.team === 'Admin' || u.name === 'System Admin') {
      count = Object.values(bdeCustomerCounts).reduce((sum, val) => sum + val, 0);
    } else {
      count = bdeCustomerCounts[u.name] || 0;
    }

    return `<tr>
      <td class="td-mono">${esc(u.user_id)}</td>
      <td><strong>${esc(u.name)}</strong><br><small class="td-muted">${esc(u.email)}</small></td>
      <td class="td-mono">
        <div style="display:flex;align-items:center;gap:6px;">
          ${esc(u.username)}
        </div>
      </td>
      <td><span class="badge badge-outline">${esc(u.team || '—')}</span></td>
      
      <!-- 🌟 ใช้ u.sub_team สำหรับแสดง Area -->
      <td><span class="badge badge-outline">${esc(u.sub_team || '—')}</span></td>
      
      <td><span class="badge badge-grey">${count} outlets</span></td>
      <td><span class="badge ${isActive ? 'badge-green' : 'badge-grey'}">${isActive ? 'Active' : 'Inactive'}</span></td>
      <td><div style="display:flex;gap:6px;">
        <button class="btn btn-outline btn-sm" onclick="openUserModal('${u.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="showConfirm('Delete User','Delete user <strong>${esc(u.name)}</strong>?','Delete','btn-danger',()=>deleteUser('${u.id}'))">Del</button>
      </div></td>
    </tr>`;
  }).join('');
}

function renderUsrPagination() {
  const total = Math.ceil(usrTotalCount / USR_PER_PAGE);
  const el = document.getElementById('usr-pagination');
  if (!el) return;
  if (total <= 1) { el.innerHTML = ''; return; }

  el.innerHTML = `<button class="pg-btn" ${usrPage === 0 ? 'disabled' : ''} onclick="loadUsers(${usrPage - 1})">← Prev</button>
    <span class="pg-info">Page ${usrPage + 1} of ${total}</span>
    <button class="pg-btn" ${usrPage >= total - 1 ? 'disabled' : ''} onclick="loadUsers(${usrPage + 1})">Next →</button>`;
}

window.openUserModal = function (id = null) {
  editingUserId = id;
  if (id) {
    const u = allUsers.find(x => x.id === id); if (!u) return;
    document.getElementById('usr-modal-title').textContent = 'Edit User';
    document.getElementById('um-id').value = u.id;
    document.getElementById('um-users-id').value = u.users_id;
    document.getElementById('um-code').value = u.user_id || '';
    document.getElementById('um-name').value = u.name || '';
    document.getElementById('um-username').value = u.username || '';
    document.getElementById('um-email').value = u.email || '';
    document.getElementById('um-main-team').value = u.team || '';
    updateSubTeamDropdown(u.team || '', u.level || '');
    document.getElementById('um-contact').value = u.contact || '';
    document.getElementById('um-password').value = u.users ? u.users.password_hash : '';
    document.getElementById('um-active').checked = u.users ? u.users.is_active : false;
  } else {
    document.getElementById('usr-modal-title').textContent = 'Add User';
    ['um-id', 'um-users-id', 'um-name', 'um-username', 'um-email', 'um-contact', 'um-password'].forEach(i => document.getElementById(i).value = '');
    let maxNum = 0;
    allUsers.forEach(u => {
      if (u.user_id && u.user_id.toUpperCase().startsWith('EMP-')) {
        const num = parseInt(u.user_id.substring(4), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    });
    document.getElementById('um-code').value = 'EMP-' + String(maxNum + 1).padStart(3, '0');
    document.getElementById('um-main-team').value = '';
    updateSubTeamDropdown('');
    document.getElementById('um-active').checked = true;
  }
  document.getElementById('usr-overlay').classList.add('open');
};

window.closeUserModal = function () { document.getElementById('usr-overlay').classList.remove('open'); editingUserId = null; };

window.saveUser = async function () {
  const user_id = document.getElementById('um-code').value.trim();
  const name = document.getElementById('um-name').value.trim();
  const username = document.getElementById('um-username').value.trim().toLowerCase();
  const email = document.getElementById('um-email').value.trim();
  const team = document.getElementById('um-main-team').value;
  const sub_team = document.getElementById('um-sub-team').value;
  const contact = document.getElementById('um-contact').value.trim();
  const pw = document.getElementById('um-password').value.trim();
  const isActive = document.getElementById('um-active').checked;

  const requiredFieldsUser = [
    { id: 'um-code', name: 'User ID' },
    { id: 'um-name', name: 'Full Name' },
    { id: 'um-username', name: 'Username' },
    { id: 'um-email', name: 'Email' },
    { id: 'um-main-team', name: 'Team' },
    { id: 'um-sub-team', name: 'Area' },
    { id: 'um-password', name: 'Password' }
  ];

  for (const field of requiredFieldsUser) {
    // ข้ามเช็ครหัสผ่านหากเป็นการ "แก้ไข User" (เพราะปล่อยว่างไว้แปลว่าไม่เปลี่ยนรหัสผ่าน)
    if (field.id === 'um-password' && editingUserId) continue;

    const el = document.getElementById(field.id);
    if (!el || !el.value.trim()) {
      toast(`Please fill in: ${field.name}`, 'error');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        el.classList.add('error-highlight');
        setTimeout(() => el.classList.remove('error-highlight'), 2500);
      }
      return;
    }
  }

  try {
    if (editingUserId) {
      // ─── โหมดแก้ไข ───────────────────────────────────────────
      // 1. อัปเดต user_information
      await supa(`user_information?id=eq.${editingUserId}`, {
        method: 'PATCH',
        body: JSON.stringify({ user_id, username, email, name, team, sub_team, contact }),
        prefer: 'return=minimal'
      });

      // 2. อัปเดต users (password + active status) ถ้ามี users_id
      const usersId = document.getElementById('um-users-id').value;
      if (usersId && pw) {
        const pwHash = await sha256(pw);
        await supa(`users?id=eq.${usersId}`, {
          method: 'PATCH',
          body: JSON.stringify({ password_hash: pwHash, is_active: isActive, position: sub_team }),
          prefer: 'return=minimal'
        });
      }

      toast('อัปเดตข้อมูลสำเร็จ');

    } else {
      // ─── โหมดสร้างใหม่ ────────────────────────────────────────
      // 1. สร้าง record ใน users ก่อน (ไม่ผ่าน Auth SDK)
      const pwHash = await sha256(pw);
      const usersRes = await supa('users', {
        method: 'POST',
        body: JSON.stringify({
          name: name,
          username: username,
          password_hash: pwHash,
          position: sub_team,
          is_active: isActive
        }),
        prefer: 'return=representation'
      });

      const newUsersId = Array.isArray(usersRes.data) ? usersRes.data[0]?.id : usersRes.data?.id;
      if (!newUsersId) throw new Error('ไม่สามารถสร้าง users record ได้');

      // 2. สร้าง record ใน user_information พร้อม link ไปที่ users
      await supa('user_information', {
        method: 'POST',
        body: JSON.stringify({
          users_id: newUsersId,
          user_id: user_id,
          username: username,
          email: email || `${username}@visitation.app`,
          name: name,
          team: team,
          sub_team: sub_team,
          level: sub_team,
          contact: contact
        })
      });

      toast('✅ สร้างผู้ใช้ใหม่สำเร็จ');
    }

    closeUserModal();
    await loadUsers(usrPage);
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
};

async function deleteUser(id) {
  try {
    const u = allUsers.find(x => x.id === id);

    // 1. ลบ user_information ก่อน (FK child)
    await supa(`user_information?id=eq.${id}`, { method: 'DELETE' });

    // 2. ลบ users (parent) ถ้ามี users_id
    if (u?.users_id) {
      await supa(`users?id=eq.${u.users_id}`, { method: 'DELETE' });
    }

    toast('User deleted successfully');
    await loadUsers(usrPage);
  } catch (e) {
    toast('Delete failed: ' + e.message, 'error');
  }
}


// ═══════════════════════════════════════════
//  PASSWORD MIGRATION HELPER
//  ใช้ครั้งเดียว: แปลง plain-text passwords ที่มีอยู่ใน DB ให้เป็น SHA-256
//  กด "Migrate Passwords" ในหน้า Users จะเรียก migratePasswords()
// ═══════════════════════════════════════════
window.migratePasswords = async function () {
  if (!confirm('แปลง password ทั้งหมดในระบบเป็น SHA-256?\nทำได้ครั้งเดียว — หลังจากนี้ plain text จะใช้ไม่ได้อีก')) return;

  try {
    const res = await supa('users?select=id,password_hash&is_active=eq.true');
    const users = res.data || [];

    // กรองเฉพาะ users ที่ยัง plain text (SHA-256 จะยาว 64 hex chars)
    const plainUsers = users.filter(u => u.password_hash && u.password_hash.length !== 64);
    if (!plainUsers.length) { toast('ไม่พบ plain text password แล้ว — migrate เสร็จแล้ว'); return; }

    let ok = 0, fail = 0;
    for (const u of plainUsers) {
      try {
        const hashed = await sha256(u.password_hash);
        await supa(`users?id=eq.${u.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ password_hash: hashed }),
          prefer: 'return=minimal'
        });
        ok++;
      } catch (e) { fail++; }
    }
    toast(`✅ Migrate สำเร็จ ${ok} คน${fail ? ` | ล้มเหลว ${fail} คน` : ''}`);
  } catch (e) {
    toast('Migration failed: ' + e.message, 'error');
  }
};

// ═══════════════════════════════════════════
//  OTHER MODULES (Contracts, Orders, Activity)
// ═══════════════════════════════════════════
async function loadContracts() {
  document.getElementById('con-tbody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-3);">Loading...</td></tr>';
  const typeF = document.getElementById('con-type-filter')?.value || '';
  let q = 'contract?select=*&order=end_date.asc';
  if (typeF) q += `&contract_type=eq.${typeF}`;
  try {
    const res = await supa(q);
    allContracts = res.data || [];
    if (document.getElementById('con-meta')) document.getElementById('con-meta').textContent = `${allContracts.length} contracts`;
    renderContracts();
  } catch (e) { toast('Load contracts failed', 'error'); }
}
function renderContracts() {
  const tbody = document.getElementById('con-tbody');
  if (!tbody) return;
  const now = new Date(); const in30 = new Date(); in30.setDate(now.getDate() + 30);
  let data = allContracts;
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><h3>No contracts found</h3></div></td></tr>'; return; }
  tbody.innerHTML = data.map(c => {
    const days = daysFromNow(c.end_date);
    const isExpiring = days !== null && days <= 30 && days >= 0;
    const isExpired = days !== null && days < 0;
    const stBadge = isExpired ? '<span class="badge badge-red">Expired</span>' : isExpiring ? `<span class="badge badge-amber">Expires in ${days}d</span>` : '<span class="badge badge-green">Active</span>';
    const progress = c.target && c.contract_value ? Math.min(100, Math.round((c.contract_value / c.target) * 100)) : 0;
    return `<tr class="${isExpiring ? 'contract-row-alert' : ''}"><td class="td-mono">${esc(c.contract_id)}</td><td><strong>${esc(c.customer_id)}</strong></td><td><div class="td-mono" style="font-size:11px;">${fmtDate(c.start_date)} →<br>${fmtDate(c.end_date)}</div></td><td style="font-weight:600;">${fmtCurr(c.contract_value)}</td><td style="min-width:100px;"><div style="font-size:11px;margin-bottom:4px;">${fmtCurr(c.contract_value)} / ${fmtCurr(c.target)} (${progress}%)</div><div class="progress-bar"><div class="progress-fill" style="width:${progress}%;background:${progress >= 100 ? 'var(--primary)' : progress >= 50 ? 'var(--accent)' : 'var(--red)'}"></div></div></td><td>${esc(c.contract_type || '—')}</td><td>${stBadge}</td><td><div style="display:flex;gap:6px;"><button class="btn btn-danger btn-sm" onclick="showConfirm('Delete Contract','Delete contract <strong>${esc(c.contract_id)}</strong>?','Delete','btn-danger',()=>deleteContract('${c.id}'))">Del</button></div></td></tr>`;
  }).join('');
}
async function deleteContract(id) {
  try { await supa(`contract?id=eq.${id}`, { method: 'DELETE' }); toast('Contract deleted'); await loadContracts(); }
  catch (e) { toast('Delete failed', 'error'); }
}
window.openContractModal = function () { toast("Feature in development"); }

async function loadOrders() {
  let q = 'orders?select=*&order=order_date.desc&limit=200';
  try {
    const res = await supa(q);
    allOrders = res.data || [];
    renderOrders();
  } catch (e) { toast('Load orders failed', 'error'); }
}
function renderOrders() {
  const tbody = document.getElementById('ord-tbody');
  if (!tbody) return;
  let data = allOrders;
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><h3>No orders found</h3></div></td></tr>'; return; }
  tbody.innerHTML = data.map(o => `<tr><td class="td-mono">${esc(o.order_id)}</td><td>${esc(o.customer_id)}</td><td><strong>${esc(o.product_name || '—')}</strong><div class="td-muted">${esc(o.product_id)}</div></td><td style="font-weight:600;text-align:right;">${fmtNum(o.quantity)}</td><td class="td-mono">${fmtDate(o.order_date)}</td><td>${esc(o.user_id || '—')}</td></tr>`).join('');
}

async function loadProducts() {
  const tbody = document.getElementById('prod-tbody');
  if (!tbody) return;
  try {
    const res = await supa('products?select=*&order=product_name.asc');
    allProducts = res.data || [];
    tbody.innerHTML = allProducts.map(p => `<tr><td class="td-mono">${esc(p.product_id)}</td><td><strong>${esc(p.product_name)}</strong></td><td>${esc(p.brand || '—')}</td><td><span class="badge badge-outline">${esc(p.category || '—')}</span></td><td class="td-mono">${esc(p.sku || '—')}</td><td>${esc(p.unit || '—')}</td><td style="font-weight:600;">${p.price != null ? '฿' + fmtNum(p.price) : '—'}</td><td>-</td></tr>`).join('');
  } catch (e) { }
}
window.openProductModal = function () { toast("Feature in development"); }

async function loadPrices() {
  const tbody = document.getElementById('price-tbody');
  if (!tbody) return;
  try {
    const res = await supa('price?select=*,products(product_name)&order=created_at.desc');
    allPrices = res.data || [];
    tbody.innerHTML = allPrices.map(p => `<tr><td class="td-mono">${esc(p.price_list_id)}</td><td><strong>${esc(p.products?.product_name || '—')}</strong><div class="td-muted">${esc(p.product_id)}</div></td><td>${esc(p.price_list || '—')}</td><td style="font-weight:600;text-align:right;">${p.including_vat != null ? '฿' + fmtNum(p.including_vat) : '—'}</td><td style="text-align:right;">${p.excluding_vat != null ? '฿' + fmtNum(p.excluding_vat) : '—'}</td><td style="text-align:right;">${p.rebate_percent != null ? p.rebate_percent + '%' : '—'}</td></tr>`).join('');
  } catch (e) { }
}
window.openPriceModal = function () { toast("Feature in development"); }

async function loadActivity() {
  const srch = document.getElementById('act-search').value.trim();
  document.getElementById('act-tbody').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-3);">Loading...</td></tr>';
  let q = 'activity_log?select=*,customers!activity_log_customer_id_fkey(outlet_name)&order=created_at.desc&limit=100';
  if (srch) q += `&customer_id=ilike.*${encodeURIComponent(srch)}*`;
  try {
    const res = await supa(q);
    allActivity = res.data || [];
    document.getElementById('act-meta').textContent = `${allActivity.length} records`;
    if (!allActivity.length) { document.getElementById('act-tbody').innerHTML = '<tr><td colspan="6"><div class="empty-state"><h3>No activity logs</h3></div></td></tr>'; return; }
    document.getElementById('act-tbody').innerHTML = allActivity.map(a => `<tr><td class="td-mono">${esc(a.log_id)}</td><td><strong>${esc(a.customer_information?.outlet_name || '—')}</strong><div class="td-muted">${esc(a.customer_id)}</div></td><td><span class="badge badge-outline">${esc(a.date_type || '—')}</span></td><td style="font-size:12px;max-width:200px;">${esc((a.note || '').substring(0, 80))}${(a.note || '').length > 80 ? '…' : ''}</td><td>${esc(a.created_by || '—')}</td><td class="td-mono">${fmtDate(a.created_at)}</td></tr>`).join('');
  } catch (e) { toast('Load activity failed', 'error'); }
}
window.openActivityModal = function () { document.getElementById('act-overlay').classList.add('open'); };
window.closeActivityModal = function () { document.getElementById('act-overlay').classList.remove('open'); };
window.saveActivity = async function () {
  const payload = { log_id: document.getElementById('alm-id').value.trim(), customer_id: document.getElementById('alm-customer').value.trim(), date_type: document.getElementById('alm-type').value, note: document.getElementById('alm-note').value.trim() };
  if (!payload.log_id || !payload.customer_id) return toast('Please fill required fields', 'error');
  try { await supa('activity_log', { method: 'POST', body: JSON.stringify(payload), prefer: 'return=minimal' }); toast('Log added'); closeActivityModal(); loadActivity(); }
  catch (e) { toast('Error: ' + e.message, 'error'); }
};


// ─── LIGHTBOX ───
window.openLightbox = function (url) {
  document.getElementById('lb-img').src = url;
  document.getElementById('lightbox').classList.add('open');
};
window.closeLightbox = function () { document.getElementById('lightbox').classList.remove('open'); };

// ─── GLOBAL SEARCH (Debounce Added) ───
const debouncedSearch = debounce(function () {
  const q = document.getElementById('global-search').value.trim();
  if (!q) return;
  showPage('customers');
  document.getElementById('cust-search').value = q;
  resetAndLoadCustomers();
}, 400);
window.globalSearch = debouncedSearch;

// ─── ESC KEY ───
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay.open').forEach(el => el.classList.remove('open'));
    if (typeof closeDetail === 'function') closeDetail();
    closeLightbox();
  }
});

// ═══════════════════════════════════════════
//  REALTIME ENGINE
// ═══════════════════════════════════════════
let _rtClient = null;
let _rtChannel = null;
let _rtPollingTimer = null;
let _rtLastActivity = null;
let _rtMode = null; // 'websocket' | 'polling'
let _rtStatus = 'disconnected'; // 'connecting' | 'live' | 'polling' | 'disconnected'

// ตารางที่ต้องการ watch และ handler ที่จะ refresh เมื่อมีการเปลี่ยนแปลง
const RT_WATCHED_TABLES = [
  { table: 'visitation', handler: _rtHandleVisitation },
  { table: 'delete_requests', handler: _rtHandleRequests },
  { table: 'activity_log', handler: _rtHandleActivity },
  { table: 'customer_information', handler: _rtHandleCustomers },
  { table: 'orders', handler: _rtHandleOrders },
];

function _rtHandleVisitation(payload) {
  _rtShowBadge('New visit recorded');
  const activePage = document.querySelector('.page.active');
  if (!activePage) return;
  const id = activePage.id;
  if (id === 'page-dashboard') loadDashboard();
  else if (id === 'page-field') {
    if (currentFieldTab === 'visits') loadVisits(visPage);
    else loadVisitation();
  }
}
function _rtHandleRequests(payload) {
  _rtShowBadge('Delete request updated');
  const activePage = document.querySelector('.page.active');
  if (!activePage) return;
  const id = activePage.id;
  if (id === 'page-dashboard') loadDashboard();
  else if (id === 'page-field' && currentFieldTab === 'visits') loadVisits(visPage);
  // อัปเดต badge ไม่ว่าจะอยู่หน้าไหน
  _rtUpdatePendingBadge();
}
function _rtHandleActivity(payload) {
  _rtShowBadge('Activity log updated');
  const activePage = document.querySelector('.page.active');
  if (!activePage) return;
  const id = activePage.id;
  if (id === 'page-dashboard') loadDashboard();
  else if (id === 'page-activity') loadActivity();
}
function _rtHandleCustomers(payload) {
  const activePage = document.querySelector('.page.active');
  if (!activePage) return;
  if (activePage.id === 'page-customers') loadCustomers(custPage);
  else if (activePage.id === 'page-dashboard') loadDashboard();
}
function _rtHandleOrders(payload) {
  const activePage = document.querySelector('.page.active');
  if (!activePage) return;
  if (activePage.id === 'page-offtake') loadOrders();
}

async function _rtUpdatePendingBadge() {
  try {
    const res = await supa('delete_requests?select=id,status&status=eq.pending');
    const count = (res.data || []).length;
    const dot = document.getElementById('notif-dot');
    const rb = document.getElementById('req-badge');
    const rp = document.getElementById('req-badge-pending');
    if (count > 0) {
      if (dot) dot.style.display = 'block';
      if (rb) { rb.textContent = count; rb.style.display = 'inline-block'; }
      if (rp) { rp.textContent = count; rp.style.display = 'inline'; }
    } else {
      if (dot) dot.style.display = 'none';
      if (rb) rb.style.display = 'none';
      if (rp) rp.style.display = 'none';
    }
  } catch (e) { }
}

function _rtSetStatus(status) {
  _rtStatus = status;
  const dot = document.getElementById('realtime-dot');
  const label = document.getElementById('realtime-label');
  const indicator = document.getElementById('realtime-indicator');
  if (!dot || !label || !indicator) return;
  indicator.style.display = 'flex';
  const styles = {
    live: { color: '#4CAF50', text: 'Live', anim: 'pulse-green' },
    polling: { color: '#F59E0B', text: 'Auto-sync', anim: '' },
    connecting: { color: '#9A9A90', text: 'Connecting…', anim: '' },
    disconnected: { color: '#EF4444', text: 'Offline', anim: '' },
  };
  const s = styles[status] || styles.disconnected;
  dot.style.background = s.color;
  label.textContent = s.text;
  // pulse animation สำหรับ live
  dot.style.boxShadow = status === 'live' ? `0 0 0 3px ${s.color}33` : 'none';
  dot.style.animation = status === 'live' ? 'rt-pulse 2s infinite' : 'none';
}

function _rtShowBadge(msg) {
  _rtLastActivity = new Date();
  // flash indicator
  const dot = document.getElementById('realtime-dot');
  if (dot) {
    dot.style.transform = 'scale(1.6)';
    setTimeout(() => { if (dot) dot.style.transform = 'scale(1)'; }, 300);
  }
  // toast เบาๆ
  toast('🔄 ' + msg, 'info');
}

function setupAdminRealtime() {
  if (!SUPA_URL || !SUPA_KEY) return;
  _rtSetStatus('connecting');

  // ลอง Supabase JS SDK Realtime ก่อน
  if (typeof supabase !== 'undefined' && supabase.createClient) {
    try {
      _rtClient = supabase.createClient(SUPA_URL, SUPA_KEY, {
        realtime: { params: { eventsPerSecond: 10 } }
      });
      _rtChannel = _rtClient.channel('admin-realtime');
      RT_WATCHED_TABLES.forEach(({ table, handler }) => {
        _rtChannel.on('postgres_changes', {
          event: '*', schema: 'public', table
        }, (payload) => {
          handler(payload);
          _rtUpdatePendingBadge();
        });
      });
      _rtChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          _rtMode = 'websocket';
          _rtSetStatus('live');
          console.log('[Admin Realtime] WebSocket connected ✓');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[Admin Realtime] WebSocket failed, switching to polling');
          _rtMode = null;
          _rtFallbackToPolling();
        }
      });
      // timeout fallback: ถ้า 8 วินาทียังไม่ SUBSCRIBED ให้ใช้ polling
      setTimeout(() => {
        if (_rtMode !== 'websocket') _rtFallbackToPolling();
      }, 8000);
      return;
    } catch (e) {
      console.warn('[Admin Realtime] SDK error:', e);
    }
  }
  // ไม่มี SDK → polling ทันที
  _rtFallbackToPolling();
}

function _rtFallbackToPolling() {
  if (_rtPollingTimer) return; // already polling
  _rtMode = 'polling';
  _rtSetStatus('polling');
  console.log('[Admin Realtime] Polling every 30s');
  _rtPollingTimer = setInterval(_rtPollRefresh, 30000);
}

async function _rtPollRefresh() {
  // refresh เฉพาะหน้าที่ active อยู่
  const activePage = document.querySelector('.page.active');
  if (!activePage) return;
  const id = activePage.id;
  const loaders = {
    'page-dashboard': loadDashboard,
    'page-field': () => currentFieldTab === 'visits' ? loadVisits(visPage) : loadVisitation(),
    'page-activity': loadActivity,
    'page-customers': () => loadCustomers(custPage),
    'page-contracts': loadContracts,
    'page-offtake': loadOrders,
  };
  if (loaders[id]) {
    try { await loaders[id](); } catch (e) { }
  }
  _rtUpdatePendingBadge();
}

function teardownAdminRealtime() {
  if (_rtChannel) { try { _rtChannel.unsubscribe(); } catch (e) { } _rtChannel = null; }
  if (_rtClient) { _rtClient = null; }
  if (_rtPollingTimer) { clearInterval(_rtPollingTimer); _rtPollingTimer = null; }
  _rtMode = null;
  _rtSetStatus('disconnected');
}

// inject CSS animation สำหรับ pulse dot
(function injectRtStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes rt-pulse {
      0%   { box-shadow: 0 0 0 0px rgba(76,175,80,.5); }
      70%  { box-shadow: 0 0 0 6px rgba(76,175,80,0); }
      100% { box-shadow: 0 0 0 0px rgba(76,175,80,0); }
    }
    #realtime-indicator { user-select: none; }
    #realtime-dot { transition: transform .2s, background .3s; }
  `;
  document.head.appendChild(style);
})();
