const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'answer-kanji-fixed-'));
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(process.env.TEST_HTML || path.join(__dirname,'../answer-sheet-maker.html')));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH || '/usr/bin/chromium',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1366,height:1000},acceptDownloads:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
  await page.goto('http://127.0.0.1:'+server.address().port);
  for(const subject of ['国語','数学','英語','理科','社会','その他']){
   const result=await page.evaluate(subject=>{
    const words=['山','温故知新','一二三四五六七八九十','一二三四五六七八九十一','一二三四五六七八九十一二','一二三四五六七八九十一二三四五'];
    const rows=parseAutoAnswers('1\n'+words.map((a,i)=>(i+1)+'￥'+a+'￥2￥知￥漢字'+Array.from(a).length+'字').join('\n'),{subject});
    doc=buildAutoDocument(rows,subject,{...newDoc(subject).paper,groupHeading:'above'});startApp();
    const cells=buildCells(doc,true),blank=buildCells(doc,false),used=new Set(headerLayout(doc).reserved);let overlaps=0;
    const fields=doc.fields.map((f,i)=>{
     for(const [c,r] of fieldFootprint(doc,f)){const k=c+','+r;if(used.has(k))overlaps++;used.add(k);}
     const plan=answerPlan(doc,f,words[i]),b=f.rects[0];
     return {rect:b,cols:doc.colw.slice(b.c,b.c+b.w),out:plan.out.map(x=>x.ch).join(''),size:plan.out[0].size,room:plan.room,need:plan.need,
      border:unionBorders(cells,b.c,b.r,b.w,b.h),blankBorder:unionBorders(blank,b.c,b.r,b.w,b.h),
      insideLines:[...cells.values()].filter(c=>c.c>=b.c && c.c<b.c+b.w && c.r>=b.r && c.r<b.r+b.h).some(c=>c.c>b.c && c.b.left || c.r>b.r && c.b.top)};
    });
    return {words,fields,overlaps,outside:countOutside(doc,doc.grid),saved:docJson(false)};
   },subject);
   assert.equal(result.overlaps,0);assert.equal(result.outside,0);
   for(const [i,f] of result.fields.entries()){
    assert.deepEqual([f.rect.w,f.rect.h],subject==='国語'?[1,20]:[10,2]);
    assert.equal(f.out,result.words[i]);assert.ok(f.room>=f.need);
    assert.ok(Object.values(f.border).every(v=>v==='medium'));assert.ok(Object.values(f.blankBorder).every(v=>v==='medium'));assert.equal(f.insideLines,false);
    if(i<3)assert.equal(f.size,result.fields[0].size);else assert.ok(f.size<result.fields[2].size);
    assert.ok(f.cols.every(w=>w===(subject==='国語'?1.3:1)));
   }
   await page.click('#tab-answer');await page.screenshot({path:path.join(out,subject+'.png'),fullPage:true});
   fs.writeFileSync(path.join(out,subject+'.json'),result.saved);
   const download=page.waitForEvent('download');await page.click('#btn-xlsx');await(await download).saveAs(path.join(out,subject+'.xlsx'));
   await page.evaluate(saved=>loadWork(saved),result.saved);assert.equal(await page.evaluate(()=>docJson(false)),result.saved);
   await page.click('#btn-answer-editor');const card=page.locator('[data-row="0"]');
   await card.locator('.auto-detail summary').click();assert.equal(await card.locator('[data-k="n"]').isVisible(),false);
   assert.match(await card.locator('.auto-kind-help').innerText(),/10文字/);
   await card.locator('[data-k="answer"]').fill('基本的人権尊重');
   assert.match(await card.locator('.auto-preview-sheet').innerText(),/基本的人権尊重/);
   await page.click('#auto-apply');assert.deepEqual(await page.evaluate(()=>doc.fields.map(f=>f.rects)),JSON.parse(result.saved).fields.map(f=>f.rects));
   assert.equal(await page.evaluate(()=>doc.answers[doc.fields[0].id]),'基本的人権尊重');
   console.log('PASS:',subject,'fixed ten-character frame, full text, shrink, thick borders, preview, update and save/load');
  }
  for(const subject of ['国語','数学']){
   await page.evaluate(subject=>{doc=newDoc(subject);startApp();},subject);
   await page.click('[data-field="8"]');assert.equal(await page.locator('.modal [data-k="n"]').count(),0);
   await page.click('.modal [data-act="ok"]');
   const f=await page.evaluate(()=>doc.fields[0]);assert.deepEqual([f.rects[0].w,f.rects[0].h],subject==='国語'?[1,20]:[10,2]);
  }
  const py=spawnSync(process.env.TEST_PYTHON_PATH || 'python3',['-c',`
import sys,json
from pathlib import Path
from openpyxl import load_workbook
for path in Path(sys.argv[1]).glob('*.xlsx'):
 work=json.loads(path.with_suffix('.json').read_text());b=load_workbook(path)
 sizes=[]
 for f in work['fields']:
  a=f['rects'][0];c,r,w,h=a['c']+1,a['r']+1,a['w'],a['h']
  for sheet in b:
   assert sheet.cell(r,c).border.top.style=='medium'
   assert sheet.cell(r+h-1,c+w-1).border.bottom.style=='medium'
  values=[b['模範解答'].cell(y,x) for y in range(r,r+h) for x in range(c,c+w) if b['模範解答'].cell(y,x).value is not None]
  assert ''.join(str(v.value) for v in values)==work['answers'][f['id']],(path,f,values)
  assert all(b['解答用紙'].cell(y,x).value is None for y in range(r,r+h) for x in range(c,c+w))
  sizes.append(values[0].font.sz)
 assert sizes[0]==sizes[1]==sizes[2]
 assert all(s<sizes[2] for s in sizes[3:])
 for sheet in b:
  used=set()
  for m in sheet.merged_cells.ranges:
   for y in range(m.min_row,m.max_row+1):
    for x in range(m.min_col,m.max_col+1):
     assert (y,x) not in used,(path,m)
     used.add((y,x))
 print('PASS: independent Excel full text, font sizes, borders, blank answers and merges',path.stem)
`,out],{encoding:'utf8'});
  process.stdout.write(py.stdout);process.stderr.write(py.stderr);assert.equal(py.status,0);assert.deepEqual(errors,[]);
  console.log('Artifacts:',out);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
