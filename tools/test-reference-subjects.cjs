// Regression cases observed in the supplied Word/Excel reference answer sheets.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {chromium}=require('playwright'),{spawnSync}=require('node:child_process');
(async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'testomo-reference-subjects-'));
 const server=require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.resolve(__dirname,'../answer-sheet-maker.html')));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium'});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const source='1\n⑴A￥日米安全保障条約￥2￥知\nB￥サンフランシスコ平和条約￥2￥知\n⑵￥ア￥1￥知\n⑸Ⅰ￥B￥1￥知\nⅡ￥A￥1￥知\n⑿￥F￥1￥知';
  const rows=await page.evaluate(source=>parseAutoAnswers(source,{subject:'社会',groupStyle:'digit'}),source);
  assert.deepEqual(rows.map(r=>r.label),['⑴A','⑴B','⑵','⑸Ⅰ','⑸Ⅱ','⑿']);
  assert.deepEqual(rows.map(r=>r.answer),['日米安全保障条約','サンフランシスコ平和条約','ア','B','A','F']);
  const roundtrip=await page.evaluate(rows=>parseAutoAnswers(autoRowsSource(rows),{subject:'社会',groupStyle:'digit'}),rows);
  assert.deepEqual(roundtrip.map(r=>[r.label,r.answer]),rows.map(r=>[r.label,r.answer]));
  const plain=await page.evaluate(()=>parseAutoAnswers('1\n⑴A　日米安全保障条約\nB　サンフランシスコ平和条約\n⑵　ア\n⑸Ⅰ　B\nⅡ　A',{subject:'社会',groupStyle:'digit'}));
  assert.deepEqual(plain.map(r=>r.label),['⑴A','⑴B','⑵','⑸Ⅰ','⑸Ⅱ']);
  assert.deepEqual(await page.evaluate(()=>parseAutoAnswers('1\n"３番目"￥H\n⒀①￥高度経済成長\n②￥三種の神器',{subject:'社会'}).map(r=>r.label)),['３番目','⒀①','⒀②']);
  console.log('PASS: parenthesized Unicode numbers, Roman/Latin children and source round trip');
  for(const subject of ['数学','英語','理科','社会']){
   const result=await page.evaluate(subject=>{
    const rows=parseAutoAnswers('1\n⑴①￥ア￥1￥知￥記号\n②￥イ￥1￥知￥記号\n⑵①￥山￥1￥知￥漢字1字\n②￥川￥1￥知￥漢字1字',{subject});
    const d=buildAutoDocument(rows,subject,{...newDoc(subject).paper,groupHeading:'above'});
    return d.fields.map(f=>{
     const a=f.rects[0],label=f.label,parent=d.decorations.find(v=>v.id===f.auto.questionId);
     return {aligned:label.r===a.r && label.h===a.h && (!parent || parent.r===a.r && parent.h===a.h),wide:f.type!==2 || a.w===2,
      complete:answerPlan(d,f,d.answers[f.id]).need<=answerPlan(d,f,d.answers[f.id]).room,
      merged:f.type!==2 || [...buildCells(d,true).values()].some(c=>c.c===a.c && c.r===a.r && c.mg?.w===2)};
    });
   },subject);
   assert.equal(result.length,4);assert.ok(result.every(r=>r.aligned && r.wide && r.complete && r.merged),JSON.stringify({subject,result}));
  }
  console.log('PASS: parent/child number boxes match the answer height; wide answer cells remain merged in Excel');
  const samples={
   '社会':source+'\n2\n⑴￥先進工業国と発展途上国の経済格差の問題。￥2￥思\n⑵￥三権分立￥2￥知',
   '理科':'1\n（１）￥原子￥2￥知\n（２）￥分子￥2￥知\n（３）￥H₂O￥2￥知\n2\n（１）￥2H₂O → 2H₂ + O₂￥2￥知\n（２）￥6.8 km/s￥2￥知\n（３）￥あたたかく浅い海￥2￥知',
   '英語':'1\n（1）￥plastic bags￥2￥知\n（2）￥must not eat￥2￥知\n2\n（1）￥What do you mean?￥2￥知\n（2）￥You must not open the textbook during the test.￥2￥思',
   '数学':'1\n⑴￥￥2￥知￥解答欄のみ￥4×2\n⑵￥￥2￥知￥解答欄のみ￥4×2\n2\n⑴①￥￥2￥知￥解答欄のみ￥6×2\n②￥￥2￥知￥解答欄のみ￥6×2'
  };
  for(const [subject,source] of Object.entries(samples)){
   await page.evaluate(({subject,source})=>{doc=null;openAnswerGenerator('原本の形式を確認');const select=document.querySelector('#auto-subject');select.value=subject;select.dispatchEvent(new Event('change'));const input=document.querySelector('#auto-source');input.value=source;input.dispatchEvent(new Event('input',{bubbles:true}));},{subject,source});
   assert.equal(await page.locator('#auto-group-heading').inputValue(),'above');
   await page.click('#auto-parse');await page.click('#auto-apply');assert.equal(await page.locator('.auto-modal').count(),0);
   const state=await page.evaluate(()=>{
    const occupied=new Set(headerLayout(doc).reserved);let overlaps=0;
    for(const f of doc.fields)for(const [c,r] of fieldFootprint(doc,f)){const key=c+','+r;if(occupied.has(key))overlaps++;occupied.add(key);}
    const headings=Object.entries(doc.texts).filter(([,v])=>v.autoGroup);
    return {pages:allPages().length,spread:spreadEnabled(doc),outside:countOutside(doc,doc.grid),overlaps,
     above:headings.every(([key,h])=>{const r=Number(key.split(',')[1]);return doc.fields.filter(f=>f.auto.group===h.t).every(f=>f.rects[0].r>r);}),
     complete:doc.fields.every(f=>answerPlan(doc,f,doc.answers[f.id]||'').need<=answerPlan(doc,f,doc.answers[f.id]||'').room)};
   });
   assert.equal(state.pages,1);assert.equal(state.spread,false);assert.equal(state.outside,0);assert.equal(state.overlaps,0);assert.ok(state.above && state.complete);
   await page.click('#tab-answer');await page.screenshot({path:path.join(out,subject+'.png'),fullPage:true});
   await page.pdf({path:path.join(out,subject+'.pdf'),preferCSSPageSize:true});
   const saved=await page.evaluate(()=>docJson(false));await page.evaluate(saved=>loadWork(saved),saved);
   await page.click('#btn-answer-editor');assert.equal(await page.locator('#auto-group-heading').inputValue(),'above');await page.click('#auto-apply');
   assert.deepEqual(await page.evaluate(()=>doc.fields.map(f=>f.rects)),JSON.parse(saved).fields.map(f=>f.rects));
   console.log('PASS:',subject,'reference heading placement, complete answers, nonoverlap, single A4 and re-edit');
  }
  assert.deepEqual(errors,[]);
  const result=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`from pypdf import PdfReader
from pathlib import Path
import sys
for f in Path(sys.argv[1]).glob('*.pdf'):
 p=PdfReader(f).pages
 assert len(p)==1
 assert abs(float(p[0].mediabox.width)*25.4/72-210)<1
 assert abs(float(p[0].mediabox.height)*25.4/72-297)<1
print('PASS: all four single-page PDFs are A4 portrait')`,out],{encoding:'utf8'});
  process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');assert.equal(result.status,0);
  console.log('Artifacts: '+out);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
