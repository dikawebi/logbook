/** Tambahkan sebagai file Sync.gs pada project Apps Script lama. */
function doGet() {
  return syncJson_({ ok: true, service: 'PT Borneo Prima Logbook Sync' });
}

function setupSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ['IDR', 'USD'].forEach(currency => {
    const sheet = ss.getSheetByName(currency);
    const header = syncHeader_(sheet);
    let names = sheet.getRange(header, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    let idCol = names.indexOf('App ID') + 1;
    let stateCol = names.indexOf('App Status') + 1;
    if (!idCol) { idCol = sheet.getLastColumn() + 1; sheet.getRange(header, idCol).setValue('App ID'); }
    if (!stateCol) { stateCol = sheet.getLastColumn() + 1; sheet.getRange(header, stateCol).setValue('App Status'); }
    const total = Math.max(0, sheet.getLastRow() - header);
    if (!total) return;
    const data = sheet.getRange(header + 1, 1, total, 32).getDisplayValues();
    const ids = sheet.getRange(header + 1, idCol, total, 1).getValues();
    const updated = ids.map((row, index) => {
      const narration = String(data[index][13] || '').trim();
      return row[0] || /^[;\s]+$/.test(narration) ? [row[0]] : [Utilities.getUuid()];
    });
    sheet.getRange(header + 1, idCol, total, 1).setValues(updated);
  });
}

function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('LOGBOOK_SYNC_SECRET');
    if (!secret || secret.length < 32 || request.secret !== secret) throw new Error('Unauthorized');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (request.type === 'users') {
      const sheet = ss.getSheetByName('Pengguna');
      const count = Math.max(0, sheet.getLastRow() - 1);
      const rows = count ? sheet.getRange(2, 1, count, 5).getValues().map(r => [String(r[0]), String(r[1]), String(r[2]), String(r[3]), String(r[4])]) : [];
      return syncJson_({ rows });
    }
    if (request.type === 'audit') {
      const sheet = ss.getSheetByName('AuditLog');
      const total = Math.max(0, sheet.getLastRow() - 1);
      const offset = Math.max(0, Math.floor(Number(request.offset) || 0));
      const count = Math.max(0, Math.min(100, total - offset));
      const rows = count ? sheet.getRange(offset + 2, 1, count, 8).getDisplayValues().map((r, i) => ({ sourceRow: offset + 2 + i, data: r })) : [];
      return syncJson_({ rows, total, next: offset + count });
    }
    if (request.type === 'headers' && ['IDR', 'USD'].includes(request.currency)) {
      const sheet = ss.getSheetByName(request.currency);
      const header = syncHeader_(sheet);
      return syncJson_({ headers: sheet.getRange(header, 1, 1, 32).getDisplayValues()[0] });
    }
    if (!['transactions', 'snapshot'].includes(request.type) || !['IDR', 'USD'].includes(request.currency)) throw new Error('Permintaan tidak valid');
    const sheet = ss.getSheetByName(request.currency);
    const header = syncHeader_(sheet);
    const names = sheet.getRange(header, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    const idCol = names.indexOf('App ID') + 1, stateCol = names.indexOf('App Status') + 1;
    if (!idCol || !stateCol) throw new Error('Jalankan setupSystem() untuk memberi App ID pada sheet.');
    const total = Math.max(0, sheet.getLastRow() - header);
    const snapshot = request.type === 'snapshot';
    const offset = snapshot ? 0 : Math.max(0, Math.floor(Number(request.offset) || 0));
    const limit = snapshot ? total : Math.max(1, Math.min(100, Math.floor(Number(request.limit) || 50)));
    const count = Math.max(0, Math.min(limit, total - offset));
    if (!count) return syncJson_({ rows: [], total, next: offset });
    const display = sheet.getRange(header + 1 + offset, 1, count, Math.max(32, stateCol)).getDisplayValues();
    const rawDates = sheet.getRange(header + 1 + offset, 1, count, 32).getValues();
    const dateColumns = [0, 1, 2, 6, 8, 10, 27, 31];
    const timezone = ss.getSpreadsheetTimeZone();
    const rows = display.map((row, i) => {
      const id = row[idCol - 1];
      if (!id) return null;
      const data = row.slice(0, 32);
      if (/^[;\s]+$/.test(String(data[13] || '').trim())) return null;
      dateColumns.forEach(col => {
        const value = rawDates[i][col];
        if (value instanceof Date && !isNaN(value.getTime())) data[col] = Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
      });
      return { id, sourceRow: header + 1 + offset + i, data, cancelled: String(row[stateCol - 1]).toUpperCase() === 'CANCELLED' };
    }).filter(Boolean);
    return syncJson_({ rows, total, next: offset + count, snapshot });
  } catch (error) {
    return syncJson_({ error: error.message });
  }
}

function syncHeader_(sheet) {
  const values = sheet.getRange(1, 1, Math.min(20, sheet.getLastRow()), Math.max(6, sheet.getLastColumn())).getDisplayValues();
  const index = values.findIndex(r => /vendor name/i.test(r[4]) && /invoice no/i.test(r[5]));
  if (index < 0) throw new Error('Header sheet tidak ditemukan.');
  return index + 1;
}

function syncJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
