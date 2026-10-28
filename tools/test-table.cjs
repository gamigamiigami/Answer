// Run: node tools/test-table.cjs (Playwright, Python/openpyxl/pypdf)
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'testomo-table-')),server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html;charset=utf-8');r.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')))});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium'});
  const page=await browser.newPage({viewport:{width:1400,height:1000},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{doc=newDoc('数学');startApp();ui.cur={c:2,r:12};render();});
  assert.ok(await page.evaluate(()=>{const d=buildAutoDocument(parseAutoAnswers('1,,4,知,表'),'数学'),f=d.fields[0];return f.table.cols===3 && f.table.rows===3 && f.rects[0].w===6 && f.rects[0].h===9;}));
  await page.click('#t-table-place');await page.fill('.modal [data-k="cols"]','3');await page.fill('.modal [data-k="rows"]','2');await page.click('.modal [data-act="ok"]');await page.waitForSelector('#table-grid');
  assert.equal(await page.locator('[data-table-cell]').count(),6);
  await page.fill('[data-table-cell="0,0"]','見出し');await page.check('#table-given');await page.fill('[data-table-cell="0,1"]','項目');await page.check('#table-given');await page.fill('[data-table-cell="1,1"]','秘密の答え');
  await page.click('[data-table-op="row-before"]');assert.equal(await page.locator('#table-rows').inputValue(),'3');assert.equal(await page.locator('[data-table-cell="2,1"]').inputValue(),'秘密の答え');
  await page.click('[data-table-op="row-delete"]');assert.equal(await page.locator('[data-table-cell="1,1"]').inputValue(),'秘密の答え');
  await page.click('[data-table-op="col-before"]');assert.equal(await page.locator('[data-table-cell="1,2"]').inputValue(),'秘密の答え');await page.click('[data-table-op="col-delete"]');assert.equal(await page.locator('[data-table-cell="1,1"]').inputValue(),'秘密の答え');
  await page.click('[data-table-op="row-delete"]');assert.equal(await page.locator('#table-rows').inputValue(),'1');await page.click('[data-table-op="undo"]');assert.equal(await page.locator('[data-table-cell="1,1"]').inputValue(),'秘密の答え');
  await page.locator('[data-table-cell="1,2"]').press('Tab');assert.equal(await page.locator('#table-rows').inputValue(),'3');assert.equal(await page.locator('[data-table-cell="2,0"]').evaluate(el=>el===document.activeElement),true);
  await page.locator('[data-table-cell="2,0"]').evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','甲\t乙\n丙\t丁');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  assert.equal(await page.locator('#table-rows').inputValue(),'4');assert.equal(await page.locator('[data-table-cell="3,1"]').inputValue(),'丁');
  await page.fill('#table-points','8');await page.click('#table-save');await page.locator('.table-modal').waitFor({state:'detached'});
  const saved=await page.evaluate(()=>docJson(false)),d=JSON.parse(saved);assert.equal(d.fields[0].table.cols,3);assert.equal(d.fields[0].table.rows,4);assert.equal(d.fields[0].points,8);
  const check=await page.evaluate(()=>{const f=doc.fields[0],sheet=[...buildCells(doc,false).values()].map(c=>c.t),answer=[...buildCells(doc,true).values()].map(c=>c.t);options.backupAnswers=false;return {sheet,answer,backup:docJson(true),outside:outsideCount(doc)};});assert.ok(check.sheet.includes('見出し'));assert.ok(!check.sheet.includes('秘密の答え'));assert.ok(check.answer.includes('秘密の答え'));assert.ok(!check.backup.includes('秘密の答え'));assert.equal(check.outside,0);
  await page.evaluate(s=>loadWork(s),saved);assert.equal(await page.evaluate(()=>docJson(false)),saved);
  await page.evaluate(()=>{const r=doc.fields[0].rects[0];ui.cur={c:r.c,r:r.r};});await page.click('#t-table-edit');await page.fill('[data-table-cell="1,1"]','変更を破棄');await page.click('[data-table-op="row-after"]');await page.click('#table-cancel');assert.equal(await page.evaluate(()=>docJson(false)),saved);
  console.log('PASS: manual table creation, insertion/deletion, local undo, last-cell Tab, pasted matrices, public headers, private answers, save/load and cancellation');
  // Structural edits in the answer tab are undone with their answers and dimensions as one action.
  await page.click('#tab-answer');await page.evaluate(()=>editTableField(doc.fields[0]));await page.click('[data-table-op="row-after"]');await page.fill('[data-table-cell="1,0"]','追加行');await page.click('#table-save');const changed=await page.evaluate(()=>docJson(false));assert.notEqual(changed,saved);await page.click('#btn-undo');assert.equal(await page.evaluate(()=>docJson(false)),saved);await page.click('#btn-redo');assert.equal(await page.evaluate(()=>docJson(false)),changed);
  // Actual auto-generation entry point, including parser, editor, reparse and regeneration.
  await page.click('#btn-answer-editor');await page.click('#auto-tab-input');await page.fill('#auto-source','1\n1,,4,知,表,3×4');await page.click('#auto-parse');assert.equal(await page.locator('[data-row="0"] [data-k="kind"]').inputValue(),'table');await page.click('[data-row="0"] [data-table]');await page.fill('[data-table-cell="0,0"]','分類');await page.check('#table-given');await page.fill('[data-table-cell="1,1"]','自動の答え');await page.click('#table-save');await page.click('#auto-tab-input');await page.click('#auto-parse');await page.click('[data-row="0"] [data-table]');assert.equal(await page.locator('[data-table-cell="1,1"]').inputValue(),'自動の答え');await page.locator('[data-table-cell="0,0"]').focus();assert.ok(await page.locator('#table-given').isChecked());await page.click('#table-save');await page.click('#auto-apply');await page.locator('.auto-modal').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>doc.fields[0].type),12);
  const generated=await page.evaluate(()=>docJson(false));await page.click('#btn-answer-editor');assert.equal(await page.locator('[data-row="0"] [data-k="kind"]').inputValue(),'table');await page.click('#auto-apply');await page.locator('.auto-modal').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>doc.answers.f1),JSON.parse(generated).answers.f1);assert.equal(await page.evaluate(()=>doc.fields[0].table.given[0][0]),'分類');
  assert.ok(!await page.evaluate(()=>docJson(true).includes('自動の答え')));
  const geometry=await page.evaluate(()=>JSON.stringify([doc.paper,doc.grid,doc.fields[0].rects,doc.fields[0].label]));await page.evaluate(()=>editTableField(doc.fields[0]));await page.click('#table-save');assert.equal(await page.evaluate(()=>JSON.stringify([doc.paper,doc.grid,doc.fields[0].rects,doc.fields[0].label])),geometry);
  console.log('PASS: answer-tab structural undo/redo, auto-generation, TSV answer serialization, public-cell reparse and regeneration');
  // An enlarged table expands the working area; an occupied destination leaves the document untouched.
  await page.evaluate(()=>{doc=buildAutoDocument(parseAutoAnswers('1\n1,,4,知,表,3×4'),'国語');startApp();});await page.evaluate(()=>editTableField(doc.fields[0]));await page.fill('#table-cols','20');await page.fill('#table-rows','30');await page.click('#table-resize');await page.fill('[data-table-cell="29,19"]','末尾');await page.click('#table-save');await page.locator('.table-modal').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>outsideCount(doc)),0);assert.ok(await page.evaluate(()=>contentScale(doc)<1));assert.equal(await page.evaluate(()=>doc.fields[0].table.cols),20);
  const beforeCollision=await page.evaluate(()=>{doc=newDoc('数学');doc.paper.showScoreBox=false;const table=tableSpec({},2,2);doc.fields=[{id:'f1',type:12,table,rects:[{c:2,r:10,w:4,h:6}],points:0,aspect:'知技',note:'',notePos:'end'},{id:'f2',type:2,rects:[{c:6,r:10,w:1,h:3}],points:0,aspect:'知技',note:'',notePos:'end'}];doc.answers={f1:'A\tB\nC\tD'};startApp();return docJson(false);});await page.evaluate(()=>editTableField(doc.fields[0]));await page.click('[data-table-op="col-after"]');await page.click('#table-save');assert.match(await page.locator('#table-status').innerText(),/ほかの欄/);assert.equal(await page.evaluate(()=>docJson(false)),beforeCollision);await page.click('#table-cancel');
  console.log('PASS: expanding beyond A4 preserves the table, and collision rejection is atomic');
  // Export a known table: all cells are regular merged Excel cells with internal borders.
  await page.evaluate(()=>{doc=newDoc('国語');doc.paper.showScoreBox=false;doc.fields=[{id:'f1',type:12,table:tableSpec({given:[['見出し','項目'],['','']]},2,2),rects:[{c:5,r:10,w:4,h:6}],points:4,aspect:'知技',note:'',notePos:'end'}];doc.answers={f1:'見出し\t項目\n秘密の答え\t値'};startApp();setContentScale(50);});
  const pending=page.waitForEvent('download');await page.click('#btn-xlsx');await(await pending).saveAs(path.join(out,'table.xlsx'));await page.emulateMedia({media:'print'});await page.pdf({path:path.join(out,'table.pdf'),preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});
  await page.evaluate(()=>editTableField(doc.fields[0]));await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('.table-modal .card').evaluate(el=>el.getBoundingClientRect().width<=innerWidth));await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});await page.click('#table-cancel');await page.setViewportSize({width:1400,height:1000});await page.evaluate(()=>editTableField(doc.fields[0]));await page.screenshot({path:path.join(out,'editor.png'),fullPage:true});await page.click('#table-cancel');
  const target=await page.evaluate(()=>{const f=doc.fields[0],r=f.rects[0],b=svg.getBoundingClientRect(),p=viewportPage(doc);return {x:b.left+(geo.x0+colXmm(r.c+2)+CW/2)/p.w*b.width,y:b.top+(geo.y0+(r.r+4)*RH)/p.h*b.height};});await page.mouse.dblclick(target.x,target.y);assert.equal(await page.locator('.table-modal').count(),1,JSON.stringify(await page.evaluate(p=>({target:p,hit:document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,200),cur:ui.cur,mode:ui.mode,tab:ui.tab,targets:ui.targets,move:ui.moveMode,cell:pointToCell({clientX:p.x,clientY:p.y})}),target)));assert.equal(await page.locator('[data-table-cell="1,1"]').evaluate(el=>el===document.activeElement),true);await page.click('#table-cancel');assert.deepEqual(errors,[]);
  const py=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`
import sys
from pathlib import Path
from openpyxl import load_workbook
from pypdf import PdfReader
p=Path(sys.argv[1]);b=load_workbook(p/'table.xlsx')
assert b.sheetnames==['解答用紙','模範解答']
for s in b:
 assert s['F11'].value=='見出し' and s['H11'].value=='項目'
 assert s['F11'].alignment.textRotation==0
 for ref in ['F11:G13','H11:I13','F14:G16','H14:I16']:assert ref in {str(r) for r in s.merged_cells.ranges}
 for ref in ['F11','H11','F14','H14']:
  c=s[ref];assert c.border.top.style and c.border.bottom.style and c.border.left.style and c.border.right.style
 if s.title=='解答用紙':assert s['F14'].value is None and s['H14'].value is None
 else:assert s['F14'].value=='秘密の答え' and s['H14'].value=='値'
 ranges=list(s.merged_cells.ranges)
 for i,r in enumerate(ranges):
  for t in ranges[i+1:]:assert r.max_col<t.min_col or t.max_col<r.min_col or r.max_row<t.min_row or t.max_row<r.min_row
pdf=PdfReader(p/'table.pdf');assert len(pdf.pages)==1
print('PASS: Excel table cells, all internal borders, given/answer separation, no overlapping merges, and one-page A4 PDF')
`,out],{encoding:'utf8'});process.stdout.write(py.stdout||'');process.stderr.write(py.stderr||'');assert.equal(py.status,0);console.log('PASS: table export and mobile editor\nArtifacts: '+out);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
