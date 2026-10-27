const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'answer-scoring-'));
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium'});const context=await browser.newContext({viewport:{width:1366,height:950},acceptDownloads:true});
  await context.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const url='http://127.0.0.1:'+server.address().port;await page.goto(url);
  const parsed=await page.evaluate(()=>{
   const d={points:3,aspect:'知技',aspectRanges:[{from:1,to:3,aspect:'知技'},{from:4,to:5,aspect:'思判表'}]};
   const rows=parseAutoAnswers('大問三\n1,長い答えです。\n大問四\n1,ア\n2,イ,0\n3,ウ,知\n4,エ,8,知\n大問五\n1,オ\n大問六\n1,カ',d);
   return {rows,again:parseAutoAnswers(autoRowsSource(rows,d),d)};
  });
  assert.deepEqual(parsed.rows.map(r=>r.points),[3,3,0,3,8,3,3]);assert.deepEqual(parsed.rows.map(r=>r.aspect),['知技','思判表','思判表','知技','知技','思判表','知技']);
  assert.deepEqual(parsed.again.map(r=>[r.answer,r.points,r.aspect]),parsed.rows.map(r=>[r.answer,r.points,r.aspect]));
  assert.equal(await page.evaluate(()=>parseAutoAnswers('1,ア',{points:1.5})[0].points),1.5);
  for(const defaults of [{points:-1},{points:'abc'},{points:1001},{aspectRanges:[{from:3,to:2,aspect:'知技'}]},{aspectRanges:[{from:0,to:2,aspect:'知技'}]},{aspectRanges:[{from:1,to:3,aspect:'知技'},{from:3,to:4,aspect:'思判表'}]}])assert.equal(await page.evaluate(d=>{try{parseAutoAnswers('1,ア',d);return false;}catch{return true;}},defaults),true);
  console.log('PASS: range boundaries, explicit score/aspect overrides, zero points, compact round trip and invalid settings');
  await page.click('#btn-from-answers');await page.fill('#creation-title','基本点数のテスト');await page.click('#creation-next');
  await page.fill('#auto-base-points','3');await page.click('#auto-range-add');let range=page.locator('.auto-aspect-range').nth(0);await range.locator('[data-range="from"]').fill('1');await range.locator('[data-range="to"]').fill('3');await range.locator('[data-range="aspect"]').selectOption('知技');
  await page.click('#auto-range-add');range=page.locator('.auto-aspect-range').nth(1);await range.locator('[data-range="to"]').fill('5');
  const source='１\n１，ア\n２，理由を詳しく説明したから。\n３\n１，イ\n４\n１，ウ\n５\n１，エ\n２，オ，7，知\n６\n１，カ';await page.fill('#auto-source',source);
  await page.locator('.auto-modal .card').evaluate(n=>n.scrollTop=0);await page.screenshot({path:path.join(output,'input.png'),fullPage:true});await page.click('#auto-parse');
  const scores=()=>page.locator('[data-row] [data-k="points"]').evaluateAll(ns=>ns.map(n=>+n.value));const aspects=()=>page.locator('[data-row] [data-k="aspect"]').evaluateAll(ns=>ns.map(n=>n.value));
  assert.deepEqual(await scores(),[3,3,3,3,3,7,3]);assert.deepEqual(await aspects(),['知技','知技','知技','思判表','思判表','知技','知技']);
  assert.ok((await page.locator('#auto-status').textContent()).includes('25点'));
  await page.click('#auto-back');assert.equal(await page.locator('#auto-source').inputValue(),source);await page.fill('#auto-base-points','4');await page.click('#auto-tab-review');assert.deepEqual(await scores(),[4,4,4,4,4,7,4]);
  await page.click('#auto-apply');assert.deepEqual(await page.evaluate(()=>scoreTotals(doc)),{'知技':23,'思判表':8,'合計':31});
  await page.click('#btn-answer-editor');await page.click('#auto-back');assert.equal(await page.locator('#auto-base-points').inputValue(),'4');assert.equal(await page.locator('.auto-aspect-range').count(),2);
  const compact=await page.locator('#auto-source').inputValue();assert.match(compact,/1￥ア\n/);assert.ok(!compact.includes('1￥ア￥4'));
  // Invalid overlapping rules preserve current sheet, and can be corrected without losing answers.
  await page.locator('.auto-aspect-range').nth(1).locator('[data-range="from"]').fill('3');await page.click('#auto-parse');assert.match(await page.locator('#auto-status').textContent(),/重複/);assert.equal(await page.evaluate(()=>scoreTotals(doc)['合計']),31);
  await page.locator('.auto-aspect-range').nth(1).locator('[data-range="from"]').fill('4');await page.click('#auto-parse');await page.check('#auto-replace');await page.click('#auto-apply');
  await page.evaluate(()=>loadWork(docJson()));assert.equal(await page.evaluate(()=>doc.paper.autoScoring.points),4);assert.equal(await page.evaluate(()=>scoreTotals(doc)['合計']),31);
  const dl=page.waitForEvent('download');await page.click('#btn-xlsx');await(await dl).saveAs(path.join(output,'scoring.xlsx'));
  await page.click('#btn-answer-editor');await page.click('#auto-back');await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('.auto-scoring-setup').evaluate(n=>n.scrollWidth<=n.clientWidth));await page.locator('.auto-modal .card').evaluate(n=>n.scrollTop=0);await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
  const fresh=await context.newPage();await fresh.goto(url);await fresh.click('#btn-from-answers');await fresh.fill('#creation-title','次のテスト');await fresh.click('#creation-next');assert.equal(await fresh.locator('#auto-base-points').inputValue(),'4');assert.equal(await fresh.locator('.auto-aspect-range').count(),2);
  await fresh.click('#auto-range-add');assert.equal(await fresh.locator('.auto-aspect-range').count(),3);await fresh.locator('.auto-aspect-range').last().locator('[data-range-remove]').click();assert.equal(await fresh.locator('.auto-aspect-range').count(),2);
  assert.deepEqual(errors,[]);
  const check=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`
from openpyxl import load_workbook
from zipfile import ZipFile
from xml.etree import ElementTree as E
import sys
b=load_workbook(sys.argv[1]);assert b.sheetnames==['解答用紙','模範解答']
for i,s in enumerate(b,1):
 with ZipFile(sys.argv[1]) as z:texts=[n.text for n in E.fromstring(z.read(f'xl/drawings/drawing{i}.xml')).findall('.//{http://schemas.openxmlformats.org/drawingml/2006/main}t')]
 assert '３１' in texts and '２３' in texts and '８' in texts
print('PASS: independent Excel totals: knowledge 23, thinking 8, total 31')
`,path.join(output,'scoring.xlsx')],{encoding:'utf8'});process.stdout.write(check.stdout);process.stderr.write(check.stderr);assert.equal(check.status,0);
  console.log('PASS: short input, settings changes, range validation, save/reopen, remembered settings, mobile and Excel\n'+output);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
