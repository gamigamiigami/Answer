const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),{chromium}=require('playwright'),{spawnSync}=require('node:child_process');
(async()=>{const server=http.createServer((q,r)=>r.end(fs.readFileSync('answer-sheet-maker.html')));await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});try{const p=await browser.newPage({acceptDownloads:true,viewport:{width:1366,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined}));await p.goto('http://127.0.0.1:'+server.address().port);await p.evaluate(()=>{doc=buildAutoDocument(parseAutoAnswers('1\n1￥（３）￥相手の気持ちを考えた。\n2￥太陽\n3￥あいう～かきく'),'国語');startApp();});await p.click('#btn-answer-editor');await p.locator('[data-row="0"] [data-k="answer"]').evaluate(e=>{e.focus();e.setSelectionRange(0,6)});await p.click('[data-row="0"] [data-answer-format="underline"]');await p.click('[data-row="0"] [data-answer-format="bold"]');await p.click('#auto-apply');await p.locator('.auto-modal').waitFor({state:'detached'});assert.equal(await p.evaluate(()=>doc.fields[0].answerStyles.length),2);await p.click('#tab-answer');assert.ok(await p.locator('#sheet tspan[font-weight="bold"]').count()>0);assert.ok(await p.locator('#sheet .answer-underline').count()>=6);await p.evaluate(()=>loadWork(docJson(false)));assert.equal(await p.evaluate(()=>doc.fields[0].answerStyles.length),2);const dl=p.waitForEvent('download');await p.click('#btn-xlsx');await(await dl).saveAs('/tmp/editable-answers.xlsx');await p.screenshot({path:'/tmp/editable-answers.png'});assert.deepEqual(errors,[]);const py=spawnSync('python3',['-c',`import zipfile,xml.etree.ElementTree as E,openpyxl
f='/tmp/editable-answers.xlsx';n={'x':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
with zipfile.ZipFile(f) as z:
 for name in ['xl/drawings/drawing1.xml','xl/drawings/drawing2.xml']:
  root=E.fromstring(z.read(name));ids=[v.attrib['id'] for v in root.findall('.//x:cNvPr',n)];assert len(ids)==len(set(ids))
  assert any(v.attrib.get('name','').startswith('印刷罫線 ') for v in root.findall('.//x:cNvPr',n))
  assert len(root.findall('.//a:prstGeom[@prst="line"]',n))>50
 root=E.fromstring(z.read('xl/drawings/drawing2.xml'));boxes=[s for s in root.findall('.//x:sp',n) if s.find('x:nvSpPr/x:cNvSpPr[@txBox="1"]',n) is not None]
 text=lambda s: ''.join(t.text or '' for t in s.findall('.//a:t',n))
 assert [text(s) for s in boxes]==['相手の気持ちを考えた。','太陽','あいう','かきく']
 runs=boxes[0].findall('.//a:r',n);formatted=[r for r in runs if r.find('a:rPr',n).get('u')=='sng'];assert ''.join(text(r) for r in formatted)=='相手の気持ち'
 assert all(r.find('a:rPr',n).get('b')=='1' for r in formatted)
 assert not E.fromstring(z.read('xl/drawings/drawing1.xml')).findall('.//x:cNvSpPr[@txBox="1"]',n)
 b=openpyxl.load_workbook(f)
 labels=[c for row in b['模範解答'] for c in row if str(c.value).translate(str.maketrans('（）３','()3'))=='(3)'];assert labels
 for c in labels: assert c.border.left.style and c.border.right.style
 assert not any(c.value=='太陽' for row in b['模範解答'] for c in row)
 print('PASS editable whole-answer textboxes, partial bold/underline runs, printable border shapes, unique drawing IDs')`],{encoding:'utf8'});assert.equal(py.status,0,py.stderr);console.log(py.stdout);console.log('PASS site selection formatting, placement-preserving update and save/load');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
