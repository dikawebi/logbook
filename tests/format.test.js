const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
new vm.Script(source, { filename: 'app.js' });
const context = vm.createContext({
  document: {
    getElementById: () => ({}), querySelector: () => ({ content: 'test' }),
    createElement: () => ({}), body: { appendChild: () => {} }
  }
});
vm.runInContext(source.slice(0, source.indexOf('const toast =')), context);
const format = (value, column) => vm.runInContext(`formatCell(${JSON.stringify(value)}, ${column})`, context);
assert.equal(format('1234567.5', 25), '1,234,567.50');
assert.equal(format('1,279,279,279', 22), '1,279,279,279.00');
assert.equal(format('-480000', 24), '-480,000.00');
assert.equal(format('1234.5', 5), '1234.5'); // Nomor invoice tidak diperlakukan sebagai nominal.
assert.equal(format('2026-07-02', 0), '2-Jul-26');
assert.equal(vm.runInContext(`(() => { const row = Array(32).fill(''); row[16] = '100000'; return applyRecordFormulas(row, 0.011)[17]; })()`, context), '1100');
console.log('Checks passed: pemisah ribuan, dua desimal, negatif, format tanggal, dan VAT multiplier.');
