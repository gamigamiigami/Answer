const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'answer-subnumbers-'));
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium'});const page=await browser.newPage({viewport:{width:1366,height:950},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));await page.goto('http://127.0.0.1:'+server.address().port);
  const parse=s=>page.evaluate(s=>parseAutoAnswers(s,{points:2,aspect:'知技'}),s);
  for(const [source,labels,answers] of [
   ['1\n1,①,ア\n②,イ',['問一①','問一②'],['ア','イ']],
   ['1\n1,A,ア\nB,イ',['問一A','問一B'],['ア','イ']],
   ['1\n１，（１），ア\n（２），イ',['問一（１）','問一（２）'],['ア','イ']],
   ['1\n1①,ア\n②,イ\n問二A,ウ\nB,エ',['問一①','問一②','問二A','問二B'],['ア','イ','ウ','エ']],
   ['1\n１Ａ,ア\nＢ,イ\n2a,ウ\nb,エ',['問一Ａ','問一Ｂ','問二a','問二b'],['ア','イ','ウ','エ']],
   ['1\n問一\n① ア\n② イ\n問二\nA ウ\nB エ',['問一①','問一②','問二A','問二B'],['ア','イ','ウ','エ']],
   ['1\n問一（１） ア\n（２） イ',['問一（１）','問一（２）'],['ア','イ']],
   ['1\n1A,12\nB,知',['問一A','問一B'],['12','知']],
   ['1\n1,㉑,ア\n㊿,イ',['問一㉑','問一㊿'],['ア','イ']],
   ['1\n1,A,12,2,知\nB,3,4,思',['問一A','問一B'],['12','3']],
   ['1\n1,①,ア\n2\nA,ウ',['問一①','A'],['ア','ウ']],
   ['1\n①,ア\n②,イ',['①','②'],['ア','イ']]
  ]){
   const rows=await parse(source);assert.deepEqual(rows.map(r=>r.label),labels,source);assert.deepEqual(rows.map(r=>r.answer),answers,source);
   for(const compact of [false,true]){const again=await page.evaluate(({rows,compact})=>{const d={points:2,aspect:'知技'};return parseAutoAnswers(autoRowsSource(rows,compact?d:undefined),d);},{rows,compact});assert.deepEqual(again.map(r=>[r.label,r.answer,r.points,r.aspect]),rows.map(r=>[r.label,r.answer,r.points,r.aspect]));}
  }
  const safe=await parse('1\n1,A,2,知\n2,①,2,知\n3,"(A)",2,知\n4,Apple,2,知');assert.deepEqual(safe.map(r=>r.answer),['A','①','(A)','Apple']);assert.deepEqual(safe.map(r=>r.label),['問一','問二','問三','問四']);
  assert.equal((await parse('A cat is sleeping.'))[0].answer,'A cat is sleeping.');assert.equal((await parse('Apple'))[0].answer,'Apple');
  assert.deepEqual(await page.evaluate(()=>splitAutoQuestionLabel('CustomLabel')),{main:'CustomLabel',suffix:''});
  console.log('PASS: circled, alphabetic, full-width, parenthesized, attached and separated labels; inheritance/reset, safe answer letters and source round trips');
  await page.click('#btn-from-answers');await page.fill('#creation-title','小問番号のテスト');await page.click('#creation-next');
  const source='1\n1，①，ア\n②，イ\n2，A，ウ\nB，エ\n3，（１），オ\n（２），カ';await page.fill('#auto-source',source);await page.click('#auto-parse');
  assert.deepEqual(await page.locator('[data-row] [data-k="subLabel"]').evaluateAll(ns=>ns.map(n=>n.value)),['①','②','A','B','（１）','（２）']);
  assert.deepEqual(await page.locator('[data-row] [data-k="label"]').evaluateAll(ns=>ns.map(n=>n.value)),['問一','問一','問二','問二','問三','問三']);
  // Dropdown edits retain shape, and source reparses as the same subquestion.
  await page.locator('[data-row="0"] [data-k="subLabel"]').selectOption('③');assert.match(await page.locator('#auto-source').inputValue(),/1￥③￥ア/);
  await page.locator('[data-row="0"] [data-k="subLabel"]').selectOption('①');await page.click('#auto-back');await page.click('#auto-parse');
  await page.screenshot({path:path.join(output,'review.png'),fullPage:true});await page.click('#auto-apply');
  assert.equal(await page.evaluate(()=>doc.decorations.filter(d=>d.questionHeading).length),3);
  const questionIds=await page.evaluate(()=>doc.fields.map(f=>f.auto.questionId));assert.equal(questionIds[0],questionIds[1]);assert.equal(questionIds[2],questionIds[3]);assert.equal(questionIds[4],questionIds[5]);
  const actual=await page.evaluate(()=>doc.fields.map(f=>doc.texts[f.label.c+','+f.label.r].t));assert.deepEqual(actual,['①','②','A','B','（１）','（２）']);
  await page.click('#tab-answer');await page.screenshot({path:path.join(output,'sheet.png'),fullPage:true});
  let dl=page.waitForEvent('download');await page.click('#btn-xlsx');await(await dl).saveAs(path.join(output,'vertical.xlsx'));
  await page.evaluate(()=>loadWork(docJson()));await page.click('#btn-answer-editor');assert.deepEqual(await page.locator('[data-row] [data-k="subLabel"]').evaluateAll(ns=>ns.map(n=>n.value)),actual);
  await page.check('#auto-replace');await page.click('#auto-apply');assert.deepEqual(await page.evaluate(()=>doc.fields.map(f=>doc.texts[f.label.c+','+f.label.r].t)),actual);
  // Horizontal subjects use the same hierarchy and labels.
  await page.evaluate(source=>{doc=buildAutoDocument(parseAutoAnswers(source,{subject:'数学',points:2,aspect:'知技'}),'数学');startApp();},source);
  dl=page.waitForEvent('download');await page.click('#btn-xlsx');await(await dl).saveAs(path.join(output,'horizontal.xlsx'));
  await page.click('#btn-answer-editor');await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('.auto-modal .card').evaluate(n=>n.scrollWidth<=n.clientWidth));await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  const check=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`
from openpyxl import load_workbook
import sys
for p in sys.argv[1:]:
 b=load_workbook(p)
 for s in b:
  values=[str(c.value) for row in s for c in row if c.value is not None]
  for t in ['①','②','A','B','（１）','（２）','問一','問二','問三']:assert values.count(t)==1,(p,s.title,t)
  ranges=list(s.merged_cells.ranges)
  for i,r in enumerate(ranges):
   for t in ranges[i+1:]:assert r.max_col<t.min_col or t.max_col<r.min_col or r.max_row<t.min_row or t.max_row<r.min_row
print('PASS: Excel in both writing directions preserves all subquestion glyphs and shared parents, without overlapping merges')
`,path.join(output,'vertical.xlsx'),path.join(output,'horizontal.xlsx')],{encoding:'utf8'});process.stdout.write(check.stdout);process.stderr.write(check.stderr);assert.equal(check.status,0);
  console.log('PASS: UI editing, parent sharing, save/load, regeneration and mobile\n'+output);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
