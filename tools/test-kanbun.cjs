const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'answer-kanbun-'));
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium'});
  const page=await browser.newPage({viewport:{width:1366,height:950},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.click('#btn-from-answers');await page.fill('#creation-title','漢文のテスト');await page.click('#creation-next');
  await page.fill('#auto-source','1\n1,不/ズ/レ 学/ブ/,4,知,漢文\n2,1 4//レ 3//レ 2,4,知,漢文\n3,6//下 1 4//二 2 3 5//上,6,知,漢文');await page.click('#auto-parse');
  assert.deepEqual(await page.locator('[data-k="kind"]').evaluateAll(ns=>ns.map(n=>n.value)),['kanbun','kanbun','kanbun']);
  await page.click('[data-kanbun="0"]');await page.check('[data-print="0-2"]');
  await page.screenshot({path:path.join(out,'editor.png')});await page.click('#kanbun-save');await page.click('#auto-apply');
  assert.deepEqual(await page.evaluate(()=>doc.fields.map(f=>f.type)),[11,11,11]);
  assert.equal(await page.locator('.answer-vectors').textContent(),'レ');
  assert.equal(await page.locator('.answer-vectors line').count(),48);
  await page.click('#tab-answer');assert.match(await page.locator('.answer-vectors').textContent(),/不/);assert.match(await page.locator('.answer-vectors').textContent(),/学/);
  const bounds=await page.evaluate(()=>doc.fields.map(f=>{const b=rectMM(doc,f.rects[0]);return kanbunPrimitives(doc,f,doc.answers[f.id],true).every(v=>v.k==='line'?[v.x1,v.x2].every(x=>x>=b.x&&x<=b.x+b.w)&&[v.y1,v.y2].every(y=>y>=b.y&&y<=b.y+b.h):v.x>b.x&&v.x<b.x+b.w&&v.y>b.y&&v.y<b.y+b.h);}));assert.ok(bounds.every(Boolean));
  await page.screenshot({path:path.join(out,'answers.png'),fullPage:true});
  // Dedicated editor, cancel, input validation, undo, persistence, regeneration.
  await page.evaluate(()=>{ui.cur={...doc.fields[0].rects[0]};ui.targets=[];ui.sel=null;render();});await page.click('#t-kanbun');
  await page.fill('[data-i="1"][data-j="0"]','習');await page.click('#kanbun-cancel');assert.match(await page.evaluate(()=>doc.answers.f1),/学/);
  await page.click('#t-kanbun');await page.fill('[data-i="1"][data-j="0"]','/');assert.equal(await page.locator('#kanbun-save').isDisabled(),true);
  await page.fill('[data-i="1"][data-j="0"]','習');await page.click('#kanbun-save');assert.match(await page.evaluate(()=>doc.answers.f1),/習/);
  await page.keyboard.press('Control+z');assert.match(await page.evaluate(()=>doc.answers.f1),/学/);await page.keyboard.press('Control+y');
  await page.evaluate(()=>{loadWork(docJson());});assert.match(await page.evaluate(()=>doc.answers.f1),/習/);assert.match(await page.evaluate(()=>doc.fields[0].kanbunGiven),/レ/);
  await page.click('#btn-answer-editor');await page.click('#auto-apply');
  assert.match(await page.evaluate(()=>doc.fields[0].kanbunGiven),/レ/);
  const dl=page.waitForEvent('download');await page.click('#btn-xlsx');await(await dl).saveAs(path.join(out,'kanbun.xlsx'));
  await page.click('#tab-answer');await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{ui.cur={...doc.fields[0].rects[0]};ui.targets=[];render();});await page.click('#t-kanbun');
  assert.ok(await page.locator('.modal .card').evaluate(n=>n.scrollWidth<=n.clientWidth));await page.screenshot({path:path.join(out,'mobile.png')});await page.keyboard.press('Escape');
  // Manual placement leaves numeric shortcuts unchanged; malformed source rejects atomically.
  await page.setViewportSize({width:1366,height:950});await page.evaluate(()=>{doc=newDoc('国語');startApp();});await page.click('#t-kanbun-place');await page.fill('.modal [data-k="n"]','4');await page.click('.modal [data-act="ok"]');
  assert.equal(await page.evaluate(()=>doc.fields[0].type),11);assert.equal(await page.evaluate(()=>doc.fields[0].rects[0].h),16);
  assert.equal(await page.evaluate(()=>fieldFromCode('Digit0')),10);
  assert.equal(await page.evaluate(()=>{try{parseKanbun('不/ズ/レ/一');return false;}catch{return true;}}),true);
  assert.deepEqual(errors,[]);
  const check=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`
from zipfile import ZipFile
from xml.etree import ElementTree as E
from openpyxl import load_workbook
import sys,warnings
warnings.filterwarnings('ignore',category=UserWarning)
p=sys.argv[1];ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','xdr':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'}
with ZipFile(p) as z:
 assert z.testzip() is None
 a=E.fromstring(z.read('xl/drawings/drawing1.xml'));b=E.fromstring(z.read('xl/drawings/drawing2.xml'))
 for drawing in [a,b]:
  for anchor in list(drawing):
   group=anchor.find('xdr:grpSp/xdr:nvGrpSpPr/xdr:cNvPr',ns)
   if group is not None and group.attrib.get('name')=='score-box':drawing.remove(anchor)
 assert [n.text for n in a.findall('.//a:t',ns)]==['レ']
 texts=[n.text for n in b.findall('.//a:t',ns)]
 assert all(t in texts for t in ['不','ズ','習','ブ','レ','下','二','上','6'])
 assert len(a.findall('.//a:prstGeom[@prst="line"]',ns))==48
 assert len(b.findall('.//a:prstGeom[@prst="line"]',ns))==48
 for drawing in [a,b]:
  assert len(drawing.findall('xdr:twoCellAnchor',ns))==3
book=load_workbook(p)
assert book.sheetnames==['解答用紙','模範解答']
for s in book:
 ranges=list(s.merged_cells.ranges)
 for i,r in enumerate(ranges):
  for t in ranges[i+1:]: assert r.max_col<t.min_col or t.max_col<r.min_col or r.max_row<t.min_row or t.max_row<r.min_row
print('PASS: independent Excel check (squares, preprinted marks, model text, nonoverlapping merges)')
`,path.join(out,'kanbun.xlsx')],{encoding:'utf8'});process.stdout.write(check.stdout);process.stderr.write(check.stderr);assert.equal(check.status,0);
  console.log('PASS: Kanbun creation, both print modes, editing, validation, undo, save/load, regeneration, mobile and manual placement\n'+out);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
