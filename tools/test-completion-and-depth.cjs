const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'answer-completion-'));
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium'});const page=await browser.newPage({viewport:{width:1366,height:1000},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));await page.goto('http://127.0.0.1:'+server.address().port);
  const source='1\n完答開始，2，知\n問五①，ア\n②，イ\n完答終了\n問一（１）A，ウ\nB，エ\nC，オ';
  const result=await page.evaluate(source=>{const d={points:2,aspect:'知技'},rows=parseAutoAnswers(source,d),doc=buildAutoDocument(rows,'国語');return {rows,total:scoreTotals(doc),source:autoRowsSource(rows,d),again:parseAutoAnswers(autoRowsSource(rows,d),d)};},source);
  assert.deepEqual(result.rows.map(r=>r.label),['問五①','問五②','問一（１）A','問一（１）B','問一（１）C']);assert.equal(result.rows[0].completeGroup,result.rows[1].completeGroup);assert.equal(result.total['合計'],8);
  assert.deepEqual(result.again.map(r=>[r.label,r.answer,r.points,!!r.completeGroup]),result.rows.map(r=>[r.label,r.answer,r.points,!!r.completeGroup]));
  for(const text of ['完答開始,2\n1,ア\n完答終了','完答開始,2\n1,ア\n2,イ','完答終了','完答開始,2\n1,ア\n完答開始,3','完答開始,2\n1\n1,ア\n2\n1,イ\n完答終了','完答開始,-2\n1,ア\n2,イ\n完答終了','完答開始,2\n1,ア,5\n2,イ\n完答終了'])assert.equal(await page.evaluate(text=>{try{parseAutoAnswers(text,{points:2,aspect:'知技'});return false;}catch{return true;}},text),true,text);
  const variants=['1\n1,(1),A,ア\nB,イ\n(2),C,ウ\nD,エ','1\n問一（１）A ア\nB イ\nC ウ'];
  assert.deepEqual((await page.evaluate(s=>parseAutoAnswers(s),variants[0])).map(r=>r.label),['問一(1)A','問一(1)B','問一(2)C','問一(2)D']);
  assert.deepEqual((await page.evaluate(s=>parseAutoAnswers(s),variants[1])).map(r=>r.label),['問一（１）A','問一（１）B','問一（１）C']);
  const wrapped=await page.evaluate(()=>{
    const rows=parseAutoAnswers('1\n完答開始,2\n問一(1)A,ア,解答欄のみ,1×18\nB,イ,解答欄のみ,1×18\nC,ウ,解答欄のみ,1×18\n完答終了',{points:2,aspect:'知技'}),d=buildAutoDocument(rows,'国語');
    return {total:scoreTotals(d)['合計'],parents:d.fields.map(f=>f.auto.questionId),middles:d.fields.map(f=>f.auto.subQuestionId),outlines:completionOutlines(d).length};
  });assert.equal(wrapped.total,2);assert.equal(new Set(wrapped.parents).size,3);assert.equal(new Set(wrapped.middles).size,3);assert.ok(wrapped.outlines>=3);
  console.log('PASS: complete blocks count once; 3-level labels, sibling inheritance, compact round trip and malformed blocks');
  await page.click('#btn-from-answers');await page.fill('#creation-title','完答と3段階の小問');await page.click('#creation-next');await page.fill('#auto-source',source);await page.click('#auto-parse');
  assert.match(await page.locator('#auto-status').textContent(),/8点/);assert.match(await page.locator('.auto-completion-note').first().textContent(),/全てで 2点/);
  assert.deepEqual(await page.locator('[data-row] [data-k="subLabel"]').evaluateAll(ns=>ns.map(n=>n.value)),['①','②','（１）','（１）','（１）']);
  assert.deepEqual(await page.locator('[data-row] [data-k="leafLabel"]').evaluateAll(ns=>ns.map(n=>n.value)),['','','A','B','C']);
  await page.locator('[data-row="0"] [data-k="points"]').selectOption('3');assert.match(await page.locator('#auto-status').textContent(),/9点/);assert.equal(await page.locator('[data-row="1"] [data-k="points"]').inputValue(),'3');
  await page.locator('[data-row="0"] [data-k="points"]').selectOption('2');await page.click('#auto-apply');
  assert.deepEqual(await page.evaluate(()=>scoreTotals(doc)),{'知技':8,'思判表':0,'合計':8});
  const frames=await page.evaluate(()=>({main:doc.decorations.filter(d=>d.questionHeading && d.questionLevel!==2).map(d=>doc.texts[d.c+','+d.r].t),mid:doc.decorations.filter(d=>d.questionLevel===2).map(d=>doc.texts[d.c+','+d.r].t),ids:doc.fields.map(f=>[f.auto.questionId,f.auto.subQuestionId])}));assert.deepEqual(frames.main,['問五','問一']);assert.deepEqual(frames.mid,['（１）']);assert.equal(frames.ids[2][1],frames.ids[4][1]);
  await page.click('#tab-answer');await page.screenshot({path:path.join(out,'sheet.png'),fullPage:true});
  let dl=page.waitForEvent('download');await page.click('#btn-xlsx');await(await dl).saveAs(path.join(out,'vertical.xlsx'));
  await page.evaluate(()=>loadWork(docJson()));assert.equal(await page.evaluate(()=>scoreTotals(doc)['合計']),8);await page.click('#btn-answer-editor');assert.equal(await page.locator('[data-row="4"] [data-k="leafLabel"]').inputValue(),'C');
  await page.click('#auto-back');assert.match(await page.locator('#auto-source').inputValue(),/完答開始/);await page.click('#auto-parse');await page.check('#auto-replace');await page.click('#auto-apply');assert.equal(await page.evaluate(()=>scoreTotals(doc)['合計']),8);
  // Existing rows can be combined via checkboxes; changing one member updates the entire set.
  await page.click('#btn-answer-editor');await page.click('#auto-batch > summary');for(const i of [2,3,4])await page.locator('[data-row="'+i+'"] [data-check]').check();await page.selectOption('#auto-bulk-points','4');await page.selectOption('#auto-bulk-aspect','思判表');await page.click('#auto-completion-add');assert.match(await page.locator('#auto-status').textContent(),/完答4点/);await page.check('#auto-replace');await page.click('#auto-apply');assert.deepEqual(await page.evaluate(()=>scoreTotals(doc)),{'知技':2,'思判表':4,'合計':6});
  // Manual field popup updates all members rather than counting the set multiple times.
  await page.evaluate(()=>{ui.cur={...doc.fields[2].rects[0]};ui.targets=[];ui.sel=null;ui.extra=[];render();});await page.keyboard.press('Space');await page.fill('.modal [data-k="points"]','5');await page.click('.modal [data-act="ok"]');assert.equal(await page.evaluate(()=>scoreTotals(doc)['合計']),7);assert.deepEqual(await page.evaluate(()=>doc.fields.slice(2).map(f=>f.points)),[5,5,5]);
  await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>scoreTotals(doc)['合計']),6);
  await page.click('#btn-answer-editor');await page.click('#auto-batch > summary');await page.locator('[data-row="2"] [data-check]').check();await page.click('#auto-completion-remove');assert.match(await page.locator('#auto-status').textContent(),/解除/);await page.click('#auto-cancel');
  // Both writing directions export the hierarchy and only the grouped total.
  await page.evaluate(source=>{doc=buildAutoDocument(parseAutoAnswers(source,{points:2,aspect:'知技',subject:'数学'}),'数学');startApp();},source);
  dl=page.waitForEvent('download');await page.click('#btn-xlsx');await(await dl).saveAs(path.join(out,'horizontal.xlsx'));await page.click('#btn-answer-editor');await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('.auto-modal .card').evaluate(n=>n.scrollWidth<=n.clientWidth));await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  const check=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`
from openpyxl import load_workbook
from zipfile import ZipFile
from xml.etree import ElementTree as E
import sys
for p in sys.argv[1:]:
 b=load_workbook(p)
 for i,s in enumerate(b,1):
  with ZipFile(p) as z:score_values=[n.text for n in E.fromstring(z.read(f'xl/drawings/drawing{i}.xml')).findall('.//{http://schemas.openxmlformats.org/drawingml/2006/main}t')]
  values=[str(c.value) for row in s for c in row if c.value is not None]
  for t in ['問五','①','②','問一','（１）','A','B','C']:assert values.count(t)==1,(p,s.title,t)
  assert '８' in score_values
  ranges=list(s.merged_cells.ranges)
  for i,r in enumerate(ranges):
   for t in ranges[i+1:]:assert r.max_col<t.min_col or t.max_col<r.min_col or r.max_row<t.min_row or t.max_row<r.min_row
print('PASS: Excel keeps the main/intermediate/leaf labels, grouped total 8 and nonoverlapping merges in both directions')
`,path.join(out,'vertical.xlsx'),path.join(out,'horizontal.xlsx')],{encoding:'utf8'});process.stdout.write(check.stdout);process.stderr.write(check.stderr);assert.equal(check.status,0);
  console.log('PASS: group editing, separate shared parent cells, save/load, regeneration, manual changes, undo, mobile and Excel\n'+out);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
