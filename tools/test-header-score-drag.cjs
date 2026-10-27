const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'answer-header-'));
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium'});const page=await browser.newPage({viewport:{width:1366,height:1000},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.click('#btn-from-answers');await page.fill('#creation-title','第三学年　第一回定期テスト　解答用紙');await page.click('#creation-next');await page.fill('#auto-source','1\n1,ア,2,知\n2,イ,3,思');await page.click('#auto-parse');await page.click('#auto-apply');
  const header=await page.evaluate(()=>{const texts=headerLayout(doc).texts;return{title:texts.find(t=>t.c===doc.grid.cols-1),name:texts.find(t=>t.c===doc.grid.cols-2),nameLabel:doc.paper.nameLabel};});
  assert.equal(header.title.size,18);assert.equal(header.name.size,16);assert.match(header.nameLabel,/氏名（　{8}）/);assert.equal(header.title.stack,true);assert.equal(header.title.valign,'center');assert.equal(header.name.valign,'bottom');assert.equal(header.name.bold,true);
  await page.screenshot({path:path.join(out,'before.png'),fullPage:true});
  const bounds=()=>page.evaluate(()=>scoreBoxBounds(doc));
  const drag=async(dx,dy,cancel=false)=>{const b=await page.locator('#sheet .score-box').boundingBox();await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.5+dx,b.y+b.height*.5+dy,{steps:10});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();};
  const original=await bounds(),undoBefore=await page.evaluate(()=>history.sheet.undo.length);await drag(-100,-90);const moved=await bounds();assert.ok(moved.x<original.x-10 && moved.y<original.y-10);assert.equal(await page.evaluate(()=>history.sheet.undo.length),undoBefore+1);assert.equal(await page.evaluate(()=>ui.sel),null);assert.deepEqual(await page.evaluate(()=>ui.targets),[]);
  await page.keyboard.press('Control+z');assert.deepEqual(await bounds(),original);await page.keyboard.press('Control+y');assert.deepEqual(await bounds(),moved);
  const historyBefore=await page.evaluate(()=>({undo:history.sheet.undo.length,redo:history.sheet.redo.length}));await drag(-20,-20,true);assert.deepEqual(await bounds(),moved);assert.deepEqual(await page.evaluate(()=>({undo:history.sheet.undo.length,redo:history.sheet.redo.length})),historyBefore);
  for(const tab of ['answer','draw']){await page.click('#tab-'+tab);const before=await bounds();await drag(-20,-10);assert.ok((await bounds()).x<before.x);await page.keyboard.press('Control+z');assert.deepEqual(await bounds(),before);}
  await page.click('#tab-sheet');await page.locator('#sheet .score-box').focus();await page.keyboard.press('ArrowLeft');assert.ok(Math.abs((await bounds()).x-moved.x+1)<.02);
  const current=await bounds();await page.evaluate(()=>{doc.fields[0].points=5;render();});assert.deepEqual(await bounds(),current);assert.match(await page.locator('#sheet .score-box').textContent(),/８/);
  await page.screenshot({path:path.join(out,'moved.png'),fullPage:true});
  const work=await page.evaluate(()=>docJson());await page.evaluate(text=>loadWork(text),work);assert.deepEqual(await bounds(),current);
  await page.click('#btn-answer-editor');await page.check('#auto-replace');await page.click('#auto-apply');assert.deepEqual(await bounds(),current);
  // Dragging remains within the printable area; preserve a fractional position for export.
  await drag(-3000,-3000);assert.equal((await bounds()).x,0);assert.equal((await bounds()).y,0);await page.keyboard.press('Control+z');assert.deepEqual(await bounds(),current);
  await page.evaluate(()=>{moveScoreBox(117.31,65.47);});const exported=await bounds();
  const dl=page.waitForEvent('download');await page.click('#btn-xlsx');await(await dl).saveAs(path.join(out,'header.xlsx'));fs.writeFileSync(path.join(out,'work.json'),await page.evaluate(()=>docJson()));
  const print=await page.evaluate(()=>{const clone=svg.cloneNode(true);clone.querySelectorAll('.guide').forEach(e=>e.remove());const shape=clone.querySelector('.score-box rect');return {count:clone.querySelectorAll('.score-box').length,x:+shape.getAttribute('x')-geo.x0,y:+shape.getAttribute('y')-geo.y0,guide:clone.querySelectorAll('.score-box-focus').length};});assert.equal(print.count,1);assert.ok(Math.abs(print.x-exported.x)<.001 && Math.abs(print.y-exported.y)<.001);assert.equal(print.guide,0);
  await page.evaluate(()=>{const d=newDoc('国語');d.paper.nameLabel=standardNameLabel(d.paper,7);loadWork(JSON.stringify(d));});assert.match(await page.evaluate(()=>doc.paper.nameLabel),/氏名（　{8}）/);
  await page.evaluate(()=>{doc.paper.nameLabel='オリジナル氏名欄';loadWork(docJson());});assert.equal(await page.evaluate(()=>doc.paper.nameLabel),'オリジナル氏名欄');
  // Touch drag through real browser events, on a narrow screen.
  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.goto('http://127.0.0.1:'+server.address().port);await mobile.evaluate(work=>loadWork(work),work);await mobile.locator('.score-box').scrollIntoViewIfNeeded();const mb=await mobile.locator('.score-box').boundingBox(),session=await mobile.context().newCDPSession(mobile),start={x:mb.x+mb.width*.5,y:mb.y+mb.height*.5};
  const touchBefore=await mobile.evaluate(()=>scoreBoxBounds(doc));await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let i=1;i<=5;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x-25*i/5,y:start.y-25*i/5}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.ok((await mobile.evaluate(()=>scoreBoxBounds(doc))).x<touchBefore.x);await mobile.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  const check=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`
from openpyxl import load_workbook
from zipfile import ZipFile
from xml.etree import ElementTree as E
import sys,json
p=sys.argv[1];work=json.load(open(sys.argv[2]));b=load_workbook(p);ns={'x':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
for i,s in enumerate(b,1):
 title=s.cell(2,work['grid']['cols']);name=s.cell(2,work['grid']['cols']-1)
 assert title.value==work['paper']['title'] and title.font.sz==18
 assert name.value==work['paper']['nameLabel'] and name.font.sz==16
 assert title.alignment.textRotation==name.alignment.textRotation==255
 with ZipFile(p) as z:r=E.fromstring(z.read(f'xl/drawings/drawing{i}.xml'))
 anchors=[n for n in r if n.find('x:grpSp/x:nvGrpSpPr/x:cNvPr',ns).attrib.get('name')=='score-box']
 assert len(anchors)==1;a=anchors[0];assert a.attrib['editAs']=='absolute'
 texts=[n.text for n in a.findall('.//a:t',ns)];assert all(v in texts for v in ['知・技','思・判・表','合計','５','３','８'])
 assert a.find('.//a:solidFill/a:srgbClr[@val="FFFFFF"]',ns) is not None
 offset=a.find('x:grpSp/x:grpSpPr/a:xfrm/a:off',ns)
 assert abs(int(offset.attrib['x'])-117.31/.8*36000)<2
 assert abs(int(offset.attrib['y'])-65.47/.8*36000)<2
 start=a.find('x:from',ns);assert int(start.find('x:colOff',ns).text)>0 and int(start.find('x:rowOff',ns).text)>0
 assert '合計' not in [str(c.value) for row in s for c in row if c.value is not None]
 ranges=list(s.merged_cells.ranges)
 for j,v in enumerate(ranges):
  for t in ranges[j+1:]:assert v.max_col<t.min_col or t.max_col<v.min_col or v.max_row<t.min_row or t.max_row<v.min_row
print('PASS: Excel exports large vertical headers and one editable, white-backed score group at the exact moved position in both sheets')
`,path.join(out,'header.xlsx'),path.join(out,'work.json')],{encoding:'utf8'});process.stdout.write(check.stdout);process.stderr.write(check.stderr);assert.equal(check.status,0);
  console.log('PASS: native mouse/touch drag, one-step undo/redo, cancel, all tabs, keyboard, clamping, save/regeneration, print and legacy names\n'+out);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
