import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const playwright=require('C:/Users/AONUSR02/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const engine=process.env.LAYOUT_BROWSER||'chromium';
const base=process.env.LAYOUT_FIXTURE_URL||'http://127.0.0.1:8786/';
const browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
const headers={Authorization:'Bearer fixture-access-token'};
const errors=[];
async function login(page){await page.goto(base);await page.fill('#loginEmail','fixture@example.invalid');await page.fill('#loginPassword','fixture-password');await page.click('#loginBtn');await page.waitForSelector('#appView:not(.hidden)')}
async function rows(page){return (await page.request.get(`${base}rest/v1/exhibition_app_orders`,{headers})).json()}
async function waitStatus(page,status,shared){await page.waitForFunction(({status,shared})=>{const checkbox=document.querySelector('#detailSlackShared');return checkbox&&!checkbox.disabled&&checkbox.checked===shared&&document.querySelector('#orderStatus').value===status},{status,shared})}
async function layout(page,label){
  const failures=await page.evaluate(()=>{
    const bad=[],panel=document.querySelector('.sheetPanel'),bounds=panel.getBoundingClientRect();
    if(document.documentElement.scrollWidth>innerWidth)bad.push('page overflow');
    if(panel.scrollWidth>panel.clientWidth+1)bad.push('panel overflow');
    for(const element of panel.querySelectorAll('input,select,textarea,button,.field,.summaryRow,.slackSharePanel')){
      const rect=element.getBoundingClientRect();if(!rect.width||!rect.height)continue;
      if(rect.left<bounds.left-1||rect.right>bounds.right+1||rect.right>innerWidth+1)bad.push(`${element.id||element.className}: outside panel`);
    }
    for(const input of panel.querySelectorAll('input[type="date"]')){
      const rect=input.getBoundingClientRect(),parent=input.closest('.field').getBoundingClientRect();
      if(Math.abs(rect.width-parent.width)>1||Math.abs(rect.height-48)>1)bad.push(`${input.id}: date dimensions`);
      if(getComputedStyle(input).textAlign!=='left')bad.push(`${input.id}: date alignment`);
    }
    const pickup=document.querySelector('#fPickup'),quick=document.querySelector('.quickDates');
    if(pickup&&quick){
      if(quick.getBoundingClientRect().top-pickup.getBoundingClientRect().bottom<7)bad.push('date controls need spacing');
      const [a,b]=[...quick.children].map(el=>el.getBoundingClientRect());
      if(Math.abs(a.width-b.width)>1||a.height<48||b.height<48||a.right>b.left)bad.push('quick date layout');
    }
    for(const button of panel.querySelectorAll('.customerCopyAction')){
      const range=document.createRange();range.selectNodeContents(button);
      if(range.getClientRects().length!==1||button.scrollWidth>button.clientWidth+1)bad.push('receipt button wraps');
    }
    for(const row of panel.querySelectorAll('.slackShareRow')){
      const label=row.querySelector('label'),button=row.querySelector('button'),a=label.getBoundingClientRect(),b=button.getBoundingClientRect();
      if(a.right>b.left-7||Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)>1||b.height<48)bad.push('share button not beside checkbox');
      for(const el of [label.querySelector('span'),button]){const range=document.createRange();range.selectNodeContents(el);if(range.getClientRects().length!==1||el.scrollWidth>el.clientWidth+1)bad.push('share row text wraps')}
    }
    return bad;
  });
  assert.deepEqual(failures,[],`${engine} ${label}`);
}
try{
  await fs.mkdir('tmp/ui-checks',{recursive:true});
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ja-JP',timezoneId:'Asia/Tokyo'});
  const otherContext=await browser.newContext({viewport:{width:1280,height:900},locale:'ja-JP',timezoneId:'Asia/Tokyo'});
  await context.addInitScript(()=>{window.__SHARE_PRINT_COUNT__=0;window.print=()=>window.__SHARE_PRINT_COUNT__++});
  const page=await context.newPage(),other=await otherContext.newPage();
  page.on('pageerror',error=>errors.push(error.message));other.on('pageerror',error=>errors.push(error.message));
  await login(page);await login(other);
  const cases=['normal','now','later','hotel','ship'];
  for(const kind of cases){
    const sharing=['later','hotel','ship'].includes(kind);
    await page.setViewportSize({width:390,height:844});
    await page.click('#newOrderBtn');await page.fill('#productQ','TEST-001');await page.click('[data-product-id="product-1"]');await page.click('#toType');await page.click(`[data-type="${kind==='normal'?'normal':'spot'}"]`);
    if(kind!=='normal')await page.click(`[data-handoff="${kind}"]`);
    await page.click('#toInfo');
    assert.equal(await page.textContent('#saveBtn'),'注文確定');
    assert.equal(await page.locator('#fSlackShared,#fSlackSharedPrint').count(),sharing?2:0);
    if(kind==='later'){const count=await page.evaluate(()=>window.__SHARE_PRINT_COUNT__);await page.click('#fSlackSharedPrint');assert.equal(await page.evaluate(()=>window.__SHARE_PRINT_COUNT__),count);assert.match(await page.textContent('#sheetError'),/必須/)}
    await page.fill('#fStore',`架空レイアウト検証店-${kind}`);await page.fill('#fPhone','000-0000-0000');await page.fill('#fCustomer','架空のお客様');
    if(kind==='normal')await page.selectOption('#fAccount',{label:'検証帳合A'});
    if(kind==='hotel'){await page.fill('#fHotel','架空検証ホテル');await page.fill('#fGuest','架空宿泊者');await page.fill('#fCheckout','2099-12-31')}
    if(kind==='ship')await page.fill('#fShip','架空の配送先住所（検証用）\n建物名が長い場合の折り返し確認：'+ '架空検証用住所'.repeat(8));
    if(kind==='later'){
      const original=await page.inputValue('#fPickup');await page.fill('#fNotes','日付変更後も保持する架空メモ');
      await page.locator('#fPickup').evaluate(el=>el.dataset.retained='yes');
      await page.click('[data-day="2"]');assert.notEqual(await page.inputValue('#fPickup'),original);
      assert.equal(await page.getAttribute('#fPickup','data-retained'),'yes');assert.equal(await page.inputValue('#fNotes'),'日付変更後も保持する架空メモ');
      await page.click('[data-day="1"]');assert.equal(await page.inputValue('#fPickup'),original);
      await page.fill('#fPickup','2099-12-30');await page.locator('#fPickup').dispatchEvent('change');assert.equal(await page.locator('.quickDates .on').count(),0);
      await page.click('#closeSheet');await page.click('#newOrderBtn');assert.equal(await page.inputValue('#fPickup'),'2099-12-30');
    }
    for(const width of [320,375,390,430,768,1280]){
      await page.setViewportSize({width,height:900});await layout(page,`${kind} info ${width}`);
      if(kind==='later')await page.locator('.pickupDateField').screenshot({path:`tmp/ui-checks/${engine}-pickup-${width}.png`});
      if(kind==='hotel'&&[320,1280].includes(width))await page.locator('#fCheckout').screenshot({path:`tmp/ui-checks/${engine}-checkout-${width}.png`});
    }
    let printedReceiptNo;
    if(sharing){
      const count=await page.evaluate(()=>window.__SHARE_PRINT_COUNT__),before=await rows(page);
      await page.click('#fSlackSharedPrint');assert.equal(await page.evaluate(()=>window.__SHARE_PRINT_COUNT__),count+(kind==='later'?0:1));
      if(kind==='later')assert.match(await page.textContent('#sheetError'),/お渡し番号は注文確定時に発行/);
      else{const printText=await page.textContent('#printArea');assert.match(printText,new RegExp(`架空レイアウト検証店-${kind}`));assert.match(printText,/TEST-001/);assert.doesNotMatch(printText,/未確定|確認用|登録前/)}
      assert.equal(await page.isChecked('#fSlackShared'),false);assert.deepEqual(await rows(page),before);
      await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));assert.equal(await page.inputValue('#fStore'),`架空レイアウト検証店-${kind}`);
      if(kind==='ship'||kind==='later')await page.check('#fSlackShared');
      await page.locator('#toast.show').waitFor({state:'hidden'});
      for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});await page.locator('.slackShareRow').evaluate(el=>el.scrollIntoView({block:'center'}));await page.locator('.slackShareRow').screenshot({path:`tmp/ui-checks/${engine}-slack-form-${width}.png`})}
    }
    await page.click('#saveBtn');await page.waitForSelector('#successCustomerCopy');
    const saved=(await rows(page)).find(row=>row.payload.store===`架空レイアウト検証店-${kind}`);
    assert.equal(saved.payload.slackShared,kind==='ship'||kind==='later');assert.equal(saved.payload.workflowStatus,!sharing||kind==='ship'?'done':kind==='later'?'waiting':'active');
    if(kind==='later'){assert.equal(saved.payload.delivered,false);assert.ok(saved.pickup_number>0);assert.match(await page.textContent('#sheetBody'),new RegExp(`NEO-${saved.pickup_number}`))}
    if(printedReceiptNo)assert.equal(saved.payload.receiptNo,printedReceiptNo);
    for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});await layout(page,`${kind} success ${width}`)}
    await page.click('#backDash');await page.click(`[data-detail="${saved.id}"]`);
    assert.equal(await page.locator('#detailSlackShared,#detailSlackSharedPrint').count(),sharing?2:0);
    assert.equal(await page.locator('#handOverBtn').count(),kind==='later'?1:0);
    if(sharing){
      const before=await rows(page);await page.click('#detailSlackSharedPrint');assert.match(await page.textContent('#printArea'),new RegExp(`架空レイアウト検証店-${kind}`));assert.doesNotMatch(await page.textContent('#printArea'),/未確定|確認用|登録前/);
      assert.deepEqual(await rows(page),before);assert.equal(await page.isChecked('#detailSlackShared'),kind==='ship'||kind==='later');await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
    }
    for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});await layout(page,`${kind} detail ${width}`)}
    if(kind==='later'){
      // Failed writes must not show an unchecked order as completed.
      assert.equal(await page.locator('#orderStatus option[value="done"]').isDisabled(),true);
      await page.uncheck('#detailSlackShared');await waitStatus(page,'active',false);
      await page.route('**/rest/v1/exhibition_app_orders?*',route=>route.request().method()==='PATCH'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture_offline"}'}):route.continue());
      await page.click('#detailSlackShared');await page.waitForFunction(()=>document.querySelector('#sheetError').textContent.includes('変更できませんでした'));
      assert.equal(await page.isChecked('#detailSlackShared'),false);assert.equal(await page.inputValue('#orderStatus'),'active');
      assert.equal((await rows(page)).find(row=>row.id===saved.id).payload.slackShared,false);
      await page.unroute('**/rest/v1/exhibition_app_orders?*');
      await page.check('#detailSlackShared');await waitStatus(page,'waiting',true);
      assert.equal(await page.getAttribute('[data-tab="waiting"]','aria-selected'),'true');
      const confirmed=(await rows(page)).find(row=>row.id===saved.id);assert.ok(confirmed.payload.slackSharedAt);
      // A separately logged-in browser must get both fields through automatic sync.
      await other.fill('#orderSearch',`架空レイアウト検証店-${kind}`);
      await other.waitForSelector(`[data-detail="${saved.id}"]`,{timeout:20000});await other.click(`[data-detail="${saved.id}"]`);await waitStatus(other,'waiting',true);await other.click('#detailClose');
      await page.uncheck('#detailSlackShared');await waitStatus(page,'active',false);
      assert.equal((await rows(page)).find(row=>row.id===saved.id).payload.slackSharedAt,'');
      await page.selectOption('#orderStatus','waiting');await page.click('#saveStatus');await waitStatus(page,'waiting',false);
      await page.check('#detailSlackShared');await waitStatus(page,'waiting',true);
      // Sharing edits use the same revision guard as other edits.
      await other.click('#refreshBtn');await other.waitForFunction(()=>!document.querySelector('#refreshBtn').disabled);await other.click(`[data-detail="${saved.id}"]`);
      await page.uncheck('#detailSlackShared');await waitStatus(page,'active',false);
      await other.click('#detailSlackShared');await other.waitForFunction(()=>document.querySelector('#sheetError').textContent.includes('別の端末で更新'));await other.click('#detailClose');
      await page.check('#detailSlackShared');await waitStatus(page,'waiting',true);
      await page.click('#detailClose');await page.reload();await page.waitForSelector('#appView:not(.hidden)');await page.click('[data-tab="waiting"]');await page.click(`[data-detail="${saved.id}"]`);await waitStatus(page,'waiting',true);
      await page.click('#editOrderBtn');await page.click('#toType');await page.click('#toInfo');assert.equal(await page.textContent('#saveBtn'),'変更を確定');assert.equal(await page.isChecked('#fSlackShared'),true);
      const stamp=(await rows(page)).find(row=>row.id===saved.id).payload.slackSharedAt;
      await page.fill('#fNotes','共有後の通常編集');await page.click('#saveBtn');await page.waitForSelector('#sheet',{state:'hidden'});
      assert.equal((await rows(page)).find(row=>row.id===saved.id).payload.slackSharedAt,stamp);
      await page.click(`[data-detail="${saved.id}"]`);
    }
    if(kind==='later'){
      // Historical auto-completed pickup orders are displayed as waiting without a mass write.
      await page.click('#detailClose');
      const historical=(await rows(page)).find(row=>row.id===saved.id);
      await page.request.patch(`${base}rest/v1/exhibition_app_orders?id=eq.${saved.id}`,{headers,data:{payload:{...historical.payload,workflowStatus:'done',delivered:false,deliveredAt:''}}});
      await page.click('#refreshBtn');await page.waitForFunction(()=>!document.querySelector('#refreshBtn').disabled);await page.click('[data-tab="waiting"]');
      assert.equal(await page.locator(`[data-handover="${saved.id}"]`).count(),1);
      assert.equal((await rows(page)).find(row=>row.id===saved.id).payload.workflowStatus,'done');
      await page.click(`[data-detail="${saved.id}"]`);await waitStatus(page,'waiting',true);
      assert.equal(await page.isDisabled('#handOverBtn'),true);
      await page.click('#recordPaymentBtn');assert.equal(await page.isDisabled('#paymentConfirm'),true);
      await page.click('[data-payment-method="credit"]');await page.click('#paymentConfirm');await waitStatus(page,'waiting',true);
      const paidPickup=(await rows(page)).find(row=>row.id===saved.id);
      assert.equal(paidPickup.payload.paid,true);assert.equal(paidPickup.payload.paymentMethod,'credit');assert.ok(paidPickup.payload.paidAt);assert.equal(paidPickup.payload.delivered,false);
      await page.route('**/rest/v1/exhibition_app_orders?*',route=>route.request().method()==='PATCH'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture_offline"}'}):route.continue());
      await page.click('#handOverBtn');await page.waitForFunction(()=>document.querySelector('#sheetError').textContent.includes('変更できませんでした'));
      assert.equal((await rows(page)).find(row=>row.id===saved.id).payload.delivered,false);assert.equal(await page.isDisabled('#handOverBtn'),false);
      await page.unroute('**/rest/v1/exhibition_app_orders?*');
      for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});await layout(page,`handover ${width}`);await page.locator('.pickupHandoverPanel').evaluate(el=>el.scrollIntoView({block:'center'}));await page.locator('.pickupHandoverPanel').screenshot({path:`tmp/ui-checks/${engine}-handover-${width}.png`})}
      const beforeDelivery=(await rows(page)).find(row=>row.id===saved.id);
      await page.click('#handOverBtn');await waitStatus(page,'done',true);
      const handed=(await rows(page)).find(row=>row.id===saved.id);assert.equal(handed.payload.delivered,true);assert.ok(handed.payload.deliveredAt);assert.equal(handed.payload.paid,beforeDelivery.payload.paid);
      assert.equal(await page.locator('#handOverBtn').count(),0);assert.match(await page.textContent('.pickupHandoverPanel'),/お渡し日時/);
      await page.uncheck('#detailSlackShared');await waitStatus(page,'done',false);await page.check('#detailSlackShared');await waitStatus(page,'done',true);
      // Automatic synchronization carries the handover flag and time to a separate browser.
      await other.waitForFunction(()=>document.querySelector('[data-tab="done"]').textContent==='完了3',{},{timeout:20000});await other.click(`[data-detail="${saved.id}"]`);await waitStatus(other,'done',true);
      assert.match(await other.textContent('.pickupHandoverPanel'),/お渡し日時/);await other.click('#detailClose');
      await page.click('#detailClose');await page.reload();await page.waitForSelector('#appView:not(.hidden)');await page.click('[data-tab="done"]');await page.click(`[data-detail="${saved.id}"]`);await waitStatus(page,'done',true);
      assert.equal((await rows(page)).find(row=>row.id===saved.id).payload.deliveredAt,handed.payload.deliveredAt);
      // Existing status selection can undo a mistaken handover.
      await page.selectOption('#orderStatus','waiting');await page.click('#saveStatus');await waitStatus(page,'waiting',true);
      assert.equal((await rows(page)).find(row=>row.id===saved.id).payload.delivered,false);assert.equal((await rows(page)).find(row=>row.id===saved.id).payload.deliveredAt,'');
      await page.click('#detailClose');
      await page.route('**/rest/v1/exhibition_app_orders?*',route=>route.request().method()==='PATCH'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture_offline"}'}):route.continue());
      await page.click(`[data-handover="${saved.id}"]`);await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('保存できませんでした'));
      assert.equal((await rows(page)).find(row=>row.id===saved.id).payload.delivered,false);assert.equal(await page.isDisabled(`[data-handover="${saved.id}"]`),false);await page.unroute('**/rest/v1/exhibition_app_orders?*');
      await page.setViewportSize({width:390,height:844});await page.locator('#toast.show').waitFor({state:'hidden'});await page.locator('.orderCard').screenshot({path:`tmp/ui-checks/${engine}-handover-card.png`});
      let patches=0;const countPatch=request=>{if(request.method()==='PATCH'&&request.url().includes('exhibition_app_orders'))patches++};page.on('request',countPatch);
      await page.locator(`[data-handover="${saved.id}"]`).evaluate(button=>{button.click();button.click()});
      await page.waitForFunction(()=>document.querySelector('[data-tab="done"]').getAttribute('aria-selected')==='true');page.off('request',countPatch);assert.equal(patches,1);
      await page.click(`[data-detail="${saved.id}"]`);await waitStatus(page,'done',true);assert.equal((await rows(page)).find(row=>row.id===saved.id).payload.delivered,true);
    }
    if(kind==='hotel'){await page.selectOption('#orderStatus','waiting');await page.click('#saveStatus');await waitStatus(page,'waiting',false)}
    if(kind==='ship'){
      await page.setViewportSize({width:390,height:844});await page.locator('#customerCopyBtn').scrollIntoViewIfNeeded();await page.locator('#toast.show').waitFor({state:'hidden'});await page.screenshot({path:`tmp/ui-checks/${engine}-detail-mobile.png`});
      await page.check('#detailSlackShared');await waitStatus(page,'done',true);
    }
    await page.click('#detailClose');
  }
  assert.equal((await rows(page)).length,5);
  // Put one fixture order on an earlier reception date; all-period print must keep it.
  const prior=(await rows(page)).find(row=>row.payload.type==='normal');
  await page.request.patch(`${base}rest/v1/exhibition_app_orders?id=eq.${prior.id}`,{headers,data:{created_at:'2020-01-01T00:00:00Z'}});
  await page.click('#refreshBtn');await page.waitForFunction(()=>!document.querySelector('#refreshBtn').disabled);
  // Printing ignores the currently selected status tab and search query.
  await page.fill('#orderSearch','does-not-match');await page.click('#printMenuBtn');
  assert.equal(await page.locator('#printNormalBatch,#printAllBatch').count(),0);
  assert.equal(await page.getAttribute('[data-date-mode="all"]','class'),'on');assert.match(await page.textContent('#sheetBody'),/5件/);
  await page.click('[data-date-mode="range"]');
  for(const width of [320,375,390,430,768,1280]){await page.setViewportSize({width,height:900});await layout(page,`print range ${width}`)}
  await page.fill('#printStart','2099-12-31');await page.locator('#printStart').dispatchEvent('change');assert.equal(await page.isDisabled('#executeBatchPrint'),true);
  await page.click('[data-date-mode="today"]');assert.match(await page.textContent('#sheetBody'),/4件/);
  await page.click('[data-date-mode="all"]');assert.match(await page.textContent('#sheetBody'),/5件/);await page.setViewportSize({width:390,height:844});await page.locator('#toast.show').waitFor({state:'hidden'});await page.screenshot({path:`tmp/ui-checks/${engine}-batch-mobile.png`});
  await page.evaluate(()=>{window.print=()=>{window.__LAYOUT_PRINT__=true}});await page.click('#executeBatchPrint');
  assert.equal(await page.evaluate(()=>window.__LAYOUT_PRINT__),true);
  assert.equal(await page.locator('#printArea .printSheet').count(),5);assert.equal(await page.locator('#printArea .batchTable tbody tr').count(),5);
  for(const kind of cases)assert.match(await page.textContent('#printArea'),new RegExp(`架空レイアウト検証店-${kind}`));
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));assert.equal((await rows(page)).length,5);
  assert.deepEqual(errors,[]);
  console.log(`PASS ${engine}: 5 order types, 6 viewport widths (320/375/390/430/768/1280), native dates, receipt buttons, confirm labels, Slack save/reload/sync/failure/conflict, all-order printing and retention`);
}finally{await browser.close()}
