import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const port=9327;
const browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--remote-allow-origins=*',`--remote-debugging-port=${port}`,
  '--user-data-dir=C:\\Users\\BORNEO~1\\AppData\\Local\\Temp\\opencode\\chrome-input-lab','about:blank'
],{stdio:'ignore'});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket;
try{
  let tabs;
  for(let i=0;i<40;i++){try{tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();break;}catch{await wait(200);}}
  assert.ok(tabs?.length);
  socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  let id=0;const pending=new Map();
  socket.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(pending.has(msg.id)){const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(Error(msg.error.message)):resolve(msg.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://localhost:8000/input-mockup.html'});await wait(1000);
  await evaluate(`localStorage.removeItem('logbook-input-lab-v2');location.reload()`);await wait(900);
  assert.equal(await evaluate(`document.querySelectorAll('[data-mode]').length`),7);
  assert.equal(await evaluate(`advance();!document.getElementById('form-error').hidden`),true);
  await evaluate(`document.getElementById('sample').click();document.querySelector('[data-field="4"]').value='PT Contoh Vendor';advance()`);
  assert.equal(await evaluate('step'),1);
  assert.equal(await evaluate(`document.querySelector('[data-field="17"]').value`),'37,730.00');
  await evaluate(`document.querySelector('[data-field="multiplier"]').value='0.11';document.querySelector('[data-field="multiplier"]').dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.equal(await evaluate(`document.querySelector('[data-field="17"]').value`),'377,300.00');
  await evaluate(`document.getElementById('back').click()`);
  assert.equal(await evaluate('draft.multiplier'),.11);
  await evaluate(`advance();advance();advance()`);
  assert.equal(await evaluate(`document.getElementById('review').open`),true);
  await evaluate(`document.getElementById('confirm').click()`);
  assert.equal(await evaluate('rows.length'),1);
  for(const mode of ['grouped','drawer','template']){
    await evaluate(`selectMode('${mode}');document.getElementById('sample').click()`);
    if(mode==='template')await evaluate(`document.querySelector('[data-template="rental"]').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-field]').length`),33);
    await evaluate('advance()');
    assert.equal(await evaluate(`document.getElementById('review').open`),true);
    await evaluate(`document.getElementById('confirm').click()`);
  }
  assert.equal(await evaluate('rows.length'),4);
  await evaluate(`document.querySelector('[data-edit]').click();draft.data[29]='Edited demo';advance();document.getElementById('confirm').click()`);
  assert.equal(await evaluate('rows.length'),4);
  assert.equal(await evaluate('rows[0].data[29]'),'Edited demo');
  for(const mode of ['quick','document']){
    await evaluate(`selectMode('${mode}');document.getElementById('sample').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-field]').length`),33);
    assert.equal(await evaluate(`document.querySelector('.advanced-fields').open`),false);
    await evaluate(`{document.querySelector('.advanced-fields').open=true;const input=document.querySelector('[data-field="9"]');input.value='PO-DEMO-007';input.dispatchEvent(new Event('input',{bubbles:true}));}`);
    if(mode==='document'){
      assert.equal(await evaluate(`document.querySelector('.sample-invoice h2').textContent`),'INVOICE');
      await evaluate(`(() => {const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3cAAAAASUVORK5CYII='),char=>char.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'invoice.png',{type:'image/png'}));document.getElementById('document-file').files=transfer.files;document.getElementById('document-file').dispatchEvent(new Event('change'));})()`);
      assert.equal(await evaluate(`!!document.querySelector('.invoice-image')`),true);
      await evaluate(`document.getElementById('document-clear').click()`);
    }
    await evaluate(`advance();document.getElementById('review-close').click()`);
    assert.equal(await evaluate('draft.data[9]'),'PO-DEMO-007');
    await evaluate(`advance();document.getElementById('confirm').click()`);
  }
  await evaluate(`selectMode('grid');document.getElementById('sample').click()`);
  assert.equal(await evaluate('batchDrafts.length'),2);
  await evaluate(`batchDrafts[1].data[5]=batchDrafts[0].data[5];reviewBatch()`);
  assert.equal(await evaluate(`document.getElementById('review').open`),false);
  assert.match(await evaluate('errorMessage'),/duplikat/);
  await evaluate(`{batchDrafts[1].data[5]+='-UNIQUE';renderGrid();const input=document.querySelector('[data-grid-row="0"][data-grid-field="multiplier"]');input.value='0.11';input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  assert.equal(await evaluate(`document.querySelector('[data-grid-row="0"][data-grid-field="17"]').value`),'377,300.00');
  await evaluate(`document.querySelector('[data-grid-row="1"][data-grid-field="5"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  assert.equal(await evaluate('batchDrafts.length'),3);
  assert.equal(await evaluate(`document.activeElement.dataset.gridRow`),'2');
  await evaluate(`document.querySelector('[data-grid-remove="2"]').click();document.querySelector('[data-grid-row="0"][data-grid-field="5"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('review').open`),true);
  await evaluate(`document.getElementById('review-close').click();document.getElementById('grid-expand').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-grid-row="0"]').length`),33);
  await evaluate(`reviewBatch();document.getElementById('confirm').click()`);
  assert.equal(await evaluate('rows.length'),8);
  await evaluate(`document.querySelector('[data-edit]').click()`);
  assert.equal(await evaluate('mode'),'grouped');
  await evaluate(`selectMode('grouped');document.getElementById('sample').click();draft.data[30]='paid';advance()`);
  assert.equal(await evaluate(`document.getElementById('review').open`),false);
  await evaluate(`draft.data[31]='2026-10-01';advance();document.getElementById('review-close').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-field="4"]').value`),'PT Contoh Vendor');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const mode of ['quick','document','grid']){
    await evaluate(`selectMode('${mode}')`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,mode+' mobile overflow');
  }
  const savedInvoice=await evaluate('draft.data[5]');
  await evaluate('location.reload()');await wait(700);
  assert.equal(await evaluate('draft.data[5]'),savedInvoice);
  assert.equal(await evaluate('rows.length'),8);
  console.log('Passed: seven flows, advanced fields, local document preview, batch duplicate checks, Enter/Ctrl+Enter navigation, VAT recalculation, review/save/edit, draft recovery, and mobile layout.');
}finally{socket?.close();browser.kill();}
