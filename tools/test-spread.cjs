// Actual generation, editable spread previews and independently measured A3 PDFs.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'testomo-spread-'));
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium'});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(require('node:url').pathToFileURL(path.resolve(__dirname,'../answer-sheet-maker.html')).href);
  for(const subject of ['数学','英語','理科','社会']){
   await page.evaluate(subject=>{
    doc=null;openAnswerGenerator('見開き検証');document.querySelector('#auto-subject').value=subject;
    const source=document.querySelector('#auto-source');
    source.value='1\n'+Array.from({length:130},(_,i)=>(i+1)+'￥'+(subject==='英語'?'This is a sample answer.':subject==='数学'?'x^2 + 1/2':'見本の答え')+'￥2￥知').join('\n');
    source.dispatchEvent(new Event('input',{bubbles:true}));
   },subject);
   await page.click('#auto-parse');await page.click('#auto-apply');
   assert.equal(await page.locator('.auto-modal').count(),0);
   const checks=await page.evaluate(()=>({count:allPages().length,fields:allPages().reduce((n,p)=>n+p.fields.length,0),scale:allPages().map(contentScale),spread:spreadEnabled(doc)}));
   assert.ok(checks.count>1);assert.equal(checks.fields,130);assert.ok(checks.scale.every(s=>s>=.95));assert.ok(checks.spread);
   const saved=await page.evaluate(()=>docJson(false));
   await page.locator('.spread-peer').click();assert.equal(await page.evaluate(()=>doc.pageIndex),1);
   const boxes=await page.evaluate(()=>({left:document.querySelector('.spread-peer').getBoundingClientRect().x,right:svg.getBoundingClientRect().x}));assert.ok(boxes.left<boxes.right);
   await page.evaluate(()=>switchPage(0));assert.equal(await page.evaluate(()=>docJson(false)),saved);
   await page.click('#tab-answer');await page.screenshot({path:path.join(out,subject+'.png'),fullPage:true});
   await page.evaluate(()=>prepareBookPrint());
   assert.equal(await page.locator('#print-book .print-page').count(),Math.ceil(checks.count/2));
   await page.pdf({path:path.join(out,subject+'.pdf'),preferCSSPageSize:true,printBackground:true});
   await page.evaluate(()=>clearBookPrint());
   assert.equal(await page.evaluate(()=>docJson(false)),saved);
   await page.evaluate(saved=>loadWork(saved),saved);assert.ok(await page.evaluate(()=>spreadEnabled(doc)));
   const labels=await page.evaluate(()=>doc.fields.map(f=>f.auto.label));assert.equal(labels[0],'問1');
   console.log('PASS:',subject,'130 answers, readable automatic pages, left/right editing, print and save/load');
  }
  await page.evaluate(()=>switchPage(1));
  const beforeEdit=await page.evaluate(()=>docJson(false));
  const otherPages=await page.evaluate(()=>allPages().filter((_,i)=>i!==1));
  await page.click('#btn-answer-editor');await page.locator('[data-k="answer"]').first().fill('修正');await page.click('#auto-apply');
  assert.equal(await page.evaluate(()=>doc.answers[doc.fields[0].id]),'修正');
  assert.deepEqual(await page.evaluate(()=>allPages().filter((_,i)=>i!==1)),otherPages);
  await page.click('#btn-undo');assert.equal(await page.evaluate(()=>docJson(false)),beforeEdit);
  await page.click('#btn-redo');assert.equal(await page.evaluate(()=>doc.answers[doc.fields[0].id]),'修正');
  console.log('PASS: second-page answer update preserves other pages, undo and redo');
  await page.evaluate(()=>{
   const pages=Array.from({length:3},(_,i)=>{const d=buildAutoDocument(parseAutoAnswers('1￥PAGE'+(i+1)+'￥2￥知',{subject:'英語'}),'英語');return d;});
   replacePageData(pages[0],pages,0);ui.tab='answer';render();
  });
  await page.pdf({path:path.join(out,'order.pdf'),preferCSSPageSize:true});
  await page.evaluate(()=>switchPage(2));assert.equal(await page.locator('.spread-blank').count(),1);
  await page.evaluate(()=>{switchPage(0);ui.tab='sheet';render();});
  await page.pdf({path:path.join(out,'blank.pdf'),preferCSSPageSize:true});
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('#paper').getBoundingClientRect().width<=document.documentElement.clientWidth);
  assert.ok(await page.locator('#paper').evaluate(e=>e.getBoundingClientRect().width<=document.documentElement.clientWidth));
  await page.evaluate(()=>{doc=newDoc('国語');startApp();addPage();});assert.equal(await page.locator('#paper.spread').count(),0);
  assert.deepEqual(errors,[]);
  // A single physical sheet needs one name/score footer, on its last occupied half.
  for(const count of [1,2,3,4]){
   const result=await page.evaluate(count=>{
    const pages=Array.from({length:count},()=>buildAutoDocument(parseAutoAnswers('1￥sample￥2￥知',{subject:'英語'}),'英語'));
    pages.forEach(p=>p.paper.nameLabel='FOOTER_NAME');
    replacePageData(pages[0],pages,0);ui.tab='sheet';render();
    const saved=docJson(false),expected=pages.map((_,i)=>count===1 || i%2===1 || i===count-1);
    const actual=allPages().map(p=>({name:headerLayout(p).texts.some(t=>t.t==='FOOTER_NAME'),score:!!scoreBoxBounds(p),excel:[...buildCells(p,false).values()].some(c=>c.t==='FOOTER_NAME')}));
    const preview=[];
    for(let i=0;i<count;i++){switchPage(i);preview.push({name:svg.textContent.includes('FOOTER_NAME'),score:!!svg.querySelector('.score-box')});}
    switchPage(0);prepareBookPrint();
    const print=[...document.querySelectorAll('#print-book .print-page > svg')].map(s=>({name:s.textContent.includes('FOOTER_NAME'),score:!!s.querySelector('.score-box')}));
    clearBookPrint();
    return {expected,actual,preview,print,unchanged:docJson(false)===saved};
   },count);
   assert.deepEqual(result.actual,result.expected.map(v=>({name:v,score:v,excel:v})));
   assert.deepEqual(result.preview,result.expected.map(v=>({name:v,score:v})));
   if(count>1)assert.deepEqual(result.print,result.expected.map(v=>({name:v,score:v})));
   assert.ok(result.unchanged);
  }
  await page.evaluate(()=>{const p=allPages()[0];replacePageData(p,[p],0);render();});
  assert.ok(await page.evaluate(()=>svg.textContent.includes('FOOTER_NAME') && !!scoreBoxBounds(doc)));
  assert.deepEqual(errors,[]);
  console.log('PASS: name/score appear once per sheet in preview, print and Excel; single-page restoration preserves settings');
  const check=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`
from pathlib import Path
from pypdf import PdfReader
import sys
p=Path(sys.argv[1])
for f in p.glob('*.pdf'):
 b=PdfReader(f)
 for page in b.pages:
  assert abs(float(page.mediabox.width)*25.4/72-420)<1,(f,page.mediabox)
  assert abs(float(page.mediabox.height)*25.4/72-297)<1
b=PdfReader(p/'order.pdf');assert len(b.pages)==2
assert 'PAGE1' in b.pages[0].extract_text() and 'PAGE2' in b.pages[0].extract_text()
assert 'PAGE3' in b.pages[1].extract_text()
assert all('PAGE' not in page.extract_text() for page in PdfReader(p/'blank.pdf').pages)
print('PASS: A3 420 x 297 mm, odd-page count/order and no model-answer leaks')
`,out],{encoding:'utf8'});process.stdout.write(check.stdout||'');process.stderr.write(check.stderr||'');assert.equal(check.status,0);
  console.log('Artifacts: '+out);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
