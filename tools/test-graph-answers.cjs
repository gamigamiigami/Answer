// Run: node tools/test-graph-answers.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
(async()=>{
  const html=fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html'));
  const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'answer-graphs-'));let browser,count=0;
  const pass=message=>{count++;console.log('PASS:',message);};
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH || '/usr/bin/chromium'});
    const page=await browser.newPage({viewport:{width:1366,height:900},acceptDownloads:true});
    const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
    const url='http://127.0.0.1:'+server.address().port;
    page.on('request',r=>{if(new URL(r.url()).origin!==url)external.push(r.url());});
    await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
    await page.goto(url);
    assert.deepEqual(await page.locator('#field-tools [data-field] .nm').allTextContents(),['シンプル枠','記号用','初終','語句','記述','長方形','グラフ','漢字','2マス','5マス']);
    assert.deepEqual(await page.locator('#field-tools [data-field] .k').allTextContents(),['1','2','3','4','5','6','7','8','9','0']);
    await page.evaluate(()=>{options.fieldOrder=[7,1];buildTools();});
    assert.equal(await page.locator('#field-tools [data-field]').first().getAttribute('aria-keyshortcuts'),'1');
    assert.equal(await page.locator('#field-tools [data-field] .nm').first().innerText(),'グラフ');
    assert.equal(await page.locator('#field-tools [data-field] .k').first().innerText(),'1');
    assert.equal(await page.evaluate(()=>fieldFromCode('Digit1')),7);
    await page.evaluate(()=>{delete options.fieldOrder;buildTools();});
    pass('Visible shortcut numbers follow the actual keyboard assignments, including reordered buttons and 0');

    const calculations=await page.evaluate(()=>{
      const cases=[['y=3x+1',2,7],['y=6/x',2,3],['y=(1/2)x^2',-2,2],['-x^2',2,-4],['y=1/2x',4,2],['y=3(x-1)^2+2',2,5],['ｙ＝３ｘ＋１',2,7],['y=2×x−1',2,3]];
      return cases.map(([source,x,want])=>({source,value:compileGraphExpression(source)(x),want}));
    });
    calculations.forEach(v=>assert.equal(v.value,v.want,v.source));
    for(const source of ['alert(1)','y=Math.random()','y=x;window.bad=1','y=x+','y=(x+1','('.repeat(40)+'x'+')'.repeat(40)]){
      assert.equal(await page.evaluate(source=>{try{compileGraphExpression(source);return false;}catch{return true;}},source),true,source);
    }
    pass('Linear, reciprocal, quadratic, fractional and full-width expressions evaluate correctly; malformed or executable input is rejected');

    const curves=await page.evaluate(()=>{
      const d={colw:Array(6).fill(1)},f={rects:[{c:0,r:0,w:6,h:18}]};
      return ['y=6/x','y=1/(3x-1)'].map(source=>{
        const vectors=graphPrimitives(d,f,source,DEFAULT_GRAPH_RANGE,true),segments=vectors.filter(v=>v.width===.35);
        const pole=source==='y=6/x'?0:1/3,axis=4+(pole+5)/10*(6*CW-8);
        return {count:segments.length,bridges:segments.filter(v=>Math.min(v.x1,v.x2)<axis && Math.max(v.x1,v.x2)>axis).length,
          clipped:segments.every(v=>[v.x1,v.x2].every(x=>x>=4-1e-6 && x<=6*CW-4+1e-6) && [v.y1,v.y2].every(y=>y>=8-1e-6 && y<=18*RH-5+1e-6))};
      });
    });
    for(const curve of curves){assert.ok(curve.count>0);assert.equal(curve.bridges,0);assert.equal(curve.clipped,true);}
    pass('Reciprocal curves are clipped to the viewport and never join across zero or shifted poles');

    await page.click('#btn-from-answers');await page.fill('#creation-title','関数と分数のテスト');await page.click('#creation-next');
    await page.selectOption('#auto-subject','数学');
    await page.fill('#auto-source','1\n1,y=3x+1,2,思\n2,y=6/x,3,思\n3,y=(1/2)x^2,4,思\n4,1/2,2,知,記述,4×2');
    await page.click('#auto-parse');
    assert.deepEqual(await page.locator('[data-k="kind"]').evaluateAll(nodes=>nodes.map(n=>n.value)),['graph','graph','graph','essay']);
    await page.click('[data-row="2"] [data-graph]');
    await page.fill('#graph-xMin','-4');await page.fill('#graph-xMax','4');
    await page.fill('#graph-yMin','-1');await page.fill('#graph-yMax','8');
    assert.ok(await page.locator('#graph-preview line').count()>100);
    assert.equal((await page.locator('#graph-preview').textContent()).includes('/'),false);
    assert.ok((await page.locator('#graph-preview').textContent()).includes('²'));
    await page.screenshot({path:path.join(output,'graph-editor.png')});
    await page.click('#graph-save');await page.click('#auto-apply');
    assert.deepEqual(await page.evaluate(()=>doc.fields.map(f=>f.type)),[7,7,7,6]);
    assert.deepEqual(await page.evaluate(()=>doc.answerGraphs.f3),{xMin:-4,xMax:4,yMin:-1,yMax:8});
    await page.click('#tab-answer');
    assert.ok(await page.locator('#sheet .answer-vectors line').count()>500);
    const fraction=await page.evaluate(()=>fractionAnswerPlan(doc,doc.fields[3],doc.answers.f4));
    assert.equal(fraction.room,fraction.need);assert.deepEqual(fraction.vectors.filter(v=>v.k==='text').map(v=>v.text),['1','2']);
    assert.ok(fraction.vectors[0].y<fraction.vectors[1].y1 && fraction.vectors[1].y1<fraction.vectors[2].y);
    await page.screenshot({path:path.join(output,'model-answers.png'),fullPage:true});
    pass('Pasted equations infer graph fields; ranges edit before generation, and both graph captions and written fractions use stacked notation');

    await page.evaluate(()=>{ui.cur={...doc.fields[0].rects[0]};ui.sel=null;ui.extra=[];ui.targets=[];render();});
    await page.click('#t-graph');
    const before=await page.evaluate(()=>JSON.stringify({answers:doc.answers,graphs:doc.answerGraphs}));
    await page.fill('#graph-equations','y=(1/2)x+1\ny=-x^2');await page.fill('#graph-xMin','3');await page.fill('#graph-xMax','-3');
    assert.equal(await page.locator('#graph-save').isDisabled(),true);
    assert.match(await page.locator('#graph-status').innerText(),/最小値/);
    await page.fill('#graph-xMin','-3');await page.fill('#graph-xMax','3');await page.fill('#graph-yMin','-1/2');await page.fill('#graph-yMax','5');
    assert.equal(await page.locator('#graph-save').isDisabled(),false);await page.click('#graph-save');
    assert.equal(await page.evaluate(()=>doc.answerGraphs.f1.yMin),-.5);
    await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>JSON.stringify({answers:doc.answers,graphs:doc.answerGraphs})),before);
    await page.keyboard.press('Control+y');assert.equal(await page.evaluate(()=>doc.answers.f1),'y=(1/2)x+1\ny=-x^2');
    await page.keyboard.press('Enter');assert.equal(await page.locator('#graph-equations').isVisible(),true);
    await page.fill('#graph-equations','y=x+');assert.equal(await page.locator('#graph-save').isDisabled(),true);
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{void bulkAnswers([doc.fields[0],doc.fields[3]]);});
    const bulk=page.locator('.modal textarea');
    assert.equal(await bulk.inputValue(),'y=(1/2)x+1 ; y=-x^2\n1/2');
    await page.locator('.modal [data-act="ok"]').click();
    assert.equal(await page.evaluate(()=>doc.answers.f1),'y=(1/2)x+1\ny=-x^2');
    assert.equal(await page.evaluate(()=>doc.answers.f4),'1/2');
    pass('Existing graphs reopen through the button or Enter; validation, undo and bulk editing preserve multiple equations and following answers');

    const saved=await page.evaluate(()=>docJson(false));
    await page.evaluate(saved=>loadWork(saved),saved);assert.equal(await page.evaluate(()=>docJson(false)),saved);
    await page.click('#btn-answer-editor');
    await page.click('[data-row="0"] [data-graph]');assert.equal(await page.locator('#graph-yMin').inputValue(),'-0.5');await page.click('#graph-cancel');
    await page.check('#auto-replace');await page.click('#auto-apply');
    assert.equal(await page.evaluate(()=>doc.answerGraphs.f1.yMin),-.5);
    await page.click('#tab-answer');
    const backup=await page.evaluate(()=>{options.backupAnswers=false;return JSON.parse(docJson(true));});
    assert.deepEqual(backup.answers,{});assert.deepEqual(backup.answerGraphs,{});
    for(const [selector,extension] of [['#btn-xlsx','xlsx'],['#btn-save','json']]){
      const pending=page.waitForEvent('download');await page.click(selector);await(await pending).saveAs(path.join(output,'graphs.'+extension));
    }
    pass('Graph answers and ranges survive save/load and regeneration; answer-free backups omit both');

    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{ui.cur={...doc.fields[0].rects[0]};render();});
    await page.click('#t-graph');
    assert.ok(await page.locator('#graph-form').evaluate(n=>n.scrollWidth<=n.clientWidth));
    await page.screenshot({path:path.join(output,'graph-mobile.png')});await page.keyboard.press('Escape');
    await page.emulateMedia({colorScheme:'dark'});await page.click('#t-graph');await page.screenshot({path:path.join(output,'graph-dark.png')});await page.keyboard.press('Escape');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    pass('The graph editor works on a phone width and in dark mode, without JavaScript errors or network requests');

    const check=spawnSync('python3',['-c',`
from zipfile import ZipFile
from xml.etree import ElementTree as E
from openpyxl import load_workbook
import sys,warnings
warnings.filterwarnings('ignore',category=UserWarning)
p=sys.argv[1]
with ZipFile(p) as z:
 assert z.testzip() is None
 blank=E.fromstring(z.read('xl/drawings/drawing1.xml'));model=E.fromstring(z.read('xl/drawings/drawing2.xml'))
 ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','xdr':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'}
 assert len(model.findall('.//xdr:sp',ns))>len(blank.findall('.//xdr:sp',ns))+500
 assert not any(n.text in ['²','1','2'] for n in blank.findall('.//a:t',ns) if n.text=='²')
 texts=[n.text for n in model.findall('.//a:t',ns)]
 assert '²' in texts and '/' not in texts
 for drawing in [blank,model]:
  ids=[n.attrib['id'] for n in drawing.findall('.//xdr:cNvPr',ns)]
  assert len(ids)==len(set(ids))
  for anchor in drawing:
   start=anchor.find('xdr:from',ns);end=anchor.find('xdr:to',ns)
   assert start is not None and end is not None
   assert int(start.find('xdr:col',ns).text)>=0 and int(start.find('xdr:row',ns).text)>=0
   assert int(end.find('xdr:col',ns).text)>int(start.find('xdr:col',ns).text)
   assert int(end.find('xdr:row',ns).text)>int(start.find('xdr:row',ns).text)
 book=load_workbook(p)
 assert book.sheetnames==['解答用紙','模範解答']
 assert all(s.cell(1,1).value=='関数と分数のテスト' for s in book)
print('PASS: Excel has separate blank/model drawings, native curve segments, stacked fractions and field-anchored groups')
`,path.join(output,'graphs.xlsx')],{encoding:'utf8'});
    process.stdout.write(check.stdout);process.stderr.write(check.stderr);assert.equal(check.status,0);
    pass('Exported workbook passes independent ZIP, XML and openpyxl checks');
    console.log(count+' graph checks passed\nArtifacts: '+output);
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
