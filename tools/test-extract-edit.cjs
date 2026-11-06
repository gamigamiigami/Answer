const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),{chromium}=require('playwright'),{spawnSync}=require('node:child_process');
(async()=>{const server=http.createServer((q,r)=>r.end(fs.readFileSync('answer-sheet-maker.html')));await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});try{const page=await browser.newPage({acceptDownloads:true,viewport:{width:1366,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined}));await page.goto('http://127.0.0.1:'+server.address().port);
for(const subject of ['国語','数学']){
await page.evaluate(subject=>{doc=buildAutoDocument(parseAutoAnswers('1\n1￥あいう～かきく',{subject}),subject);startApp(true);const f=doc.fields.find(f=>f.type===3),pt=extractParts(doc,f);ui.cur={c:pt.m1.c,r:pt.m1.r};ui.sel=null;},subject);
const before=await page.evaluate(()=>{const f=doc.fields.find(f=>f.type===3);return {id:f.id,answer:doc.answers[f.id],rect:{...f.rects[0]},label:JSON.stringify(f.label),points:f.points};});
await page.evaluate(()=>deleteCells());assert.equal(await page.evaluate(()=>doc.fields[0].extractConfig.firstCell),false);assert.equal(await page.evaluate(()=>charCells(doc,doc.fields[0]).length),6);await page.evaluate(()=>undo());await page.evaluate(()=>clearSelection());assert.deepEqual(await page.evaluate(()=>doc.fields.find(f=>f.type===3).marks),['','終わり']);assert.equal(await page.evaluate(()=>doc.fields.length),1);
await page.click('#t-extract');await page.fill('[data-k="last"]','');await page.uncheck('[data-k="firstCell"]');await page.click('[data-act="ok"]');
const after=await page.evaluate(()=>{const f=doc.fields.find(f=>f.type===3),pt=extractParts(doc,f);return {rect:f.rects[0],answer:doc.answers[f.id],label:JSON.stringify(f.label),points:f.points,marks:f.marks,pt,plan:answerPlan(doc,f,doc.answers[f.id])};});assert.equal(after.answer,before.answer);assert.equal(after.label,before.label);assert.equal(after.points,before.points);assert.deepEqual(after.marks,['','']);assert.equal(subject==='国語'?after.pt.m1.h:after.pt.m1.w,0);assert.equal(subject==='国語'?after.rect.h:after.rect.w,(subject==='国語'?before.rect.h:before.rect.w)-MARK());assert.equal(after.plan.out.map(x=>x.ch).join(''),'あいうかきく');
await page.evaluate(()=>undo());assert.equal(await page.evaluate(()=>doc.fields[0].extractConfig),undefined);await page.evaluate(()=>redo());
await page.evaluate(()=>{const text=docJson(false);loadWork(text);});assert.equal(await page.evaluate(()=>doc.fields[0].extractConfig.firstCell),false);
await page.evaluate(()=>{const f=doc.fields[0],pt=extractParts(doc,f);ui.cur={c:pt.m2.c,r:pt.m2.r};ui.sel=null;deleteCells();});
assert.equal(await page.evaluate(()=>doc.fields[0].extractConfig.lastCell),false);assert.equal(await page.evaluate(()=>charCells(doc,doc.fields[0]).length),6);assert.equal(await page.evaluate(()=>{const f=doc.fields[0],p=extractParts(doc,f),r=f.rects[0];return doc.paper.writing==='vertical'?p.b.r+p.b.h===r.r+r.h:p.b.c+p.b.w===r.c+r.w;}),true);
const download=page.waitForEvent('download');await page.click('#btn-xlsx');await(await download).saveAs('/tmp/extract-edit-'+subject+'.xlsx');
}
const result=spawnSync('python3',['-c',`import openpyxl
for subject in ['国語','数学']:
 b=openpyxl.load_workbook('/tmp/extract-edit-'+subject+'.xlsx')
 for s in b:
  text=''.join(str(c.value or '') for row in s for c in row)
  assert '初め' not in text and '終わり' not in text,text
 text=''.join(str(c.value or '') for row in b.worksheets[1] for c in row)
 assert all(c in text for c in 'あいうかきく'),text
print('PASS Excel: headings removed, model answers retained')`],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);console.log(result.stdout);assert.deepEqual(errors,[]);console.log('PASS partial extract editing, vertical/horizontal, save/load');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
function MARK(){return 1;}
