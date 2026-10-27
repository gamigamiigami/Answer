// Run: node tools/test-content-scale.cjs (Playwright and Python/openpyxl/pypdf)
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html;charset=utf-8');r.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'testomo-scale-'));
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium'});
  const page=await browser.newPage({viewport:{width:1366,height:1000},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const normal=await page.evaluate(()=>{const rows=parseAutoAnswers(AUTO_SAMPLE),d=buildAutoDocument(rows,'国語');return JSON.stringify(d)===JSON.stringify(buildAutoLayout(rows,'国語',null,'',{gap:1,width:1}));});assert.ok(normal);
  for(const subject of ['国語','数学']){
   const result=await page.evaluate(subject=>{
    const source='1\n'+Array.from({length:200},(_,i)=>(i+1)+',ア,2,知,30字以内').join('\n');
    const d=buildAutoDocument(parseAutoAnswers(source),subject);doc=d;startApp();
    const used=new Set(headerLayout(d).reserved);let overlap=false;
    for(const f of d.fields)for(const [c,r] of fieldFootprint(d,f)){const key=c+','+r;if(used.has(key))overlap=true;used.add(key);}
    const p=PAGE[d.paper.orientation],v=viewportPage(d),box=svg.getBoundingClientRect();
    return {fields:d.fields.length,answers:Object.keys(d.answers).length,outside:outsideCount(d),overlap,scale:contentScale(d),factor:canvasFactor(d.paper),ratio:box.width/box.height,want:p.w/p.h,viewRatio:v.w/v.h,fits:geo.x0>=d.paper.marginX/contentScale(d)-.001&&geo.y0>=d.paper.marginY/contentScale(d)-.001};
   },subject);
   assert.equal(result.fields,200);assert.equal(result.answers,200);assert.equal(result.outside,0);assert.equal(result.overlap,false);assert.ok(result.scale<1&&result.factor>1);assert.ok(result.fits);assert.ok(Math.abs(result.ratio-result.want)<.001);assert.ok(Math.abs(result.viewRatio-result.want)<1e-10);
   const saved=await page.evaluate(()=>docJson(false));await page.evaluate(s=>loadWork(s),saved);assert.equal(await page.evaluate(()=>docJson(false)),saved);
   await page.screenshot({path:path.join(out,subject==='国語'?'large-landscape.png':'large-portrait.png'),fullPage:true});
  }
  console.log('PASS: all 200 questions generate in both writing directions with no overlap or lost answers, A4 ratio, and exact save/load');
  await page.emulateMedia({media:'print'});await page.pdf({path:path.join(out,'large.pdf'),preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});
  // Exercise the actual creation dialog, not only layout helpers.
  await page.click('#btn-answer-editor');await page.click('#auto-tab-input');
  await page.fill('#auto-source','1\n'+Array.from({length:120},(_,i)=>(i+1)+',ア,2,知,30字以内').join('\n'));await page.click('#auto-parse');await page.check('#auto-replace');await page.click('#auto-apply');await page.locator('.auto-modal').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>doc.fields.length),120);
  const original=await page.evaluate(()=>({fields:JSON.stringify(doc.fields),answers:JSON.stringify(doc.answers),zoom:ui.zoom,scale:contentScale(doc)}));
  await page.click('#side-tab-paper');await page.fill('#content-scale','25');await page.locator('#content-scale').press('Tab');assert.equal(await page.evaluate(()=>contentScale(doc)),.25);
  const changed=await page.evaluate(()=>({fields:JSON.stringify(doc.fields),answers:JSON.stringify(doc.answers),zoom:ui.zoom}));assert.equal(changed.fields,original.fields);assert.equal(changed.answers,original.answers);assert.equal(changed.zoom,original.zoom);
  await page.click('#btn-undo');assert.equal(await page.evaluate(()=>contentScale(doc)),original.scale);await page.click('#btn-redo');assert.equal(await page.evaluate(()=>contentScale(doc)),.25);
  // A slider drag must be a single undoable change.
  await page.locator('#content-scale-range').evaluate(el=>{el.value='30';el.dispatchEvent(new Event('input',{bubbles:true}));el.value='35';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal(await page.evaluate(()=>contentScale(doc)),.35);await page.click('#btn-undo');assert.equal(await page.evaluate(()=>contentScale(doc)),.25);
  await page.click('#side-tab-paper');await page.selectOption('#paper-orientation','landscape');assert.equal(await page.evaluate(()=>doc.paper.orientation),'landscape');assert.equal(await page.evaluate(()=>JSON.stringify(doc.fields)),original.fields);await page.click('#side-tab-paper');await page.selectOption('#paper-orientation','portrait');
  await page.click('#side-tab-paper');await page.fill('#content-scale','100');await page.locator('#content-scale').press('Tab');assert.match(await page.locator('#status').innerText(),/A4の余白を超え/);await page.click('#side-tab-paper');await page.click('#content-fit');assert.ok(await page.evaluate(()=>Math.abs(contentScale(doc)-fitContentScale(doc))<1e-10));
  console.log('PASS: real generation flow, size controls, single-step undo, orientations, overflow guidance and fit-to-A4');
  // At a non-default scale the native mouse coordinates must still hit the intended cell.
  await page.evaluate(()=>{doc=newDoc('国語');startApp();});const legacy=await page.evaluate(()=>docJson(false));
  await page.locator('#content-scale-range').evaluate(el=>{el.value='50';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});await page.click('#btn-undo');assert.equal(await page.evaluate(()=>docJson(false)),legacy);
  await page.evaluate(()=>setContentScale(50));
  const point=await page.evaluate(()=>{const c=8,r=12,b=svg.getBoundingClientRect(),p=viewportPage(doc);return {c,r,x:b.left+(geo.x0+colXmm(c)+colWmm(c)/2)/p.w*b.width,y:b.top+(geo.y0+(r+.5)*RH)/p.h*b.height};});
  await page.mouse.click(point.x,point.y);assert.deepEqual(await page.evaluate(()=>ui.cur),{c:8,r:12});
  const drag=await page.evaluate(()=>{const b=svg.getBoundingClientRect(),p=viewportPage(doc),s=document.querySelector('.score-box').getBoundingClientRect();return {x:s.x+s.width/2,y:s.y+s.height/3,mm:20/b.width*p.w,before:scoreBoxBounds(doc).x};});
  await page.mouse.move(drag.x,drag.y);await page.mouse.down();await page.mouse.move(drag.x-20,drag.y,{steps:5});await page.mouse.up();assert.ok(Math.abs(await page.evaluate(()=>scoreBoxBounds(doc).x)-(drag.before-drag.mm))<.1);
  // Include the independently editable score group, a graph and drawn line in exported geometry.
  await page.evaluate(()=>{doc=buildAutoDocument(parseAutoAnswers('1\n1,ア,2,知\n2,y=x,3,思,グラフ,6×6'),'数学');doc.drawings=[{k:'line',x1:1,y1:15,x2:3,y2:18,w:'thin'}];startApp();setContentScale(50);});
  const saved=await page.evaluate(()=>docJson(false));await page.evaluate(s=>loadWork(s),saved);assert.equal(await page.evaluate(()=>docJson(false)),saved);fs.writeFileSync(path.join(out,'scaled.json'),saved);
  const download=page.waitForEvent('download');await page.click('#btn-xlsx');await(await download).saveAs(path.join(out,'scaled.xlsx'));
  await page.emulateMedia({media:'print'});await page.pdf({path:path.join(out,'scaled.pdf'),preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});
  await page.click('#side-tab-paper');await page.selectOption('#paper-orientation','landscape');await page.emulateMedia({media:'print'});await page.pdf({path:path.join(out,'landscape.pdf'),preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('#paper-size-panel').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  const check=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`
import json,sys,zipfile,xml.etree.ElementTree as E
from pathlib import Path
from openpyxl import load_workbook
from pypdf import PdfReader
p=Path(sys.argv[1]);d=json.loads((p/'scaled.json').read_text(encoding='utf8'));scale=d['paper']['contentScale']
b=load_workbook(p/'scaled.xlsx')
for s in b:
 assert s.page_setup.scale==80 and str(s.page_setup.paperSize)=='9'
 assert s.page_setup.orientation=='portrait'
 assert abs(s.row_dimensions[1].height-13.5*scale)<1e-7
 assert abs(s.cell(1,1).font.sz-18*scale)<1e-7
 width=s.column_dimensions['A'].width
 assert abs((width*7+5)-48*scale)<.01,(width,scale)
 if s.title=='模範解答':assert 'ア' in [c.value for row in s for c in row]
with zipfile.ZipFile(p/'scaled.xlsx') as z:
 root=E.fromstring(z.read('xl/drawings/drawing1.xml'));ns={'x':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
 group=next(g for g in root.findall('.//x:grpSp',ns) if g.find('x:nvGrpSpPr/x:cNvPr',ns).attrib['name']=='score-box')
 ext=group.find('x:grpSpPr/a:xfrm/a:ext',ns)
 # The horizontal score box is six columns wide (12.7mm per column before 80% printing).
 assert abs(int(ext.attrib['cx'])-6*12.7*scale*36000)<2,ext.attrib
for filename,w,h in [('large.pdf',210,297),('scaled.pdf',210,297),('landscape.pdf',297,210)]:
 pdf=PdfReader(p/filename);assert len(pdf.pages)==1
 assert abs(float(pdf.pages[0].mediabox.width)-w*72/25.4)<1 and abs(float(pdf.pages[0].mediabox.height)-h*72/25.4)<1
print('PASS: independent Excel cell/font/drawing scale and single-page A4 PDF orientation checks')
`,out],{encoding:'utf8'});process.stdout.write(check.stdout||'');process.stderr.write(check.stderr||'');assert.equal(check.status,0);
  console.log('PASS: scaled pointer input, mobile controls, print dimensions, Excel, and vector geometry\nArtifacts: '+out);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
