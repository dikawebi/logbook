const app = document.getElementById('app');
const dialog = document.getElementById('dialog');
const optionMenu = document.createElement('div');
optionMenu.id = 'option-menu';
document.body.appendChild(optionMenu);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const state = { user: null, view: 'Dashboard', page: 1, filters: {}, rows: [], names: [], users: [] };
function readStored(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function saveStored(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
const pageSizes = [10, 25, 50, 100, 200, 300, 400, 500, 1000];
const storedPerPage = readStored('logbook-per-page');
state.perPage = storedPerPage === 'all' || pageSizes.includes(Number(storedPerPage)) ? (storedPerPage === 'all' ? 'all' : Number(storedPerPage)) : 'all';
function restoreListingUrl() {
  const query = new URLSearchParams(location.search), view = query.get('view');
  if (!['IDR', 'USD'].includes(view)) return;
  state.view = view;
  state.page = Math.max(1, Number(query.get('page')) || 1);
  const perPage = query.get('perPage');
  if (perPage === 'all' || pageSizes.includes(Number(perPage))) state.perPage = perPage === 'all' ? 'all' : Number(perPage);
  try { const filters = JSON.parse(query.get('filters') || '{}'); if (filters && typeof filters === 'object' && !Array.isArray(filters)) state.filters = filters; } catch (_) {}
}
function syncListingUrl(data = null) {
  if (!['IDR', 'USD'].includes(state.view)) return history.replaceState(null, '', location.pathname);
  if (data) state.page = data.page;
  const query = new URLSearchParams({ view: state.view, page: String(state.page), perPage: String(state.perPage) });
  if (Object.keys(state.filters).length) query.set('filters', JSON.stringify(state.filters));
  history.replaceState(null, '', `${location.pathname}?${query}`);
}
function sidebarCollapsed() { return readStored('logbook-sidebar-collapsed') === 'true'; }
function visibleColumns() {
  const raw = readStored('logbook-columns-' + state.view);
  const all = columnIds().concat('status');
  if (!raw) return new Set(all);
  try {
    const selected = JSON.parse(raw);
    const values = Array.isArray(selected) && selected.length ? selected.filter(value => all.includes(String(value))).map(String) : all;
    // Show the newly introduced local field for users with a saved pre-multiplier column preference.
    if (!values.includes(vatMultiplierColumn)) values.push(vatMultiplierColumn);
    return new Set(values);
  } catch (_) { return new Set(all); }
}
function orderedColumns() {
  const all = columnIds().concat('status');
  try {
    const saved = JSON.parse(readStored('logbook-column-order-' + state.view) || '[]');
    if (!Array.isArray(saved) || !saved.length) return all;
    const order = [...new Set(saved.map(String).filter(id => all.includes(id)))];
    order.splice(order.indexOf(vatMultiplierColumn), 1);
    order.splice(Math.max(0, order.indexOf('17')), 0, vatMultiplierColumn);
    return [...new Set(order.concat(all))];
  } catch (_) { return all; }
}
function applyColumnOrder(order = orderedColumns()) {
  document.querySelectorAll('.sheet-table tr, .amount-summary-row').forEach(row => {
    const action = row.querySelector('.sticky-actions, .summary-actions');
    if (!action) return;
    order.forEach(id => {
      const cell = row.querySelector(`[data-column-id="${id}"]`);
      if (cell) row.insertBefore(cell, action);
    });
  });
}
function columnWidths() {
  try {
    const widths = JSON.parse(readStored('logbook-column-widths-' + state.view) || '{}');
    return widths && typeof widths === 'object' && !Array.isArray(widths) ? widths : {};
  } catch (_) { return {}; }
}
function setColumnWidth(id, width) {
  document.querySelectorAll(`[data-column-id="${id}"]`).forEach(cell => {
    cell.style.width = `${width}px`; cell.style.minWidth = `${width}px`; cell.style.maxWidth = `${width}px`;
  });
}
function applyColumnWidths(widths = columnWidths()) {
  Object.entries(widths).forEach(([id, width]) => {
    if (/^(?:[0-9]|[12][0-9]|3[01]|vatMultiplier|status)$/.test(id) && Number.isFinite(Number(width))) setColumnWidth(id, Math.max(100, Math.min(2000, Number(width))));
  });
}
function bindColumnResize() {
  document.querySelectorAll('.column-resizer').forEach(handle => handle.onpointerdown = event => {
    event.preventDefault(); event.stopPropagation();
    const id = handle.dataset.resize, startX = event.clientX;
    const startWidth = handle.closest('th').getBoundingClientRect().width;
    const move = moveEvent => setColumnWidth(id, Math.max(100, Math.min(2000, startWidth + moveEvent.clientX - startX)));
    const finish = finishEvent => {
      const width = Math.round(Math.max(100, Math.min(2000, startWidth + finishEvent.clientX - startX)));
      const widths = columnWidths(); widths[id] = width;
      saveStored('logbook-column-widths-' + state.view, JSON.stringify(widths));
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish);
  });
}
function bindColumnDrag() {
  let dragging = '';
  document.querySelectorAll('.sheet-table thead tr:first-child th[data-column-id]').forEach(header => {
    header.draggable = true;
    header.title = 'Geser untuk mengubah urutan kolom.';
    header.ondragstart = event => {
      dragging = header.dataset.columnId;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragging);
      header.classList.add('column-dragging');
    };
    header.ondragend = () => document.querySelectorAll('.column-dragging, .column-drag-over').forEach(item => item.classList.remove('column-dragging', 'column-drag-over'));
    header.ondragover = event => {
      if (dragging && dragging !== header.dataset.columnId) { event.preventDefault(); header.classList.add('column-drag-over'); }
    };
    header.ondragleave = () => header.classList.remove('column-drag-over');
    header.ondrop = event => {
      event.preventDefault();
      const source = dragging || event.dataTransfer.getData('text/plain');
      const target = header.dataset.columnId;
      if (!source || source === target) return;
      const order = orderedColumns().filter(id => id !== source);
      order.splice(order.indexOf(target), 0, source);
      saveStored('logbook-column-order-' + state.view, JSON.stringify(order));
      applyColumnOrder(order);
      header.classList.remove('column-drag-over');
    };
  });
}
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const amountColumns = new Set([11, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25]);
const dateColumns = new Set([0, 1, 2, 6, 8, 10, 27, 31]);
const formulaColumns = new Set([13, 17, 22, 24, 25, 27]);
const vatMultiplierColumn = 'vatMultiplier';
function columnIds() { return [...Array(17).keys()].map(String).concat(vatMultiplierColumn, [...Array(15).keys()].map(index => String(index + 17))); }
function columnName(column) { return column === vatMultiplierColumn ? 'VAT in multiplier' : state.names[Number(column)]; }
function vatMultiplierLabel(value) { return Number(value) === 0.011 ? '1.1%' : '11%'; }
function recordValue(record, column) { return column === vatMultiplierColumn ? vatMultiplierLabel(record.vatMultiplier) : (record.data[Number(column)] ?? ''); }
const amountFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formulaNumber(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  const normalized = /^\(.*\)$/.test(text) ? '-' + text.slice(1, -1) : text;
  return Number.isFinite(Number(normalized)) ? Number(normalized) : 0;
}
function formulaPercent(value) {
  const text = String(value ?? '').trim();
  return text.endsWith('%') ? formulaNumber(text.slice(0, -1)) / 100 : formulaNumber(text);
}
function formulaInteger(value) { return String(value < 0 ? -Math.round(-value) : Math.round(value)); }
function formulaDueDate(invoiceDate, paymentTerm) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(invoiceDate))) return '';
  const date = new Date(`${invoiceDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.trunc(formulaNumber(paymentTerm))));
  return date.toISOString().slice(0, 10);
}
function applyRecordFormulas(data, vatMultiplier = 0.11) {
  const values = Array.from({ length: 32 }, (_, index) => String(data[index] ?? ''));
  values[13] = state.view === 'IDR'
    ? (!values[5] && !values[12] ? '' : `${values[5]}; ${values[12]}`)
    : (!values[5] && !values[4] && !values[12] ? '' : `${values[5]}; ${values[4]}; ${values[12]}`);
  values[17] = formulaInteger(formulaNumber(values[16]) * vatMultiplier);
  if (state.view === 'IDR') values[22] = formulaInteger(Array.from({ length: 7 }, (_, index) => formulaNumber(values[index + 15])).reduce((sum, value) => sum + value, 0));
  else {
    values[22] = formulaInteger(formulaNumber(values[15]));
    values[24] = formulaInteger(-formulaPercent(values[14]) * (formulaNumber(values[15]) + formulaNumber(values[16])));
  }
  values[25] = formulaInteger(formulaNumber(values[22]) + formulaNumber(values[24]));
  values[27] = formulaDueDate(values[6], values[26]);
  return values;
}
function formatCell(value, index) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (amountColumns.has(index)) {
    const numeric = text.replace(/,/g, '');
    const negative = /^\(.*\)$/.test(numeric);
    const number = Number(negative ? numeric.slice(1, -1) : numeric);
    if (Number.isFinite(number)) return esc(amountFormatter.format(negative ? -number : number));
  }
  if (dateColumns.has(index) && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-');
    const shortMonth = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1];
    if (shortMonth) return esc(`${Number(day)}-${shortMonth}-${year.slice(-2)}`);
  }
  return esc(text);
}
function invoiceSummary(record, data) {
  const status = record.cancelled ? 'Dibatalkan' : (data[30] || 'Belum diisi');
  const overdue = record.overdue ? `${record.overdueDays} hari terlambat` : 'Tidak terlambat';
  const fields = [
    ['Invoice', data[5]], ['Vendor', data[4]], ['Status', status], ['Invoiced amount', formatCell(data[22], 22)],
    ['VAT Prepaid', formatCell(data[18], 18)], ['Withholding tax', formatCell(data[24], 24)], ['Net payment', formatCell(data[25], 25)],
    ['Due date', formatCell(data[27], 27)], ['Overdue', overdue]
  ];
  return `<section class="invoice-summary" aria-label="Ringkasan invoice"><div class="invoice-summary-heading"><span>RINGKASAN INVOICE</span>${record.overdue ? '<b class="overdue-flag">OVERDUE</b>' : ''}</div><div class="invoice-summary-grid">${fields.map(([label, value]) => `<div><small>${esc(label)}</small><strong>${value || 'Belum diisi'}</strong></div>`).join('')}</div></section>`;
}
const toast = (message, error = false) => {
  const el = document.getElementById('toast'); el.textContent = message;
  el.className = error ? 'error' : ''; el.style.display = 'block';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.style.display = 'none', 6000);
};
async function api(action, payload = null, params = {}) {
  const query = new URLSearchParams({ api: action, ...params });
  const response = await fetch('/index.php?' + query, { credentials: 'same-origin',
    ...(payload === null ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(payload) }) });
  const body = await response.text();
  let result;
  try { result = JSON.parse(body); } catch (_) { throw new Error('Respons server tidak valid. Periksa log error PHP.'); }
  if (!result.ok) throw new Error(result.error || 'Permintaan gagal.');
  return result.data;
}
async function safely(job) {
  try { await job(); } catch (error) {
    toast(error.message, true);
    if (/Sesi habis|Silakan login terlebih dahulu/.test(error.message)) { state.user = null; loginPage(); }
  }
}
function brandMarkup() {
  return `<a class="brand" href="/" aria-label="Kembali ke Dashboard Logbook"><img src="/images/logo-bp.svg" alt="Logo PT Borneo Prima"><span><strong>PT BORNEO PRIMA</strong><small>Accounting Logbook</small></span></a>`;
}
function bindThemeToggle(id) {
  const button = document.getElementById(id);
  if (!button) return;
  const update = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    button.textContent = dark ? '☀ Mode Terang' : '☾ Mode Gelap';
    button.setAttribute('aria-label', dark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
  };
  button.onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('logbook-theme', next); } catch (_) {}
    update();
  };
  update();
}
function loginPage() {
  app.innerHTML = `<div class="login-layout"><section class="login-form-side"><button type="button" class="theme-toggle login-theme" id="theme-login"></button><div class="login-inner">${brandMarkup()}
    <h1>Selamat Datang</h1><p class="login-subtitle">Masuk untuk mengelola logbook invoice PT Borneo Prima — rapi, akurat, dan terpantau.</p>
    <form id="login" class="stack"><label>Alamat email<input name="email" type="email" placeholder="nama@borneoprima.com" required autocomplete="username"></label>
    <label>Kata sandi<input name="password" type="password" placeholder="Masukkan kata sandi" required autocomplete="current-password"></label>
    <p id="login-error" class="login-error" role="alert" hidden></p>
    <button class="login-submit">Masuk ke Dashboard →</button></form>
    <p class="login-caption">Portal internal — khusus karyawan PT Borneo Prima.</p></div></section>
    <aside class="login-visual"><div class="login-visual-content"><div class="login-feature"><span class="feature-icon">▤</span><div><b>Logbook IDR &amp; USD</b><span>Pantau invoice dan transaksi dalam satu aplikasi.</span></div></div>
    <div class="login-feature"><span class="feature-icon">◷</span><div><b>Status Pembayaran</b><span>Temukan data berdasarkan vendor, kategori, dan status.</span></div></div>
    <div class="login-feature"><span class="feature-icon">▣</span><div><b>Audit Trail</b><span>Setiap perubahan transaksi tercatat dan dapat ditelusuri.</span></div></div>
    <div class="login-visual-foot"><span>Kunjungi website utama perusahaan</span><a href="https://borneoprima.com/" target="_blank" rel="noopener noreferrer">borneoprima.com ↗</a></div></div></aside></div>`;
  bindThemeToggle('theme-login');
  document.getElementById('login').onsubmit = async event => {
    event.preventDefault(); const form = event.target, button = form.querySelector('button'); button.disabled = true;
    const errorBox = document.getElementById('login-error'); errorBox.hidden = true; errorBox.textContent = '';
    try {
      state.user = await api('login', { email: form.elements.email.value, password: form.elements.password.value });
      if (state.user.mustChange) passwordPage(true); else { shell(); await load(); }
    } catch (error) {
      errorBox.textContent = error.message; errorBox.hidden = false;
    } finally { button.disabled = false; }
  };
}
function shell() {
  const links = [
    ['Dashboard', '⌂', 'Dashboard'], ['IDR', '▤', 'Logbook IDR'], ['USD', '▤', 'Logbook USD'], ['Audit', '◷', 'Audit Trail'],
    ...(state.user.role === 'ADMIN' ? [['Users', '♙', 'Manajemen Akses'], ['Sync', '↻', 'Sinkronisasi'], ['Settings', '⚙', 'Pengaturan Sync']] : []),
    ['Password', '⚙', 'Ganti Password']
  ];
  app.innerHTML = `<div class="app-shell ${sidebarCollapsed() ? 'sidebar-collapsed' : ''}"><header class="app-topbar">${brandMarkup()}
    <div class="topbar-user"><button class="theme-toggle" type="button" id="theme-app"></button><span>${esc(state.user.email)}</span><span class="user-avatar" title="${esc(state.user.role)}">${esc(state.user.email.slice(0, 2).toUpperCase())}</span>
    <button id="logout" class="secondary">Keluar</button></div></header>
    <aside class="app-sidebar"><div class="sidebar-heading"><p class="sidebar-label">WORKSPACE</p><button class="sidebar-toggle" type="button" id="sidebar-toggle" aria-label="Ciutkan sidebar" title="Ciutkan sidebar">☰</button></div><nav>${links.map(([view, icon, label]) => `<button data-view="${view}"><span class="sidebar-icon" aria-hidden="true">${icon}</span>${label}</button>`).join('')}</nav>
    <div class="sidebar-foot">PT BORNEO PRIMA<br><small>Accounting Logbook</small></div></aside>
    <div class="app-content"><main id="main"></main></div></div>`;
  bindThemeToggle('theme-app');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const updateSidebarToggle = collapsed => {
    sidebarToggle.setAttribute('aria-label', collapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar');
    sidebarToggle.title = collapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar';
  };
  updateSidebarToggle(sidebarCollapsed());
  sidebarToggle.onclick = () => {
    const shell = document.querySelector('.app-shell');
    const collapsed = shell.classList.toggle('sidebar-collapsed');
    saveStored('logbook-sidebar-collapsed', String(collapsed));
    updateSidebarToggle(collapsed);
  };
  document.getElementById('logout').onclick = () => safely(async () => { await api('logout', {}); state.user = null; loginPage(); });
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => safely(async () => {
    closeOptions(); state.view = button.dataset.view; state.page = 1; state.filters = {}; await load();
  }));
}
async function load() {
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  document.getElementById('main').classList.remove('records-workspace');
  document.onfullscreenchange = null;
  if (state.view === 'Password') return passwordPage(false);
  const main = document.getElementById('main'); main.innerHTML = '<section class="card">Memuat...</section>';
  if (state.view === 'Dashboard') return dashboardPage(await api('dashboard'));
  if (state.view === 'Sync') return syncPage(await api('sync-errors'));
  if (state.view === 'Settings') return settingsPage(await api('sync-settings'));
  if (state.view === 'Users') return usersPage(await api('users'));
  if (state.view === 'Audit') return auditPage(await api('audit', null, { page: state.page }));
  const data = await api('list', null, { currency: state.view, page: state.page, perPage: state.perPage, ...state.filters });
  state.rows = data.rows; state.names = data.names; syncListingUrl(data); recordsPage(data);
}
function dashboardPage(data) {
  const userName = state.user.email.split('@')[0].split(/[._-]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  document.getElementById('main').innerHTML = `<div class="page-heading"><span class="eyebrow">OVERVIEW</span><h1>Dashboard</h1><p>Ringkasan logbook invoice PT Borneo Prima.</p></div>
    <div class="dashboard-hero card"><div class="dashboard-avatar">${esc(state.user.email.slice(0, 2).toUpperCase())}</div><div><small>Selamat datang kembali</small><h2>${esc(userName)}</h2><p>Kelola transaksi IDR dan USD dari satu tempat.</p></div>
    <button class="secondary" id="dashboard-signout">Keluar</button></div>
    <div class="summary-grid">${[
      ['Jumlah baris transaksi IDR', data.IDR.total, 'Baris transaksi dalam Rupiah', 'IDR'],
      ['Jumlah baris transaksi USD', data.USD.total, 'Baris transaksi dalam Dollar', 'USD'],
      ['Belum dibayar IDR', data.IDR.blank || 0, 'Perlu ditindaklanjuti', 'IDR', 'blank'],
      ['Belum dibayar USD', data.USD.blank || 0, 'Perlu ditindaklanjuti', 'USD', 'blank'],
      ['Overdue IDR', data.IDR.overdue || 0, 'Aktif dan belum dibayar', 'IDR', 'overdue'],
      ['Overdue USD', data.USD.overdue || 0, 'Aktif dan belum dibayar', 'USD', 'overdue']
    ].map(([label, count, sub, view, status = '']) => `<button class="summary-card card" data-quick="${view}" data-quick-status="${status}"><span>${esc(label)}</span><strong>${new Intl.NumberFormat('en-US').format(count)}</strong><small>${esc(sub)} ↗</small></button>`).join('')}</div>
    <h2 class="section-title">Akses cepat</h2><div class="quick-grid"><button class="quick-card card" data-quick="IDR"><span class="quick-icon">▤</span><span><strong>Logbook IDR</strong><small>Lihat & kelola transaksi Rupiah</small></span>→</button>
    <button class="quick-card card" data-quick="USD"><span class="quick-icon green-icon">▤</span><span><strong>Logbook USD</strong><small>Lihat & kelola transaksi Dollar</small></span>→</button>
    <button class="quick-card card" data-quick="Audit"><span class="quick-icon dark-icon">◷</span><span><strong>Audit Trail</strong><small>Riwayat perubahan data</small></span>→</button></div>`;
  document.getElementById('dashboard-signout').onclick = () => safely(async () => { await api('logout', {}); state.user = null; loginPage(); });
  document.querySelectorAll('[data-quick]').forEach(button => button.onclick = () => safely(async () => {
    state.view = button.dataset.quick; state.page = 1; state.filters = button.dataset.quickStatus ? { status: button.dataset.quickStatus } : {}; await load();
  }));
}
function pager(data) {
  if (data.perPage === 'all') return `<div class="pager"><span>Menampilkan seluruh ${data.total} data</span></div>`;
  const blockStart = Math.max(1, data.page - 5);
  const blockEnd = Math.min(data.pages, data.page + 5);
  const middle = Array.from({ length: blockEnd - blockStart + 1 }, (_, index) => blockStart + index)
    .filter(page => page !== 1 && page !== data.pages)
    .map(page => `<button class="pager-page ${page === data.page ? 'active' : ''}" data-page="${page}" ${page === data.page ? 'disabled' : ''}>${page}</button>`).join('');
  const first = `<button class="pager-page ${data.page === 1 ? 'active' : ''}" data-page="1" ${data.page === 1 ? 'disabled' : ''}>1</button>`;
  const before = blockStart > 2 ? '<span class="pager-ellipsis">…</span>' : '';
  const after = blockEnd < data.pages - 1 ? '<span class="pager-ellipsis">…</span>' : '';
  const final = data.pages > 1 ? `<button class="pager-page ${data.page === data.pages ? 'active' : ''}" data-page="${data.pages}" ${data.page === data.pages ? 'disabled' : ''}>${data.pages}</button>` : '';
  return `<div class="pager"><div class="pager-pages" aria-label="Navigasi halaman">${first}${before}${middle}${after}${final}</div><label class="pager-jump">Menuju ke halaman <input id="page-jump" type="number" min="1" max="${data.pages}" value="${data.page}" aria-label="Menuju ke halaman"></label><span>${data.total} data</span></div>`;
}
function attachPager() {
  const go = page => safely(async () => { state.page = page; await load(); });
  const jump = document.getElementById('page-jump');
  if (!jump) return;
  document.querySelectorAll('.pager-page').forEach(button => button.onclick = () => go(Number(button.dataset.page)));
  jump.onchange = () => go(Math.max(1, Math.min(Number(jump.max), Number(jump.value) || 1)));
  jump.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); jump.onchange(); } };
}
function tableFilters() {
  const mainFilters = Object.fromEntries(new FormData(document.getElementById('filters')));
  const columns = Object.fromEntries([...document.querySelectorAll('.column-search')]
    .filter(input => input.value.trim() !== '').map(input => [input.name, input.value]));
  const retained = Object.fromEntries(Object.entries(state.filters).filter(([key]) => ['from', 'to', 'category', 'status', 'dueFrom', 'dueTo'].includes(key)));
  const selected = Object.fromEntries(Object.entries(state.filters).filter(([key]) => /^s(?:[0-9]|[12][0-9]|3[01]|VatMultiplier|Status)$/.test(key)));
  return { ...retained, ...mainFilters, ...columns, ...selected, sort: state.filters.sort || '', direction: state.filters.direction || '' };
}
function selectionKey(column) { return 's' + (column === 'status' ? 'Status' : column); }
function selectedValues(column) {
  try { return JSON.parse(state.filters[selectionKey(column)] || '[]'); } catch (_) { return []; }
}
let optionsVersion = 0;
function closeOptions() { optionsVersion++; optionMenu.classList.remove('open'); optionMenu.innerHTML = ''; }
document.addEventListener('pointerdown', event => {
  if (!optionMenu.contains(event.target) && !event.target.closest('[data-options]')) closeOptions();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeOptions(); });
async function showOptions(column, anchor) {
  const version = optionsVersion;
  const name = column === 'status' ? 'App Status' : columnName(column);
  const rect = anchor.getBoundingClientRect();
  optionMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 320))}px`;
  optionMenu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - Math.min(400, window.innerHeight * 0.7) - 8))}px`;
  optionMenu.classList.add('open');
  optionMenu.innerHTML = `<div class="option-menu-heading"><strong>${esc(name)}</strong><button type="button" class="secondary" id="options-close" aria-label="Tutup daftar">×</button></div>
    <input id="options-query" type="search" placeholder="Cari pilihan..." aria-label="Cari pilihan ${esc(name)}">
    <p class="option-help">Pilih beberapa nilai; salah satunya akan cocok.</p><div id="options-list" class="options-list">Memuat...</div>`;
  optionMenu.querySelector('#options-close').onclick = closeOptions;
  let request = 0, debounce;
  async function fetchOptions() {
    if (version !== optionsVersion || !optionMenu.classList.contains('open')) return;
    const current = ++request, query = optionMenu.querySelector('#options-query').value;
    optionMenu.querySelector('#options-list').textContent = 'Memuat...';
    const result = await api('options', null, { currency: state.view, column, q: query, filters: JSON.stringify(tableFilters()) });
    if (current !== request || version !== optionsVersion || !optionMenu.classList.contains('open')) return;
    renderOptions(result);
  }
  function renderOptions(result) {
    const chosen = selectedValues(column);
    const values = [...new Set([...chosen, ...result.values])];
    optionMenu.querySelector('.option-help').textContent = `${result.values.length} pilihan sesuai filter lain. Centang beberapa nilai; salah satunya akan cocok.`;
    optionMenu.querySelector('#options-list').innerHTML = `${values.length ? values.map(value => `<label class="option-row"><input type="checkbox" value="${esc(value)}" ${chosen.includes(value) ? 'checked' : ''}>
      <span title="${esc(value)}">${value === '' ? '<em>(Kosong)</em>' : column === 'status' ? esc(value) : formatCell(value, Number(column))}</span></label>`).join('') : '<p class="muted">Tidak ada pilihan.</p>'}`;
    optionMenu.querySelectorAll('.option-row input').forEach(checkbox => checkbox.onchange = () => safely(async () => {
      const values = new Set(selectedValues(column));
      if (checkbox.checked) values.add(checkbox.value); else values.delete(checkbox.value);
      if (values.size > 30) { checkbox.checked = false; throw new Error('Maksimal 30 nilai per kolom.'); }
      state.filters = tableFilters();
      if (values.size) state.filters[selectionKey(column)] = JSON.stringify([...values]);
      else delete state.filters[selectionKey(column)];
      state.page = 1;
      await load();
      if (version === optionsVersion && optionMenu.classList.contains('open')) renderOptions(result);
    }));
  }
  optionMenu.querySelector('#options-query').oninput = () => {
    clearTimeout(debounce); debounce = setTimeout(() => safely(fetchOptions), 350);
  };
  await fetchOptions();
  optionMenu.querySelector('#options-query').focus();
}
function newRecordField(index, value) {
  if (index === vatMultiplierColumn) return `<select class="new-record-field" data-new-column="${index}" aria-label="VAT in multiplier"><option value="0.011" ${Number(value) === 0.011 ? 'selected' : ''}>1.1%</option><option value="0.11" ${Number(value) === 0.11 ? 'selected' : ''}>11%</option></select>`;
  index = Number(index);
  const vendorCode = index === 3, vendorName = index === 4;
  if (formulaColumns.has(index)) return `<input class="new-record-field formula-field" data-new-column="${index}" type="${dateColumns.has(index) ? 'date' : 'text'}" value="${esc(value)}" aria-label="${esc(state.names[index])}" readonly>`;
  if (index === 30) return `<select class="new-record-field history-field" data-new-column="${index}" data-history-column="${index}" aria-label="${esc(state.names[index])}"><option value="">Kosong</option>${value ? `<option value="${esc(value)}" selected>${esc(value)}</option>` : ''}</select>`;
  if ([23, 26, 28].includes(index)) return `<input class="new-record-field history-field" data-new-column="${index}" data-history-column="${index}" list="history-options-${index}" type="text" value="${esc(value)}" aria-label="${esc(state.names[index])}">`;
  const type = dateColumns.has(index) ? 'date' : 'text';
  return `<input class="new-record-field ${vendorCode || vendorName ? 'new-vendor-field' : ''}" data-new-column="${index}" ${vendorCode ? 'data-new-vendor="code" list="new-vendor-codes"' : ''}${vendorName ? 'data-new-vendor="name" list="new-vendor-names"' : ''} type="${type}" value="${esc(value)}" aria-label="${esc(state.names[index])}">`;
}
let vendorSuggestionTimer;
async function refreshHistoryFields() {
  const columns = [23, 26, 28, 30];
  const results = await Promise.all(columns.map(column => api('options', null, { currency: state.view, column })));
  columns.forEach((column, index) => {
    const field = document.querySelector(`.history-field[data-history-column="${column}"]`);
    if (!field) return;
    const selected = field.value;
    const values = [...new Set([selected, ...results[index].values])].filter(value => value !== '');
    if (field instanceof HTMLSelectElement) field.innerHTML = `<option value="">Kosong</option>${values.map(value => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('')}`;
    else {
      const list = document.getElementById(`history-options-${column}`);
      if (list) list.innerHTML = values.map(value => `<option value="${esc(value)}"></option>`).join('');
    }
  });
}
function refreshNewRecordFormulas() {
  state.newRecord = applyRecordFormulas(state.newRecord, state.newVatMultiplier);
  formulaColumns.forEach(column => {
    const field = document.querySelector(`.new-record-field[data-new-column="${column}"]`);
    if (field) field.value = state.newRecord[column];
  });
}
async function refreshVendorSuggestions(code, name, query = '') {
  const result = await api('vendors', null, { currency: state.view, code, name, q: query });
  const codes = [...new Set(result.pairs.map(pair => pair.code))];
  const names = [...new Set(result.pairs.map(pair => pair.name))];
  const codeList = document.getElementById('new-vendor-codes');
  const nameList = document.getElementById('new-vendor-names');
  if (codeList) codeList.innerHTML = codes.map(value => `<option value="${esc(value)}"></option>`).join('');
  if (nameList) nameList.innerHTML = names.map(value => `<option value="${esc(value)}"></option>`).join('');
  return result.pairs;
}
function displayedAmountSummary(data, visible) {
  return `<tfoot><tr class="summary-row" aria-label="Total nominal ${data.rows.length} data yang tampil">${columnIds().map(column => {
    if (column === vatMultiplierColumn) return `<td data-column-id="${column}" ${visible.has(column) ? '' : 'hidden'}></td>`;
    const total = data.rows.reduce((sum, row) => sum + formulaNumber(row.data[column]), 0);
    const index = Number(column);
    return `<td class="${amountColumns.has(index) ? 'amount' : ''}" data-column-id="${column}" ${visible.has(String(column)) ? '' : 'hidden'}>${amountColumns.has(index) ? formatCell(total, index) : ''}</td>`;
  }).join('')}<td data-column-id="status" ${visible.has('status') ? '' : 'hidden'}></td><td class="sticky-actions">Total ${data.rows.length} data</td></tr></tfoot>`;
}
function recordsPage(data) {
  const visible = visibleColumns();
  const columns = columnIds();
  document.getElementById('main').classList.add('records-workspace');
  document.getElementById('main').innerHTML = `<section class="card"><div class="toolbar"><h2>Transaksi ${state.view}</h2><div><button type="button" class="secondary" id="export-excel">Export Excel</button><button id="add">+ Tambah transaksi</button></div></div>
    <div class="display-controls"><button type="button" class="secondary" id="fullscreen-table">Layar penuh</button><button type="button" class="secondary" data-preset="blank">Belum dibayar</button><button type="button" class="secondary" data-preset="due">Jatuh tempo 7 hari</button><button type="button" class="secondary" data-preset="cancelled">Dibatalkan</button>
    <details class="column-picker"><summary>Kolom ditampilkan <span id="column-count">(${visible.size}/34)</span></summary>
    <div class="column-picker-grid">${[...columns.map(id => [id, columnName(id)]), ['status', 'App Status']].map(([id, name]) => `<label><input type="checkbox" class="visible-column" value="${esc(id)}" ${visible.has(id) ? 'checked' : ''}>${esc(name)}</label>`).join('')}</div></details>
    <form id="filters" class="filters compact-filters"><label>Cari semua kolom<input name="keyword" value="${esc(state.filters.keyword)}" placeholder="Contoh: Borneo fuel"></label><button>Terapkan</button><button type="button" class="secondary" id="clear-filters">Hapus filter</button></form></div></section>
    <section class="card records-card"><p class="muted listing-help">Geser tabel ke kanan untuk melihat seluruh 32 kolom Sheet dan VAT in multiplier lokal. Dua kolom awal dan aksi tetap terlihat saat digeser. Klik dua kali sel transaksi aktif untuk mengubahnya langsung. Pisahkan kata kunci dengan spasi (semua harus cocok); gunakan tanda kutip untuk frasa, misalnya <strong>"PT Borneo" fuel</strong>.</p>
    <div class="scroll sheet-scroll"><table class="sheet-table"><thead><tr>${columns.map(id => `<th data-column-id="${id}" ${visible.has(id) ? '' : 'hidden'}><button class="sort-column" data-sort="${id}" title="Urutkan ${esc(columnName(id))}" aria-label="Urutkan ${esc(columnName(id))}">${esc(columnName(id))} ${state.filters.sort === id ? state.filters.direction === 'DESC' ? '▼' : '▲' : '↕'}</button><span class="column-resizer" data-resize="${id}" title="Tarik untuk mengatur lebar kolom"></span></th>`).join('')}
    <th data-column-id="status" ${visible.has('status') ? '' : 'hidden'}><button class="sort-column" data-sort="status" title="Urutkan App Status">App Status ${state.filters.sort === 'status' ? state.filters.direction === 'DESC' ? '▼' : '▲' : '↕'}</button><span class="column-resizer" data-resize="status" title="Tarik untuk mengatur lebar kolom"></span></th><th class="sticky-actions">Aksi</th></tr>
    <tr class="search-row">${columns.map(id => `<th data-column-id="${id}" ${visible.has(id) ? '' : 'hidden'}><div class="column-filter"><input class="column-search" name="c${id === vatMultiplierColumn ? 'VatMultiplier' : id}" aria-label="Cari ${esc(columnName(id))}" placeholder="Kata kunci..." value="${esc(state.filters['c' + (id === vatMultiplierColumn ? 'VatMultiplier' : id)])}">
      <button type="button" class="option-trigger ${selectedValues(id).length ? 'has-selection' : ''}" data-options="${id}" title="Pilih nilai ${esc(columnName(id))}" aria-label="Pilih nilai ${esc(columnName(id))}">▾${selectedValues(id).length || ''}</button></div></th>`).join('')}
    <th data-column-id="status" ${visible.has('status') ? '' : 'hidden'}><div class="column-filter"><input class="column-search" name="cStatus" aria-label="Cari App Status" placeholder="Kata kunci..." value="${esc(state.filters.cStatus)}">
      <button type="button" class="option-trigger ${selectedValues('status').length ? 'has-selection' : ''}" data-options="status" title="Pilih App Status" aria-label="Pilih App Status">▾${selectedValues('status').length || ''}</button></div></th><th class="sticky-actions"></th></tr></thead><tbody>
    ${state.newRecord ? `<tr class="new-record-row">${columns.map(col => `<td data-column-id="${col}" ${visible.has(col) ? '' : 'hidden'}>${newRecordField(col, col === vatMultiplierColumn ? state.newVatMultiplier : state.newRecord[col])}</td>`).join('')}<td data-column-id="status" ${visible.has('status') ? '' : 'hidden'}><span class="badge gray">Baru</span></td><td class="actions sticky-actions"><button type="button" id="save-new-record">Simpan</button><button type="button" class="secondary" id="cancel-new-record">Batal</button><p id="new-record-error" class="inline-error" role="alert" hidden></p></td></tr>` : ''}
    ${data.rows.length ? data.rows.map((r, i) => `<tr class="${r.cancelled ? 'cancelled-row' : ''}${r.overdue ? ' overdue-row' : ''}">${columns.map(col => {
       const raw = r.cancelled && col === '30' ? 'Invoice Cancel' : recordValue(r, col);
       const sheetColumn = Number(col), editable = !r.cancelled && (col === vatMultiplierColumn || !formulaColumns.has(sheetColumn));
       return `<td data-column-id="${col}" ${visible.has(col) ? '' : 'hidden'} class="${amountColumns.has(sheetColumn) ? 'amount ' : ''}${editable ? 'inline-editable' : formulaColumns.has(sheetColumn) ? 'formula-cell' : ''}" data-inline-row="${i}" data-inline-column="${col}" title="${editable ? `Klik dua kali untuk edit: ${esc(raw)}` : esc(raw)}">${col === vatMultiplierColumn ? esc(raw) : formatCell(raw, sheetColumn)}</td>`;
     }).join('')}<td data-column-id="status" ${visible.has('status') ? '' : 'hidden'}><span class="badge ${r.cancelled ? 'red' : r.overdue ? 'amber' : 'green'}">${r.cancelled ? 'Dibatalkan' : r.overdue ? `Overdue ${r.overdueDays} hari` : 'Aktif'}</span></td>
      <td class="actions sticky-actions"><button class="secondary" data-detail="${i}">Detail</button>${r.cancelled ? '' : `<button data-edit="${i}">Edit</button><button class="danger" data-cancel="${i}">Batal</button>`}</td></tr>`).join('') : `<tr><td id="empty-row" colspan="${visible.size + 1}">Tidak ada transaksi.</td></tr>`}</tbody>${displayedAmountSummary(data, visible)}</table></div>${pager(data)}
    <div class="table-controls"><label>Baris per halaman <select id="page-size"><option value="all" ${state.perPage === 'all' ? 'selected' : ''}>Tampilkan Semua</option>${pageSizes.map(count => `<option value="${count}" ${state.perPage === count ? 'selected' : ''}>${count}</option>`).join('')}</select></label></div><datalist id="new-vendor-codes"></datalist><datalist id="new-vendor-names"></datalist>${[23, 26, 28].map(column => `<datalist id="history-options-${column}"></datalist>`).join('')}</section>`;
  applyColumnOrder();
  applyColumnWidths();
  bindColumnDrag();
  bindColumnResize();
  document.getElementById('add').onclick = () => { state.newVatMultiplier = 0.11; state.newRecord = applyRecordFormulas(Array(32).fill(''), state.newVatMultiplier); recordsPage(data); };
  document.getElementById('export-excel').onclick = () => {
    const params = new URLSearchParams({ api: 'export', currency: state.view, page: state.page, perPage: state.perPage, ...tableFilters() });
    window.location.assign('/index.php?' + params);
  };
  if (state.newRecord) {
    safely(refreshHistoryFields);
    const fields = [...document.querySelectorAll('.new-record-field')];
    const valueFor = column => document.querySelector(`.new-record-field[data-new-column="${column}"]`)?.value || '';
    fields.forEach(field => field.oninput = () => {
      if (field.dataset.newColumn === vatMultiplierColumn) state.newVatMultiplier = Number(field.value);
      else state.newRecord[Number(field.dataset.newColumn)] = field.value;
      refreshNewRecordFormulas();
    });
    document.querySelectorAll('.new-vendor-field').forEach(field => {
      field.oninput = () => {
        state.newRecord[Number(field.dataset.newColumn)] = field.value;
        refreshNewRecordFormulas();
        clearTimeout(vendorSuggestionTimer);
        vendorSuggestionTimer = setTimeout(() => safely(() => refreshVendorSuggestions('', '', field.value)), 250);
      };
      field.onchange = () => safely(async () => {
        const isCode = field.dataset.newVendor === 'code';
        const pairs = await refreshVendorSuggestions(isCode ? valueFor(3) : '', isCode ? '' : valueFor(4));
        const counterpart = [...new Set(pairs.map(pair => isCode ? pair.name : pair.code))];
        if (counterpart.length === 1) {
          const otherColumn = isCode ? 4 : 3;
          const other = document.querySelector(`.new-record-field[data-new-column="${otherColumn}"]`);
          other.value = counterpart[0]; state.newRecord[otherColumn] = counterpart[0];
          refreshNewRecordFormulas();
        } else if (counterpart.length > 1) toast(`Terdapat ${counterpart.length} pasangan vendor. Pilih ${isCode ? 'Vendor Name' : 'Vendor Code'} yang sesuai.`, true);
      });
    });
    document.getElementById('cancel-new-record').onclick = () => { delete state.newRecord; delete state.newVatMultiplier; recordsPage(data); };
    document.getElementById('save-new-record').onclick = async () => {
      const button = document.getElementById('save-new-record');
      const errorBox = document.getElementById('new-record-error');
      errorBox.hidden = true; errorBox.textContent = '';
      button.disabled = true; const label = button.textContent; button.textContent = 'Menyimpan...';
      try {
        const values = Array.from({ length: 32 }, (_, index) => valueFor(index));
        if (!values[4] || !values[5]) throw new Error('Vendor Name dan Invoice No wajib diisi.');
        await api('save', { currency: state.view, id: '', data: values, vatMultiplier: state.newVatMultiplier });
        delete state.newRecord; delete state.newVatMultiplier; toast('Transaksi baru tersimpan.'); await load();
      } catch (error) {
        errorBox.textContent = error.message; errorBox.hidden = false;
      } finally {
        if (document.body.contains(button)) { button.disabled = false; button.textContent = label; }
      }
    };
  }
  document.getElementById('filters').onsubmit = event => safely(async () => {
    event.preventDefault(); state.filters = tableFilters(); state.page = 1; await load();
  });
  document.getElementById('clear-filters').onclick = () => safely(async () => { closeOptions(); state.filters = {}; state.page = 1; await load(); });
  document.querySelectorAll('[data-preset]').forEach(button => button.onclick = () => safely(async () => {
    const preset = button.dataset.preset;
    if (preset === 'due') {
      const today = new Date(), end = new Date(today);
      end.setDate(end.getDate() + 7);
      state.filters = { dueFrom: today.toISOString().slice(0, 10), dueTo: end.toISOString().slice(0, 10) };
    } else state.filters = { status: preset };
    state.page = 1; await load();
  }));
  document.getElementById('page-size').onchange = event => safely(async () => {
    state.perPage = event.target.value === 'all' ? 'all' : Number(event.target.value); saveStored('logbook-per-page', String(state.perPage)); state.page = 1; await load();
  });
  const fullscreenButton = document.getElementById('fullscreen-table');
  const fullscreenTarget = document.getElementById('main');
  const updateFullscreenButton = () => { fullscreenButton.textContent = document.fullscreenElement === fullscreenTarget ? 'Keluar layar penuh' : 'Layar penuh'; };
  document.onfullscreenchange = updateFullscreenButton;
  fullscreenButton.onclick = () => safely(async () => {
    if (document.fullscreenElement === fullscreenTarget) await document.exitFullscreen();
    else if (fullscreenTarget.requestFullscreen) await fullscreenTarget.requestFullscreen();
    else throw new Error('Browser ini tidak mendukung mode layar penuh.');
  });
  document.querySelectorAll('.visible-column').forEach(input => input.onchange = () => {
    const chosen = new Set([...document.querySelectorAll('.visible-column')].filter(item => item.checked).map(item => item.value));
    if (!chosen.size) { input.checked = true; toast('Minimal satu kolom harus ditampilkan.', true); return; }
    saveStored('logbook-columns-' + state.view, JSON.stringify([...chosen]));
    document.querySelectorAll('[data-column-id]').forEach(cell => { cell.hidden = !chosen.has(cell.dataset.columnId); });
    document.getElementById('column-count').textContent = `(${chosen.size}/34)`;
    const empty = document.getElementById('empty-row'); if (empty) empty.colSpan = chosen.size + 1;
  });
  document.querySelectorAll('[data-options]').forEach(button => button.onclick = () => safely(async () => {
    closeOptions(); await showOptions(button.dataset.options, button);
  }));
  document.querySelectorAll('[data-sort]').forEach(button => button.onclick = () => safely(async () => {
    const sort = button.dataset.sort;
    const direction = state.filters.sort === sort && state.filters.direction === 'ASC' ? 'DESC' : 'ASC';
    state.filters = { ...tableFilters(), sort, direction }; state.page = 1; await load();
  }));
  let searchTimer;
  document.querySelectorAll('.column-search').forEach(input => {
    input.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => safely(async () => { state.filters = tableFilters(); state.page = 1; await load(); }), 500);
    };
    input.onkeydown = event => {
      if (event.key !== 'Enter') return;
      event.preventDefault(); clearTimeout(searchTimer);
      safely(async () => { state.filters = tableFilters(); state.page = 1; await load(); });
    };
  });
  document.querySelectorAll('.inline-editable').forEach(cell => cell.ondblclick = event => {
    event.preventDefault(); openInlineEditor(cell);
  });
  document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => recordDialog(state.rows[Number(b.dataset.detail)], true));
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => recordDialog(state.rows[Number(b.dataset.edit)]));
  document.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => safely(async () => {
    const record = state.rows[Number(b.dataset.cancel)];
    if (!confirm('Batalkan transaksi ' + record.invoice + '?')) return;
    await api('cancel', { currency: state.view, id: record.id }); toast('Transaksi dibatalkan.'); await load();
  }));
  attachPager();
}
function openInlineEditor(cell) {
  if (cell.dataset.editing === 'true') return;
  const row = Number(cell.dataset.inlineRow), columnId = cell.dataset.inlineColumn, column = Number(columnId), record = state.rows[row];
  if (!record || record.cancelled) return;
  const multiplier = columnId === vatMultiplierColumn;
  const original = multiplier ? vatMultiplierLabel(record.vatMultiplier) : String(record.data[column] ?? '');
  const type = dateColumns.has(column) ? 'date' : 'text';
  const editor = multiplier
    ? `<select aria-label="Edit VAT in multiplier"><option value="0.011" ${Number(record.vatMultiplier) === 0.011 ? 'selected' : ''}>1.1%</option><option value="0.11" ${Number(record.vatMultiplier) === 0.11 ? 'selected' : ''}>11%</option></select>`
    : column === 30
    ? `<select aria-label="Edit ${esc(state.names[column])}"><option value="">Kosong</option><option value="paid" ${original.toLowerCase() === 'paid' ? 'selected' : ''}>paid</option><option value="not paid" ${original.toLowerCase() === 'not paid' ? 'selected' : ''}>not paid</option></select>`
    : `<input type="${type}" value="${esc(original)}" aria-label="Edit ${esc(state.names[column])}">`;
  cell.dataset.editing = 'true';
  cell.innerHTML = `<div class="inline-editor">${editor}<button type="button" class="inline-save" aria-label="Simpan">✓</button><button type="button" class="inline-cancel" aria-label="Batal">×</button></div>`;
  const input = cell.querySelector('input, select');
  const restore = () => { cell.dataset.editing = ''; cell.innerHTML = formatCell(original, column); };
  const save = () => safely(async () => {
    const value = input.value.trim();
    if (value === original) return restore();
    const buttons = cell.querySelectorAll('button'); buttons.forEach(button => button.disabled = true);
    const values = [...record.data]; if (!multiplier) values[column] = value;
    await api('save', { currency: state.view, id: record.id, data: values, vatMultiplier: multiplier ? Number(value) : record.vatMultiplier });
    toast(`${columnName(columnId)} diperbarui.`); await load();
  });
  cell.querySelector('.inline-save').onclick = save;
  cell.querySelector('.inline-cancel').onclick = restore;
  input.onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); save(); }
    if (event.key === 'Escape') { event.preventDefault(); restore(); }
  };
  input.focus();
  if (input instanceof HTMLInputElement && input.type === 'text') input.select();
}
function recordDialog(record, detail = false) {
  const data = record ? [...record.data] : Array(32).fill('');
  const vatMultiplier = record?.vatMultiplier ?? 0.11;
  if (record?.cancelled) data[30] = 'Invoice Cancel';
  document.getElementById('dialog-body').innerHTML = `<div class="toolbar"><h2>${detail ? 'Detail' : record ? 'Edit' : 'Tambah'} transaksi ${state.view}</h2><button id="close" class="secondary">Tutup</button></div>
    ${record ? `<p class="muted">App ID: ${esc(record.id)} · ${record.cancelled ? 'Dibatalkan' : 'Aktif'}</p>` : ''}
    ${detail ? `${invoiceSummary(record, data)}<div class="form-grid detail-grid">${columnIds().map(column => {
       const value = column === vatMultiplierColumn ? esc(vatMultiplierLabel(vatMultiplier)) : formatCell(data[Number(column)], Number(column));
       const name = columnName(column);
       return `<label>${esc(name)}<span class="detail-value ${value ? '' : 'detail-placeholder'}">${value || 'Belum diisi'}</span></label>`;
     }).join('')}</div>` : `<form id="record"><div class="form-grid">${columnIds().map(column => {
       if (column === vatMultiplierColumn) return `<label>VAT in multiplier<select name="vatMultiplier"><option value="0.011" ${Number(vatMultiplier) === 0.011 ? 'selected' : ''}>1.1%</option><option value="0.11" ${Number(vatMultiplier) === 0.11 ? 'selected' : ''}>11%</option></select></label>`;
       const i = Number(column), name = columnName(column);
       const value = String(data[i] ?? '');
      const kind = [0, 1, 2, 6, 8, 10, 27, 31].includes(i) ? 'date' : 'text';
      const input = i === 30 ? `<select name="${i}"><option value="">Kosong</option><option value="paid" ${value.toLowerCase() === 'paid' ? 'selected' : ''}>paid</option><option value="not paid" ${value.toLowerCase() === 'not paid' ? 'selected' : ''}>not paid</option></select>`
        : `<input name="${i}" type="${kind}" value="${esc(value)}" ${[4, 5].includes(i) ? 'required' : ''} ${formulaColumns.has(i) ? 'readonly' : ''}>`;
      return `<label>${esc(name)}${input}</label>`;
    }).join('')}</div><p class="muted">Di versi MySQL, seluruh kolom disimpan di database; perubahan ini tidak ditulis kembali ke Sheet.</p><button>Simpan</button></form>`}`;
  document.getElementById('close').onclick = () => dialog.close(); dialog.showModal();
  if (detail) return;
  document.getElementById('record').onsubmit = event => safely(async () => {
    event.preventDefault(); const button = event.target.querySelector('button[type=submit]'); button.disabled = true;
    try {
      const form = new FormData(event.target), values = Array.from({ length: 32 }, (_, i) => String(form.get(String(i)) ?? ''));
       await api('save', { currency: state.view, id: record?.id || '', data: values, vatMultiplier: form.get('vatMultiplier') });
      dialog.close(); toast('Transaksi tersimpan.'); await load();
    } finally { button.disabled = false; }
  });
}
function auditPage(data) {
  document.getElementById('main').innerHTML = `<section class="card"><h2>Audit trail</h2><div class="scroll"><table><thead><tr>${['Waktu', 'Email', 'Mata uang', 'App ID', 'Nomor Invoice', 'Vendor Name', 'Invoice Date', 'Aksi', 'Kolom', 'Sebelum', 'Sesudah'].map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
    ${data.rows.map(r => `<tr>${['happened_at', 'email', 'currency', 'record_id', 'invoice', 'vendor', 'invoice_date', 'action', 'column_name', 'old_value', 'new_value'].map(key => `<td>${key === 'invoice_date' ? formatCell(r[key], 6) : esc(r[key])}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="11">Belum ada aktivitas.</td></tr>'}</tbody></table></div>${pager(data)}</section>`;
  attachPager();
}
function usersPage(users) {
  state.users = users;
  document.getElementById('main').innerHTML = `<section class="card"><h2>Pengguna</h2><form id="new-user" class="filters"><label>Email<input name="email" type="email" required></label><button>Tambah pengguna</button></form>
    <p class="muted">Password awal dan hasil reset adalah <code>password</code>. Pengguna wajib menggantinya pada login pertama.</p><div id="temporary"></div></section>
    <section class="card scroll"><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Password</th><th>Aksi</th></tr></thead><tbody>
    ${users.map((u, i) => `<tr><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${u.active ? 'Aktif' : 'Nonaktif'}</td><td>${u.must_change ? 'Wajib diganti' : 'Aktif'}</td>
      <td class="actions"><button class="secondary" data-status="${i}">${u.active ? 'Nonaktifkan' : 'Aktifkan'}</button><button class="secondary" data-role="${i}">${u.role === 'ADMIN' ? 'Jadikan USER' : 'Jadikan ADMIN'}</button><button class="secondary" data-reset="${i}">Reset password</button></td></tr>`).join('')}</tbody></table></section>`;
  const refresh = async result => { usersPage(await api('users')); if (result?.temporaryPassword) document.getElementById('temporary').innerHTML = `<div class="temporary">Password awal untuk ${esc(result.email)}: <code>${esc(result.temporaryPassword)}</code>. Wajib diganti setelah login.</div>`; };
  document.getElementById('new-user').onsubmit = event => safely(async () => {
    event.preventDefault(); await refresh(await api('add-user', { email: event.target.elements.email.value }));
  });
  document.querySelectorAll('[data-status]').forEach(b => b.onclick = () => safely(async () => {
    const u = state.users[Number(b.dataset.status)]; if (!confirm('Ubah status ' + u.email + '?')) return;
    await api('user-status', { email: u.email, value: u.active ? '0' : '1' }); await refresh();
  }));
  document.querySelectorAll('[data-role]').forEach(b => b.onclick = () => safely(async () => {
    const u = state.users[Number(b.dataset.role)]; if (!confirm('Ubah role ' + u.email + '?')) return;
    await api('user-role', { email: u.email, value: u.role === 'ADMIN' ? 'USER' : 'ADMIN' }); await refresh();
  }));
  document.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => safely(async () => {
    const u = state.users[Number(b.dataset.reset)]; if (!confirm('Reset password ' + u.email + '?')) return;
    await refresh(await api('reset-user', { email: u.email }));
  }));
}
function syncPage(errors = []) {
  document.getElementById('main').innerHTML = `<section class="card"><h2>Sinkronisasi dari Google Sheet</h2>
    <p>Unduh seluruh data JSON dari sumber ke snapshot lokal, lalu impor snapshot tersebut ke MySQL. Transaksi yang pernah diedit atau dibatalkan di web tidak akan ditimpa.</p>
    <div class="toolbar"><button id="sync-start">Tarik JSON dan impor</button><button type="button" class="danger" id="purge-transactions">Hapus semua transaksi</button></div><p id="sync-progress" aria-live="polite"></p>
    <pre id="sync-live-log" class="sync-live-log" aria-live="polite">Belum ada proses sinkronisasi.</pre></section>
    <section class="card sync-log-card"><div class="toolbar"><h2>Error log sinkronisasi</h2><button type="button" class="secondary" id="refresh-sync-log">Refresh log</button></div>
    <p class="muted">Menampilkan maksimal 50 error terakhir.</p><pre id="sync-error-log">${errors.length ? esc(errors.join('\n')) : 'Belum ada error sync tercatat.'}</pre></section>`;
  const refreshErrors = async () => {
    const rows = await api('sync-errors');
    document.getElementById('sync-error-log').textContent = rows.length ? rows.join('\n') : 'Belum ada error sync tercatat.';
  };
  document.getElementById('refresh-sync-log').onclick = () => safely(async () => {
    await api('clear-sync-errors', {});
    await refreshErrors();
  });
  document.getElementById('purge-transactions').onclick = () => safely(async () => {
    if (!confirm('Hapus seluruh transaksi IDR dan USD? Data transaksi tidak dapat dipulihkan dari aplikasi.')) return;
    const button = document.getElementById('purge-transactions'); button.disabled = true;
    try {
      const result = await api('purge-transactions', {});
      toast(`${result.deleted} transaksi dihapus.`);
    } finally { button.disabled = false; }
  });
  document.getElementById('sync-start').onclick = () => safely(async () => {
    const button = document.getElementById('sync-start'), progress = document.getElementById('sync-progress'); button.disabled = true;
    const liveLog = document.getElementById('sync-live-log'); liveLog.textContent = '';
    const appendLiveLog = entries => {
      liveLog.textContent += entries.map(entry => entry + '\n').join('');
      const lines = liveLog.textContent.split('\n');
      if (lines.length > 1000) liveLog.textContent = lines.slice(-1000).join('\n');
      liveLog.scrollTop = liveLog.scrollHeight;
    };
    let imported = 0, skipped = 0;
    try {
      for (const currency of ['IDR', 'USD']) {
        progress.textContent = `${currency}: mengunduh snapshot JSON dari sumber...`;
        const result = await api('sync-snapshot', { currency });
        imported += result.imported; skipped += result.skipped;
        appendLiveLog(result.entries || []);
        const missing = result.missingAppIds ? ` ${result.missingAppIds} baris tanpa App ID tidak diimpor.` : '';
        progress.textContent = `${currency}: snapshot ${result.snapshot} selesai. ${result.total}/${result.sourceTotal} baris ber-ID diunduh, ${result.imported} disinkron, ${result.skipped} dilewati.${missing}`;
      }
      toast(`Selesai: ${imported} disinkron, ${skipped} dilewati.`);
    } catch (error) {
      appendLiveLog([`ERROR: ${error.message}`]);
      await refreshErrors();
      throw error;
    } finally { button.disabled = false; }
  });
}
function settingsPage(settings) {
  document.getElementById('main').innerHTML = `<section class="auth card settings-card"><h2>Pengaturan Sync</h2>
    <p class="muted">Hanya Admin dapat mengubah koneksi Google Sheet. Sync secret tidak ditampilkan kembali; isi hanya jika ingin menggantinya.</p>
    <form id="sync-settings" class="stack"><label>Sheet endpoint<input type="url" name="sheetEndpoint" value="${esc(settings.sheetEndpoint)}" required placeholder="https://script.google.com/macros/s/.../exec"></label>
    <label>Sync secret baru<input type="password" name="syncSecret" placeholder="Biarkan kosong untuk mempertahankan secret saat ini" autocomplete="new-password"></label>
    <p class="muted">Secret saat ini: ${settings.hasSyncSecret ? 'sudah dikonfigurasi' : 'belum dikonfigurasi'}.</p><button>Simpan pengaturan</button></form></section>`;
  document.getElementById('sync-settings').onsubmit = event => safely(async () => {
    event.preventDefault(); const form = event.target, button = form.querySelector('button'); button.disabled = true;
    try {
      const updated = await api('save-sync-settings', { sheetEndpoint: form.elements.sheetEndpoint.value, syncSecret: form.elements.syncSecret.value });
      settingsPage(updated); toast('Pengaturan sync tersimpan.');
    } finally { button.disabled = false; }
  });
}
function passwordPage(required) {
  if (required) app.innerHTML = '<main id="main"></main>';
  document.getElementById('main').innerHTML = `<section class="auth card"><h2>${required ? 'Ganti password untuk melanjutkan' : 'Ganti password'}</h2>
    <form id="password" class="stack"><label>Password lama<input type="password" name="old" required></label>
    <label>Password baru (minimal 8 karakter)<input type="password" name="next" minlength="8" required></label><button>Simpan</button></form></section>`;
  if (required) {
    document.getElementById('main').insertAdjacentHTML('afterbegin', '<button type="button" class="theme-toggle password-theme" id="theme-password"></button>');
    bindThemeToggle('theme-password');
  }
  document.getElementById('password').onsubmit = event => safely(async () => {
    event.preventDefault(); await api('password', { old: event.target.elements.old.value, new: event.target.elements.next.value });
    state.user.mustChange = false; state.view = 'Dashboard'; shell(); toast('Password berhasil diganti.'); await load();
  });
}
safely(async () => {
  restoreListingUrl();
  try { state.user = await api('session'); }
  catch (_) { loginPage(); return; }
  if (state.user.mustChange) passwordPage(true); else { shell(); await load(); }
});
window.onpopstate = () => safely(async () => { if (!state.user) return; restoreListingUrl(); await load(); });
