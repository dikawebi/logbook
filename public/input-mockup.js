'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}).format(Number(value) || 0);
const number = value => Number(String(value || '').replace(/,/g, '')) || 0;
const names = ['Received Date','Validation Date','MSD Date','Vendor Code','Vendor Name','Invoice No','Invoice Date','Tax Invoice No','Tax Invoice Date','PO / Contract No','PO/WO Date','Nominal PO/Contract','Description','Narration for MSD','PPh / WHT %','DPP Non VAT','DPP VAT','VAT Prepaid (VAT in)','Pajak Daerah','Pajak Bahan Bakar','WHT 22','Rounding off','Invoiced Amount','Tax Code','Withholding Tax Amount','Net Payment','Payment Term','Due Date','Category','Remarks','Paid / Not Paid','Payment Date'];
const dateFields = new Set([0,1,2,6,8,10,27,31]);
const amounts = new Set([11,15,16,17,18,19,20,21,22,24,25]);
const calculated = new Set([13,17,22,25,27]);
const groups = [
  {title:'Invoice & vendor', ids:[4,3,5,6,0,1,2,9,10,11,12]},
  {title:'Pajak & nominal', ids:[7,8,15,16,'multiplier',17,14,18,19,20,21,23,24,22,25]},
  {title:'Pembayaran & keterangan', ids:[26,27,28,30,31,29,13]}
];
const modes = {
  wizard:['01 · GUIDED INPUT','Form bertahap','Tiga langkah fokus, dengan draft yang tetap tersimpan saat kembali.'],
  grouped:['02 · SINGLE WORKSPACE','Form dengan ringkasan langsung','Seluruh bagian terlihat sekaligus. Angka utama selalu tersedia di panel ringkasan.'],
  drawer:['03 · KEEP THE CONTEXT','Input dari listing','Buka drawer untuk tambah atau edit tanpa kehilangan konteks daftar transaksi.'],
  template:['04 · REPEAT WITH CONFIDENCE','Mulai dari template','Pilih jenis transaksi untuk mengisi default, lalu lengkapi dan review.'],
  quick:['07 · ESSENTIALS FIRST','Input cepat + field lanjutan','Isi field inti lebih dahulu. Buka detail tambahan saat diperlukan.'],
  document:['08 · DOCUMENT WORKSPACE','Dokumen invoice + form','Baca dokumen di kiri dan isi form di kanan. Preview lokal, tanpa ekstraksi OCR.'],
  grid:['09 · KEYBOARD-FIRST BATCH','Grid entry','Tab berpindah sel, Enter ke baris berikutnya, Ctrl + Enter untuk review seluruh batch.']
};
const storageKey = 'logbook-input-lab-v2';
let store;
try { store = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (_) { store = {}; }
if (!store || typeof store !== 'object') store = {};
let rows = Array.isArray(store.rows) ? store.rows : [];
let draft = store.draft || null;
let batchDrafts = Array.isArray(store.batchDrafts) ? store.batchDrafts : [];
let pendingBatch = null, previewUrl = '', previewType = '', previewName = '';
let mode = 'wizard', step = 0, editing = null, drawerOpen = false, selectedTemplate = '', errorMessage = '';
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
function blank() { const data = Array(32).fill(''); data[0]=today(); data[6]=today(); data[26]='30'; data[30]=''; return {currency:$('currency').value, data, multiplier:.11}; }
if (!draft || !Array.isArray(draft.data) || draft.data.length !== 32) draft = blank();
$('currency').value = draft.currency;
function persist() { try { localStorage.setItem(storageKey, JSON.stringify({rows, draft, batchDrafts})); $('draft-info').textContent='Draft otomatis tersimpan di browser · ' + new Date().toLocaleTimeString('id-ID'); } catch (_) { $('draft-info').textContent='Draft tersedia untuk sesi ini; penyimpanan browser tidak tersedia.'; } }
function formulas(record = draft) {
  const data=record.data;
  data[17]=String(Math.round(number(data[16])*record.multiplier));
  data[13]=[data[5], ...(record.currency==='USD'?[data[4]]:[]), data[12]].filter(Boolean).join('; ');
  data[22]=String(record.currency==='USD'?Math.round(number(data[15])):Math.round([15,16,17,18,19,20,21].reduce((sum,index)=>sum+number(data[index]),0)));
  if (record.currency==='USD') data[24]=String(Math.round(-number(data[14])/100*(number(data[15])+number(data[16]))));
  data[25]=String(number(data[22])+number(data[24]));
  data[27]='';
  if (/^\d{4}-\d{2}-\d{2}$/.test(data[6])) {const date=new Date(data[6]+'T00:00:00Z'); date.setUTCDate(date.getUTCDate()+Math.max(0,Math.trunc(number(data[26])))); if(Number.isFinite(date.getTime()))data[27]=date.toISOString().slice(0,10);}
}
function field(id) {
  if(id==='multiplier')return `<label>VAT in multiplier<select data-field="multiplier"><option value="0.011" ${draft.multiplier===.011?'selected':''}>1.1%</option><option value="0.11" ${draft.multiplier===.11?'selected':''}>11%</option></select><small>VAT = DPP VAT × multiplier</small></label>`;
  const value=draft.data[id], readonly=calculated.has(id)||(id===24&&draft.currency==='USD');
  const required=[4,5,6].includes(id);
  let input;
  if(id===30)input=`<select data-field="30"><option value="">Kosong / belum dibayar</option><option value="not paid" ${value==='not paid'?'selected':''}>Not Paid</option><option value="paid" ${value==='paid'?'selected':''}>Paid</option></select>`;
  else if(id===28)input=`<input data-field="28" list="categories" value="${escapeHtml(value)}">`;
  else if(id===12||id===29)input=`<textarea data-field="${id}">${escapeHtml(value)}</textarea>`;
  else input=`<input data-field="${id}" ${id===4?'list="vendors"':''} type="${dateFields.has(id)?'date':'text'}" ${amounts.has(id)||[14,26].includes(id)?'inputmode="decimal"':''} ${required?'required':''} ${readonly?'readonly':''} value="${escapeHtml(readonly&&amounts.has(id)?money(value):value)}">`;
  return `<label class="${[12,13,29].includes(id)?'wide':''}">${escapeHtml(names[id])}${required?' *':''}${input}${readonly?'<small>Dihitung otomatis</small>':id===24?'<small>Masukkan nilai negatif untuk potongan PPh.</small>':''}</label>`;
}
function section(group,index){return `<section class="form-section"><div class="section-heading"><b>0${index+1}</b><h3>${group.title}</h3></div><div class="field-grid">${group.ids.map(field).join('')}</div></section>`;}
function summary(){return `<aside class="summary"><h3>Ringkasan langsung</h3><p>${draft.currency} · diperbarui saat Anda mengetik</p><dl>${[['Invoice',draft.data[5]||'—'],['Vendor',draft.data[4]||'—'],['DPP VAT',money(draft.data[16])],['VAT '+(draft.multiplier*100)+'%',money(draft.data[17])],['Invoiced Amount',money(draft.data[22])],['Withholding Tax',money(draft.data[24])],['Due Date',draft.data[27]||'—']].map(([label,value])=>`<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}<div class="net"><dt>Net Payment</dt><dd>${money(draft.data[25])}</dd></div></dl><p class="help">VAT dibulatkan seperti aplikasi. PPh IDR diisi manual; PPh USD dihitung dari WHT %. Semua angka ini adalah simulasi.</p></aside>`;}
const quickIds = [4,5,6,12,15,16,'multiplier',17,24,26,27,28,30,31];
function quickSections(){
  return section({title:'Field inti transaksi',ids:quickIds},0)+`<details class="advanced-fields"><summary>Field lanjutan · PO, tax invoice, pajak tambahan & keterangan</summary>${groups.map((group,index)=>section({...group,ids:group.ids.filter(id=>!quickIds.includes(id))},index)).join('')}</details>`;
}
function documentPanel(){
  return `<aside class="document-panel"><div class="document-tools"><h3>Dokumen sumber</h3><label class="upload-label">Pilih PDF / gambar<input id="document-file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp"></label><button type="button" id="document-clear" class="secondary">Dokumen contoh</button></div><div id="document-preview"></div><p class="document-note">Dokumen hanya dipreview lokal. Isi form secara manual; file tidak diupload atau disimpan ke transaksi demo.</p></aside>`;
}
function bindDocument(){
  renderDocumentPreview();
  $('document-file').onchange=event=>{
    const file=event.target.files[0];if(!file)return;
    if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(file.type)){notify('Pilih dokumen PDF, PNG, JPG, atau WebP.');return;}
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=URL.createObjectURL(file);previewType=file.type;previewName=file.name;renderDocumentPreview();
  };
  $('document-clear').onclick=()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';previewName='';$('document-file').value='';renderDocumentPreview();};
}
function renderDocumentPreview(){
  if(previewUrl){$('document-preview').innerHTML=`<p class="document-filename">${escapeHtml(previewName)}</p>${previewType==='application/pdf'?`<iframe src="${previewUrl}" title="Preview PDF invoice"></iframe>`:`<img class="invoice-image" src="${previewUrl}" alt="Preview invoice">`}`;return;}
  $('document-preview').innerHTML=`<article class="sample-invoice"><span class="eyebrow">CONTOH DOKUMEN</span><h2>INVOICE</h2><h3>PT Contoh Vendor</h3><p>Jl. Industri No. 12 · Kalimantan</p><hr><dl><div><dt>Nomor</dt><dd>DEMO-DOC-001</dd></div><div><dt>Tanggal</dt><dd>${today()}</dd></div><div><dt>Term</dt><dd>30 hari</dd></div></dl><table><thead><tr><th>Deskripsi</th><th class="amount">Nominal</th></tr></thead><tbody><tr><td>Jasa pemeliharaan</td><td class="amount">3,430,000.00</td></tr></tbody></table><dl><div><dt>DPP VAT</dt><dd>3,430,000.00</dd></div><div><dt>VAT 1.1%</dt><dd>37,730.00</dd></div><div class="invoice-total"><dt>Total invoice</dt><dd>3,467,730.00</dd></div></dl><p class="muted">Bandingkan angka dokumen dengan ringkasan form di sebelah kanan.</p></article>`;
}
let gridExpanded=false;
const gridCore=[4,5,6,15,16,'multiplier',17,24,25,26,27,30,31];
function gridIds(){return gridExpanded?groups.flatMap(group=>group.ids):gridCore;}
function gridCell(record,row,id){
  const readonly=calculated.has(id)||(id===24&&record.currency==='USD');
  const attributes=`data-grid-row="${row}" data-grid-field="${id}" aria-label="Baris ${row+1}: ${id==='multiplier'?'VAT multiplier':names[id]}"`;
  if(id==='multiplier')return `<select ${attributes}><option value="0.011" ${record.multiplier===.011?'selected':''}>1.1%</option><option value="0.11" ${record.multiplier===.11?'selected':''}>11%</option></select>`;
  if(id===30)return `<select ${attributes}><option value="">Kosong</option><option value="not paid" ${record.data[id]==='not paid'?'selected':''}>Not Paid</option><option value="paid" ${record.data[id]==='paid'?'selected':''}>Paid</option></select>`;
  return `<input ${attributes} type="${dateFields.has(id)?'date':'text'}" value="${escapeHtml(readonly&&amounts.has(id)?money(record.data[id]):record.data[id])}" ${readonly?'readonly tabindex="-1"':''} ${amounts.has(id)?'inputmode="decimal"':''}>`;
}
function renderGrid(){
  if(!batchDrafts.length)batchDrafts=[blank()];
  batchDrafts.forEach(record=>formulas(record));
  const ids=gridIds();
  $('editor-host').innerHTML=`<div class="editor grid-editor"><div class="grid-toolbar"><span>Isi beberapa invoice sekaligus · draft batch tersimpan otomatis</span><div><button type="button" id="grid-expand" class="secondary">${gridExpanded?'Field inti':'Semua field'}</button> <button type="button" id="grid-add" class="secondary">+ Baris</button></div></div><div id="form-error" role="alert" class="error" ${errorMessage?'':'hidden'}>${escapeHtml(errorMessage)}</div><div class="table-scroll"><table class="input-grid"><thead><tr><th># / Mata uang</th>${ids.map(id=>`<th>${id==='multiplier'?'VAT multiplier':names[id]}</th>`).join('')}<th>Aksi</th></tr></thead><tbody>${batchDrafts.map((record,row)=>`<tr><td>${row+1}<br><span class="badge">${record.currency}</span></td>${ids.map(id=>`<td>${gridCell(record,row,id)}</td>`).join('')}<td><button type="button" data-grid-remove="${row}">Hapus</button></td></tr>`).join('')}</tbody></table></div><div class="form-actions"><div id="batch-summary"></div><button type="button" id="grid-review" class="primary">Review semua baris →</button></div><p class="shortcut">Tab / Shift+Tab: pindah sel · Enter: sel yang sama di baris berikutnya (tambah baris otomatis) · Ctrl+Enter: review batch</p></div>`;
  updateBatchSummary();
  $('grid-add').onclick=()=>{batchDrafts.push(blank());renderGrid();persist();};
  $('grid-expand').onclick=()=>{gridExpanded=!gridExpanded;renderGrid();};
  $('grid-review').onclick=reviewBatch;
  document.querySelectorAll('[data-grid-remove]').forEach(button=>button.onclick=()=>{batchDrafts.splice(Number(button.dataset.gridRemove),1);renderGrid();persist();});
  document.querySelectorAll('[data-grid-field]').forEach(input=>{
    input.oninput=()=>{
      const row=Number(input.dataset.gridRow),id=input.dataset.gridField,record=batchDrafts[row];
      if(id==='multiplier')record.multiplier=Number(input.value);else record.data[Number(id)]=input.value;
      formulas(record);
      document.querySelectorAll(`[data-grid-row="${row}"]`).forEach(el=>{const index=Number(el.dataset.gridField);if(el.readOnly)el.value=amounts.has(index)?money(record.data[index]):record.data[index];});
      input.classList.remove('error-field');updateBatchSummary();persist();
    };
    input.onkeydown=event=>{
      if(event.key!=='Enter')return;event.preventDefault();
      if(event.ctrlKey){event.stopPropagation();reviewBatch();return;}
      const next=Number(input.dataset.gridRow)+1,id=input.dataset.gridField;
      if(next>=batchDrafts.length){batchDrafts.push(blank());renderGrid();persist();}
      document.querySelector(`[data-grid-row="${next}"][data-grid-field="${id}"]`)?.focus();
    };
  });
}
function updateBatchSummary(){
  $('batch-summary').innerHTML=['IDR','USD'].map(currency=>{const records=batchDrafts.filter(record=>record.currency===currency);return records.length?`<span class="badge">${records.length} ${currency} · Net ${money(records.reduce((sum,record)=>sum+number(record.data[25]),0))}</span>`:'';}).join(' ');
}
function reviewBatch(){
  const errors=[];const keys=new Set();
  batchDrafts.forEach((record,index)=>{
    formulas(record);
    recordErrors(record,null,null).forEach(error=>errors.push({row:index,...error}));
    const key=JSON.stringify([record.currency,record.data[4].trim().toLowerCase(),record.data[5].trim().toLowerCase()]);
    if(keys.has(key))errors.push({row:index,id:5,message:'Invoice/vendor duplikat dalam batch.'});keys.add(key);
  });
  if(errors.length){errorMessage=errors.map(error=>`Baris ${error.row+1}: ${error.message}`).join(' ');$('form-error').hidden=false;$('form-error').textContent=errorMessage;errors.forEach(error=>document.querySelector(`[data-grid-row="${error.row}"][data-grid-field="${error.id}"]`)?.classList.add('error-field'));return;}
  pendingBatch=JSON.parse(JSON.stringify(batchDrafts));
  $('review-body').innerHTML=`<p class="muted">${pendingBatch.length} transaksi akan disimpan bersama. Periksa jumlah dan nominal setiap baris.</p><div class="table-scroll"><table><thead><tr><th>Invoice / Vendor</th><th>Mata uang</th><th>Invoice Date</th><th class="amount">VAT</th><th class="amount">Net Payment</th><th>Due Date</th></tr></thead><tbody>${pendingBatch.map(record=>`<tr><td>${escapeHtml(record.data[5])}<br>${escapeHtml(record.data[4])}</td><td>${record.currency}</td><td>${record.data[6]}</td><td class="amount">${money(record.data[17])}</td><td class="amount">${money(record.data[25])}</td><td>${record.data[27]}</td></tr>`).join('')}</tbody></table></div>`;
  $('review').showModal();
}
function renderEditor() {
  formulas();
  document.querySelector('.drawer-mask')?.remove();
  const host=$('editor-host');
  if(mode==='grid'){renderGrid();return;}
  if(mode==='drawer'&&!drawerOpen){host.innerHTML='';return;}
  const html=`<div class="editor">${mode==='wizard'?`<div class="stepper">${groups.map((group,index)=>`<button data-step="${index}" class="${index===step?'active':index<step?'done':''}">${index+1}. ${group.title}</button>`).join('')}</div>`:''}
    <div id="form-error" role="alert" ${errorMessage?'':'hidden'} class="error">${escapeHtml(errorMessage)}</div>
    <form id="demo-form" novalidate><div class="form-layout"><div>${mode==='quick'||mode==='document'?quickSections():groups.map((group,index)=>mode==='wizard'&&index!==step?'':section(group,index)).join('')}</div><div id="live-summary">${summary()}</div></div>
    <datalist id="vendors"><option value="PT Contoh Vendor"></option><option value="PT Borneo Service"></option><option value="PT Fuel Nusantara"></option></datalist><datalist id="categories"><option value="Operational"></option><option value="Fuel"></option><option value="Rental"></option><option value="Service"></option></datalist>
    <div class="form-actions"><button type="button" id="back" class="secondary">${mode==='wizard'&&step>0?'← Kembali':'Batal'}</button><div class="action-right"><button type="button" id="save-draft" class="secondary">Simpan draft</button><button type="submit" class="primary">${mode==='wizard'&&step<2?'Lanjut →':'Review transaksi →'}</button></div></div><p class="shortcut">Ctrl + Enter: lanjut atau review · * Field wajib</p></form></div>`;
  if(mode==='drawer'){
    host.innerHTML=''; const mask=document.createElement('div');mask.className='drawer-mask'; mask.innerHTML=`<aside class="drawer"><div class="workspace-head"><h2>${editing?'Edit':'Tambah'} transaksi ${draft.currency}</h2><button id="close-drawer" class="secondary">Tutup</button></div>${html}</aside>`;document.body.append(mask);$('close-drawer').onclick=()=>{drawerOpen=false;persist();renderEditor();};
  }else host.innerHTML=mode==='document'?`<div class="document-layout">${documentPanel()}<div class="document-form">${html}</div></div>`:html;
  if(mode==='document')bindDocument();
  document.querySelectorAll('[data-field]').forEach(input=>{
    input.addEventListener('input',()=>{
      const id=input.dataset.field;
      if(id==='multiplier')draft.multiplier=Number(input.value);else draft.data[Number(id)]=input.value;
      if(id==='4'){const vendors={'PT Contoh Vendor':'VND-001','PT Borneo Service':'VND-002','PT Fuel Nusantara':'VND-003'};if(vendors[input.value]){draft.data[3]=vendors[input.value];const code=document.querySelector('[data-field="3"]');if(code)code.value=draft.data[3];}}
      formulas();document.querySelectorAll('[data-field]').forEach(el=>{const index=Number(el.dataset.field);if(calculated.has(index)||(index===24&&draft.currency==='USD'))el.value=amounts.has(index)?money(draft.data[index]):draft.data[index];});
      $('live-summary').innerHTML=summary();persist();input.classList.remove('error-field');
    });
  });
  $('back').onclick=()=>{errorMessage='';if(mode==='wizard'&&step>0){step--;renderEditor();}else{drawerOpen=false;$('editor-host').innerHTML='<div class="success-banner">Draft dipertahankan. Klik Transaksi baru untuk memulai lagi atau pilih opsi input.</div>';document.querySelector('.drawer-mask')?.remove();}};
  $('save-draft').onclick=()=>{persist();notify('Draft demo tersimpan. Dapat dilanjutkan setelah refresh.');};
  $('demo-form').onsubmit=event=>{event.preventDefault();advance();};
  document.querySelectorAll('[data-step]').forEach(button=>button.onclick=()=>{const next=Number(button.dataset.step);if(next>step&&!validate(groups[step].ids))return;step=next;errorMessage='';renderEditor();});
}
function recordErrors(record,recordId,ids=null){
  let invalid=[];
  for(const id of [4,5,6])if((!ids||ids.includes(id))&&!String(record.data[id]).trim())invalid.push({id,message:names[id]+' wajib diisi.'});
  for(const id of [11,14,15,16,18,19,20,21,24,26])if((!ids||ids.includes(id))&&record.data[id]!==''&&!Number.isFinite(Number(String(record.data[id]).replace(/,/g,''))))invalid.push({id,message:names[id]+' harus berupa angka.'});
  if((!ids||ids.includes(31))&&record.data[30]==='paid'&&!record.data[31])invalid.push({id:31,message:'Payment Date wajib diisi untuk transaksi Paid.'});
  for(const id of dateFields){if(ids&&!ids.includes(id))continue;const value=record.data[id];if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value))invalid.push({id,message:names[id]+' tidak valid.'});}
  if(rows.some(row=>row.id!==recordId&&row.currency===record.currency&&row.data[4].toLowerCase()===record.data[4].trim().toLowerCase()&&row.data[5].toLowerCase()===record.data[5].trim().toLowerCase()))invalid.push({id:5,message:'Invoice untuk vendor ini sudah ada di listing demo.'});
  return invalid;
}
function validate(ids=null){
  const invalid=recordErrors(draft,editing,ids);
  errorMessage=invalid.map(item=>item.message).join(' ');
  const error=$('form-error');if(error){error.hidden=!invalid.length;error.textContent=errorMessage;invalid.forEach(({id})=>{const input=document.querySelector(`[data-field="${id}"]`);input?.classList.add('error-field');if(input?.closest('details'))input.closest('details').open=true;});document.querySelector(`[data-field="${invalid[0]?.id}"]`)?.focus();}
  return !invalid.length;
}
function advance(){if(mode==='grid'){reviewBatch();return;}if(!validate(mode==='wizard'&&step<2?groups[step].ids:null))return;if(mode==='wizard'&&step<2){step++;renderEditor();}else showReview();}
function showReview(){formulas();$('review-body').innerHTML=`<p class="muted">Periksa nilai akhir sebelum menyimpan transaksi ${draft.currency} di listing demo.</p><div class="review-grid">${groups.flatMap(group=>group.ids).map(id=>{const label=id==='multiplier'?'VAT in multiplier':names[id],value=id==='multiplier'?draft.multiplier*100+'%':amounts.has(id)?money(draft.data[id]):draft.data[id]||'—';return `<div class="review-item"><small>${escapeHtml(label)}</small>${escapeHtml(value)}</div>`;}).join('')}</div>`;$('review').showModal();}
function renderListing(){
  $('listing').innerHTML=`<div class="listing"><div class="listing-heading"><h3>Transaksi demo tersimpan <span class="muted">(${rows.length})</span></h3><span class="muted" style="font-size:10px">Hasil semua opsi tersedia di sini</span></div><div class="table-scroll"><table><thead><tr><th>Invoice / Vendor</th><th>Mata uang</th><th>Invoice Date</th><th class="amount">VAT</th><th class="amount">Net Payment</th><th>Due Date</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${rows.map(row=>`<tr><td><b>${escapeHtml(row.data[5])}</b><br><span class="muted">${escapeHtml(row.data[4])}</span></td><td>${row.currency}</td><td>${row.data[6]}</td><td class="amount">${money(row.data[17])}<br><small>${row.multiplier*100}%</small></td><td class="amount">${money(row.data[25])}</td><td>${row.data[27]||'—'}</td><td><span class="badge ${row.data[30]==='paid'?'paid':''}">${row.data[30]||'Belum dibayar'}</span></td><td><button data-edit="${row.id}">Edit</button></td></tr>`).join('')||'<tr><td class="empty" colspan="8">Belum ada data. Isi contoh → Review → Konfirmasi untuk mencoba alur lengkap.</td></tr>'}</tbody></table></div></div>`;
  document.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>{const row=rows.find(item=>item.id===button.dataset.edit);draft=JSON.parse(JSON.stringify(row));editing=row.id;$('currency').value=draft.currency;step=0;drawerOpen=true;errorMessage='';if(mode==='grid')selectMode('grouped');else renderEditor();persist();});
}
function notify(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('toast').hidden=true,4500);}
function renderTemplates(){
  $('templates').innerHTML=mode==='template'?`<div class="template-grid">${[['fuel','Fuel / bahan bakar','VAT 1.1% · term 30 hari'],['rental','Rental / sewa','VAT 11% · term 14 hari'],['service','Service / jasa','VAT 11% · term 30 hari']].map(([id,title,text])=>`<button data-template="${id}" class="${selectedTemplate===id?'active':''}">${title}<small>${text}</small></button>`).join('')}</div>`:'';
  document.querySelectorAll('[data-template]').forEach(button=>button.onclick=()=>{selectedTemplate=button.dataset.template;const settings={fuel:['Fuel',.011,'30'],rental:['Rental',.11,'14'],service:['Service',.11,'30']}[selectedTemplate];draft.data[28]=settings[0];draft.data[12]=settings[0];draft.multiplier=settings[1];draft.data[26]=settings[2];errorMessage='';renderTemplates();renderEditor();persist();notify('Default template terisi; vendor, invoice, dan nominal tetap dapat diubah.');});
}
function selectMode(next){mode=next;errorMessage='';document.querySelectorAll('[data-mode]').forEach(button=>button.classList.toggle('active',button.dataset.mode===mode));[$('mode-label').textContent,$('workspace-title').textContent,$('mode-description').textContent]=modes[mode];renderTemplates();renderEditor();renderListing();}
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>selectMode(button.dataset.mode));
$('new').onclick=()=>{draft=blank();if(mode==='grid')batchDrafts.push(blank());editing=null;step=0;selectedTemplate='';errorMessage='';drawerOpen=true;renderTemplates();renderEditor();persist();};
function sampleRecord(suffix=''){const record=blank();record.data[4]='PT Contoh Vendor';record.data[3]='VND-001';record.data[5]='DEMO-'+Date.now().toString().slice(-7)+suffix;record.data[12]='Jasa pemeliharaan';record.data[16]='3430000';record.data[15]=record.currency==='USD'?'1000':'0';record.data[24]=record.currency==='USD'?'':'-68600';record.data[14]='2';record.data[28]='Service';record.multiplier=.011;formulas(record);return record;}
$('sample').onclick=()=>{draft=sampleRecord();if(mode==='grid')batchDrafts=[sampleRecord('-A'),sampleRecord('-B')];editing=null;step=0;drawerOpen=true;errorMessage='';renderEditor();persist();};
$('currency').onchange=()=>{draft.currency=$('currency').value;formulas();renderEditor();persist();};
$('review-close').onclick=()=>{$('review').close();pendingBatch=null;};
$('review').addEventListener('cancel',()=>{pendingBatch=null;});
$('confirm').onclick=()=>{if(pendingBatch){const records=pendingBatch.map(record=>({...record,id:crypto.randomUUID()}));rows.unshift(...records);pendingBatch=null;batchDrafts=[];$('review').close();errorMessage='';persist();renderEditor();renderListing();notify(`${records.length} transaksi demo berhasil disimpan.`);return;}if(!validate())return;formulas();const row=JSON.parse(JSON.stringify(draft));row.id=editing||crypto.randomUUID();const index=rows.findIndex(item=>item.id===row.id);if(index>=0)rows[index]=row;else rows.unshift(row);$('review').close();editing=null;draft=blank();step=0;drawerOpen=false;errorMessage='';persist();renderEditor();renderListing();notify('Transaksi demo berhasil disimpan. Gunakan Edit pada listing untuk melanjutkan.');};
document.addEventListener('keydown',event=>{if(event.ctrlKey&&event.key==='Enter'&&!$('review').open&&($('demo-form')||mode==='grid')){event.preventDefault();advance();}});
selectMode(mode);persist();
