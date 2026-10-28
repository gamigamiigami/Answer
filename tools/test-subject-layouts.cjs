// node tools/test-subject-layouts.cjs — subject defaults, actual UI and exported workbooks
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const http=require('node:http');
const {spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
(async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'answer-subjects-'));
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.resolve(__dirname,'../answer-sheet-maker.html')));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH || '/usr/bin/chromium',headless:true});
 let count=0;const pass=m=>{count++;console.log('PASS:',m);};
 try{
  const page=await browser.newPage({viewport:{width:1366,height:1000},acceptDownloads:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
  await page.goto('http://127.0.0.1:'+server.address().port);
  for(const subject of ['数学','英語','理科','社会']){
   await page.evaluate(()=>{doc=null;openAnswerGenerator('教科別テスト');});
   await page.selectOption('#auto-subject',subject);
   assert.ok((await page.locator('#auto-subject-hint').innerText()).length>20);
   await page.click('#auto-example');await page.click('#auto-parse');
   assert.ok(await page.locator('[data-row]').count()>0);
   await page.click('#auto-apply');
   assert.equal(await page.locator('.auto-modal').count(),0,subject+' generation should succeed');
   const result=await page.evaluate(()=>{
    const used=new Set(headerLayout(doc).reserved);let overlaps=0;
    for(const f of doc.fields)for(const [c,r] of fieldFootprint(doc,f)){const k=c+','+r;if(used.has(k))overlaps++;used.add(k);}
    return {subject:doc.paper.subject,outside:countOutside(doc,doc.grid),overlaps,
     dims:doc.fields.map(f=>[f.auto.kind,f.rects[0].w,f.rects[0].h]),
     complete:doc.fields.every(f=>{const a=answerPlan(doc,f,doc.answers[f.id]||'');return a.need<=a.room;})};
   });
   assert.equal(result.subject,subject);assert.equal(result.outside,0);assert.equal(result.overlaps,0);assert.equal(result.complete,true);
   if(subject==='数学')assert.deepEqual(result.dims[0],['formula',4,4]);
   if(subject==='英語')assert.deepEqual(result.dims[1],['word',6,4]);
   if(subject==='理科'){assert.deepEqual(result.dims[0],['word',4,2]);assert.deepEqual(result.dims[5],['blank',6,4]);}
   if(subject==='社会'){assert.deepEqual(result.dims[1],['word',4,2]);assert.equal(result.dims[3][0],'essay');assert.equal(result.dims[3][2],6);}
   const saved=await page.evaluate(()=>docJson(false));
   await page.evaluate(s=>loadWork(s),saved);assert.equal(await page.evaluate(()=>docJson(false)),saved);
   const before=await page.evaluate(()=>({answers:doc.answers,fields:doc.fields.map(f=>({kind:f.auto.kind,rects:f.rects}))}));
   await page.click('#btn-answer-editor');await page.click('#auto-apply');
   assert.deepEqual(await page.evaluate(()=>({answers:doc.answers,fields:doc.fields.map(f=>({kind:f.auto.kind,rects:f.rects}))})),before);
   await page.click('#tab-answer');
   await page.screenshot({path:path.join(output,subject+'.png'),fullPage:true});
   const pending=page.waitForEvent('download');await page.click('#btn-xlsx');await(await pending).saveAs(path.join(output,subject+'.xlsx'));
   pass(subject+': example, dimensions, A4 bounds, save/load, editor regeneration and Excel download');
   await page.evaluate(subject=>{doc=newDoc(subject);applyTemplate(subject);},subject);
   assert.equal(await page.evaluate(()=>Object.keys(doc.answers).length),0);
   assert.ok(await page.evaluate(()=>doc.fields.length)>0);
   pass(subject+': template contains usable blank fields without model answers');
  }
  const rules=await page.evaluate(()=>{
   const parse=(s,subject)=>parseAutoAnswers('1\n1,'+s+',2,知',{subject})[0];
   return {kokugoTerms:['数式','英文','説明','化学式'].map(t=>parseAutoAnswers(t)[0].answer),range:parse('5～10','数学').kind,chem:parse('H₂O','理科').kind,english:parse('plastic bags','英語').kind,
    explicit:parse('太陽,漢字2字','社会').kind,
    sizes:['数学','英語','理科','社会'].map(subject=>{const d=buildAutoDocument(parseAutoAnswers('1\n1,答え,2,知,解答欄のみ,3×2',{subject}),subject);return d.fields[0].rects[0];}),
    roundtrip:['数学','英語','理科','社会'].every(subject=>{const rows=parseAutoAnswers(SUBJECT_SAMPLES[subject],{subject});const again=parseAutoAnswers(autoRowsSource(rows),{subject});return rows.every((r,i)=>r.answer===again[i].answer && r.kind===again[i].kind);})};
  });
  assert.deepEqual(rules.kokugoTerms,['数式','英文','説明','化学式']);
  assert.equal(rules.range,'formula');assert.equal(rules.chem,'formula');assert.equal(rules.english,'word');assert.equal(rules.explicit,'kanji');assert.equal(rules.roundtrip,true);
  assert.ok(rules.sizes.every(r=>r.w===3 && r.h===4));
  pass('Ranges are not extracts; chemistry, English, explicit kinds/dimensions and source round trips are preserved');
  const wrapping=await page.evaluate(()=>{
   const d=newDoc('英語'),f={type:6,rects:[{c:2,r:12,w:4,h:12}],fixedChars:false,textPt:11};
   const text='These students enjoy learning science together every day.';
   const plan=answerPlan(d,f,text), parts=plan.out.map(x=>x.ch);
   return {parts,text,used:parts.join(''),complete:plan.need<=plan.room,
    slash:fractionAnswerPlan(d,f,'and/or')};
  });
  assert.equal(wrapping.used,wrapping.text);assert.equal(wrapping.complete,true);assert.ok(wrapping.parts.slice(0,-1).every(p=>p.endsWith(' ')));assert.equal(wrapping.slash,null);
  pass('English wraps at word boundaries without losing spaces; slash phrases remain text');
  await page.evaluate(()=>{doc=null;openAnswerGenerator();});await page.selectOption('#auto-subject','理科');await page.click('#auto-example');await page.click('#auto-parse');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('.auto-modal .card').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:path.join(output,'science-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);pass('Subject editor fits a phone viewport with no JavaScript errors');
  const py=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`
import sys,warnings
from pathlib import Path
from openpyxl import load_workbook
warnings.filterwarnings('ignore',category=UserWarning)
for path in Path(sys.argv[1]).glob('*.xlsx'):
 b=load_workbook(path)
 assert b.sheetnames==['解答用紙','模範解答']
 for s in b:
  assert str(s.page_setup.paperSize)==s.PAPERSIZE_A4
  assert s.page_setup.orientation=='portrait'
  occupied=set()
  for m in s.merged_cells.ranges:
   for row in range(m.min_row,m.max_row+1):
    for col in range(m.min_col,m.max_col+1):
     assert (row,col) not in occupied,(path,m)
     occupied.add((row,col))
 texts=[str(c.value) for row in b['模範解答'] for c in row if c.value is not None]
 blank=[str(c.value) for row in b['解答用紙'] for c in row if c.value is not None]
 for expected in {'英語':['plastic bags','must not eat','What do you mean?'], '理科':['H₂O','2H₂O → 2H₂ + O₂','6.8 km/s'], '社会':['三権分立','地方分権'], '数学':['12']}[path.stem]:
  assert expected in texts,(path,expected,texts)
  assert expected not in blank,(path,expected)
 print('PASS: workbook',path.stem,'A4, separate answers, merged cells and model text')
`,output],{encoding:'utf8'});
  process.stdout.write(py.stdout);process.stderr.write(py.stderr);assert.equal(py.status,0);
  pass('All four exported workbooks pass independent openpyxl validation');
  console.log(count+' subject checks passed\nArtifacts: '+output);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
