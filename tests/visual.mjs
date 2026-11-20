// Pemeriksaan visual localhost dengan Chrome DevTools Protocol (tanpa dependency npm).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9321;
const browser = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-allow-origins=*', `--remote-debugging-port=${port}`,
  '--user-data-dir=C:\\Users\\BORNEO~1\\AppData\\Local\\Temp\\opencode\\chrome-visual-check',
  'http://localhost:8000/'
], { stdio: 'ignore' });

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let tabs;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; }
    catch (_) { await pause(200); }
  }
  assert.ok(tabs?.length, 'Chrome DevTools tidak terbuka.');
  const page = tabs.find(tab => tab.type === 'page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
      message.error ? reject(Error(message.error.message)) : resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id; pending.set(current, { resolve, reject });
    socket.send(JSON.stringify({ id: current, method, params }));
  });
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://localhost:8000/' });
  await pause(1400);
  await evaluate('localStorage.setItem("logbook-theme","light");location.reload()');
  await pause(1000);
  const light = await evaluate('({ viewport:innerWidth, scroll:document.documentElement.scrollWidth, theme:document.documentElement.dataset.theme, button:!!document.getElementById("theme-login"), loginErrorAboveButton:document.getElementById("login-error").compareDocumentPosition(document.querySelector(".login-submit")) & Node.DOCUMENT_POSITION_FOLLOWING, background:getComputedStyle(document.body).backgroundColor })');
  assert.equal(light.viewport, 390);
  assert.ok(light.scroll <= light.viewport, `Login overflow horizontal: ${light.scroll} > ${light.viewport}`);
  assert.equal(light.button, true);
  assert.ok(light.loginErrorAboveButton);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('C:\\Users\\BORNEO~1\\AppData\\Local\\Temp\\opencode\\logbook-mobile-verified.png', Buffer.from(screenshot.data, 'base64'));
  const dark = await evaluate('document.getElementById("theme-login").click(); ({ theme:document.documentElement.dataset.theme, saved:localStorage.getItem("logbook-theme"), background:getComputedStyle(document.body).backgroundColor })');
  assert.equal(dark.theme, 'dark');
  assert.equal(dark.saved, 'dark');
  assert.notEqual(dark.background, light.background);
  const darkScreenshot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('C:\\Users\\BORNEO~1\\AppData\\Local\\Temp\\opencode\\logbook-dark-verified.png', Buffer.from(darkScreenshot.data, 'base64'));
  const dashboard = await evaluate(`state.user={email:'demo@borneoprima.com',role:'ADMIN',mustChange:false};state.view='Dashboard';shell();dashboardPage({IDR:{total:4341,unpaid:200,overdue:12},USD:{total:76,unpaid:2,overdue:3}});
    ({viewport:innerWidth,scroll:document.documentElement.scrollWidth,sidebar:!!document.querySelector('.app-sidebar'),themeButton:!!document.getElementById('theme-app'),sidebarToggle:!!document.getElementById('sidebar-toggle')})`);
  assert.ok(dashboard.scroll <= dashboard.viewport, `Dashboard overflow horizontal: ${dashboard.scroll} > ${dashboard.viewport}`);
  assert.equal(dashboard.sidebar, true);
  assert.equal(dashboard.themeButton, true);
  assert.equal(dashboard.sidebarToggle, true);
  const sidebarCollapsed = await evaluate(`(() => { const shell=document.querySelector('.app-shell'); const before=shell.classList.contains('sidebar-collapsed'); document.getElementById('sidebar-toggle').click(); return before !== shell.classList.contains('sidebar-collapsed'); })()`);
  assert.equal(sidebarCollapsed, true);
  const dashboardShot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('C:\\Users\\BORNEO~1\\AppData\\Local\\Temp\\opencode\\logbook-dashboard-mobile.png', Buffer.from(dashboardShot.data, 'base64'));
  const settings = await evaluate(`settingsPage({sheetEndpoint:'https://script.google.com/macros/s/example/exec',hasSyncSecret:true}); ({endpoint:document.querySelector('[name="sheetEndpoint"]').value, secretValue:document.querySelector('[name="syncSecret"]').value, configured:document.getElementById('main').textContent.includes('sudah dikonfigurasi')})`);
  assert.equal(settings.endpoint, 'https://script.google.com/macros/s/example/exec');
  assert.equal(settings.secretValue, '');
  assert.equal(settings.configured, true);
  const syncLog = await evaluate(`syncPage(['[2026-01-01 10:00:00] IDR offset 0: contoh error']); ({refresh:!!document.getElementById('refresh-sync-log'), purge:!!document.getElementById('purge-transactions'), live:document.getElementById('sync-live-log').textContent, content:document.getElementById('sync-error-log').textContent})`);
  assert.equal(syncLog.refresh, true);
  assert.equal(syncLog.purge, true);
  assert.match(syncLog.live, /Belum ada proses/);
  assert.match(syncLog.content, /contoh error/);
  const table = await evaluate(`try { localStorage.removeItem('logbook-columns-IDR');localStorage.removeItem('logbook-column-order-IDR');localStorage.removeItem('logbook-column-widths-IDR');state.perPage='all';state.view='IDR';state.names=Array.from({length:32},(_,i)=>'Kolom '+(i+1));recordsPage({names:state.names,rows:[{id:'sample',data:Array(32).fill('1234.50'),vatMultiplier:0.11,cancelled:false,overdue:true,overdueDays:4,invoice:'INV-1'}],categories:[],page:1,pages:1,total:1,perPage:'all'});
    ({viewport:innerWidth,scroll:document.documentElement.scrollWidth,tableScroll:document.querySelector('.sheet-scroll').scrollWidth,tableWidth:document.querySelector('.sheet-scroll').clientWidth,summary:document.querySelector('.summary-row .amount').textContent.trim(),summarySticky:getComputedStyle(document.querySelector('.summary-row .amount')).position,resizers:document.querySelectorAll('.column-resizer').length,pages:pager({perPage:10,page:12,pages:25,total:250})}) } catch (error) { ({error:error.message}) }`);
  assert.ok(!table.error, table.error);
  assert.ok(table.scroll <= table.viewport, `Tabel menyebabkan overflow halaman: ${table.scroll} > ${table.viewport}`);
  assert.ok(table.tableScroll > table.tableWidth, 'Tabel 32 kolom harus bisa digeser horizontal.');
  assert.equal(table.summary, '1,234.50');
  assert.equal(table.summarySticky, 'sticky');
  assert.equal(table.resizers, 34);
  assert.ok(await evaluate(`document.querySelector('.overdue-row') && document.querySelector('.badge.amber').textContent.includes('4 hari')`));
  const detail = await evaluate(`(() => { const data=Array(32).fill(''); data[4]='Vendor A';data[5]='INV-1';data[18]='100';data[22]='1000';data[24]='-20';data[25]='980';data[27]='2026-01-01';data[30]='not paid';recordDialog({id:'sample',data,vatMultiplier:0.011,cancelled:false,overdue:true,overdueDays:4},true); const text=document.getElementById('dialog-body').textContent; dialog.close(); return text; })()`);
  for (const label of ['RINGKASAN INVOICE', 'Invoice', 'Vendor', 'Status', 'Invoiced amount', 'VAT Prepaid', 'Withholding tax', 'Net payment', 'Due date', 'Overdue']) assert.match(detail, new RegExp(label));
  assert.match(table.pages, /data-page="1"/);
  assert.match(table.pages, /data-page="7"/);
  assert.match(table.pages, /data-page="17"/);
  assert.match(table.pages, /data-page="25"/);
  assert.match(table.pages, /Menuju ke halaman/);
  const reordered = await evaluate(`saveStored('logbook-column-order-IDR', JSON.stringify(['5', ...orderedColumns().filter(id => id !== '5')])); applyColumnOrder(); document.querySelector('.sheet-table thead tr:first-child th[data-column-id]').dataset.columnId`);
  assert.equal(reordered, '5');
  const controls = await evaluate(`({pageSizes:document.querySelectorAll('#page-size option').length,
    columnChecks:document.querySelectorAll('.visible-column').length, defaultPageSize:document.getElementById('page-size').value, fullscreen:!!document.getElementById('fullscreen-table'), displayAboveGrid:document.querySelector('.display-controls').compareDocumentPosition(document.querySelector('.records-card')) & Node.DOCUMENT_POSITION_FOLLOWING, helpSize:getComputedStyle(document.querySelector('.listing-help')).fontSize})`);
  assert.equal(controls.pageSizes, 10);
  assert.equal(controls.columnChecks, 34);
  assert.equal(controls.defaultPageSize, 'all');
  assert.equal(controls.fullscreen, true);
  assert.ok(controls.displayAboveGrid);
  assert.equal(controls.helpSize, '11px');
  const inlineHandler = await evaluate(`typeof document.querySelector('[data-inline-row="0"][data-inline-column="2"]').ondblclick`);
  assert.equal(inlineHandler, 'function');
  const hidden = await evaluate(`document.querySelector('.visible-column[value="0"]').click(); document.querySelector('[data-column-id="0"]').hidden`);
  assert.equal(hidden, true);
  const displayControls = await evaluate(`({sticky:document.querySelectorAll('.sticky-column').length, actions:!!document.querySelector('.sticky-actions')})`);
  assert.equal(displayControls.sticky, 0);
  assert.equal(displayControls.actions, true);
  const newRecord = await evaluate(`try { document.getElementById('add').click(); ({fields:document.querySelectorAll('.new-record-field').length, historyFields:document.querySelectorAll('.history-field').length, taxInput:document.querySelector('[data-history-column="23"]').tagName, paymentTermInput:document.querySelector('[data-history-column="26"]').tagName, categoryInput:document.querySelector('[data-history-column="28"]').tagName, paidSelect:document.querySelector('[data-history-column="30"]').tagName, codeList:document.querySelector('[data-new-vendor="code"]').getAttribute('list'), nameList:document.querySelector('[data-new-vendor="name"]').getAttribute('list'), save:!!document.getElementById('save-new-record')}) } catch (error) { ({error:error.message}) }`);
  assert.ok(!newRecord.error, newRecord.error);
  assert.equal(newRecord.fields, 33);
  assert.equal(newRecord.historyFields, 4);
  assert.equal(newRecord.taxInput, 'INPUT');
  assert.equal(newRecord.paymentTermInput, 'INPUT');
  assert.equal(newRecord.categoryInput, 'INPUT');
  assert.equal(newRecord.paidSelect, 'SELECT');
  assert.equal(newRecord.codeList, 'new-vendor-codes');
  assert.equal(newRecord.nameList, 'new-vendor-names');
  assert.equal(newRecord.save, true);
  const saveFeedback = await evaluate(`document.getElementById('save-new-record').click(); ({visible:!document.getElementById('new-record-error').hidden, message:document.getElementById('new-record-error').textContent})`);
  assert.equal(saveFeedback.visible, true);
  assert.equal(saveFeedback.message, 'Vendor Name dan Invoice No wajib diisi.');
  const formulas = await evaluate(`(() => { const set=(column,value) => { const field=document.querySelector('[data-new-column="'+column+'"]'); field.value=value; field.oninput(); }; set(5,'INV-1'); set(12,'Fuel'); set(15,'100'); set(16,'200'); set(6,'2026-01-07'); set(26,'30'); return {narration:document.querySelector('[data-new-column="13"]').value, vat:document.querySelector('[data-new-column="17"]').value, amount:document.querySelector('[data-new-column="22"]').value, net:document.querySelector('[data-new-column="25"]').value, due:document.querySelector('[data-new-column="27"]').value, locked:document.querySelector('[data-new-column="22"]').readOnly}; })()`);
  const guest = await evaluate(`(() => { dialog.close();state.user={email:'guest@example.test',role:'GUEST',mustChange:false};state.view='IDR';shell();state.names=Array.from({length:32},(_,i)=>'Kolom '+(i+1));state.rows=[{id:'guest-sample',data:Array(32).fill(''),vatMultiplier:0.11,cancelled:false,invoice:'INV-GUEST'}];recordsPage({names:state.names,rows:state.rows,categories:[],page:1,pages:1,total:1,perPage:'all'});document.querySelector('[data-detail]').click();return {add:!!document.getElementById('add'),export:!!document.getElementById('export-excel'),editable:document.querySelectorAll('.inline-editable,[data-edit],[data-cancel]').length,restrictedNav:document.querySelectorAll('[data-view="Dashboard"],[data-view="Audit"],[data-view="Users"],[data-view="Sync"],[data-view="Settings"]').length,detail:dialog.open,editForm:!!document.getElementById('record'),listingLinks:document.querySelectorAll('[data-view="IDR"],[data-view="USD"]').length};})()`);
  assert.equal(guest.add, false);
  assert.equal(guest.export, true);
  assert.equal(guest.editable, 0);
  assert.equal(guest.restrictedNav, 0);
  assert.equal(guest.listingLinks, 2);
  assert.equal(guest.detail, true);
  assert.equal(guest.editForm, false);
  console.log('Checks passed: mobile, dark mode, sidebar, sticky, inline input, formulas, columns, and read-only GUEST listing/detail UI.');
} finally {
  socket?.close();
  browser.kill();
}
