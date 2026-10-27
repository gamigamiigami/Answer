// Run: node tools/test-usability.cjs (Playwright, Python/openpyxl/pypdf)
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'testomo-usability-')),server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html;charset=utf-8');r.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')))});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH || '/usr/bin/chromium'});const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));await page.goto('http://127.0.0.1:'+server.address().port);
  const parsing=await page.evaluate(()=>{
    const parse=s=>parseAutoAnswers(s,{subject:'数学',points:2,aspect:'知技'}).map(r=>[r.answer,r.points,r.kind]);
    const original=parseAutoAnswers('1￥こんにちは、先生,元気です￥0.5￥知\n2￥1^12￥2￥知\n3￥3C1￥3￥知',{subject:'数学'}),restored=parseAutoAnswers(autoRowsSource(original,{separator:'￥'}),{subject:'数学'});
    return {yen:parse('1￥2,3、4￥0.5￥知'),half:parse('1¥答え、文¥2¥知'),backslash:parse('1\\答え、文\\2\\知'),quoted:parse('1￥"価格￥100、税込"￥2￥知'),same:JSON.stringify(original.map(r=>[r.answer,r.points]))===JSON.stringify(restored.map(r=>[r.answer,r.points])),numeric:parseAutoAnswers('12\n24\n36',{answersOnly:true,subject:'数学',points:1}).map(r=>r.answer)};
  });assert.deepEqual(parsing.yen,[['2,3、4',.5,'formula']]);assert.equal(parsing.half[0][0],'答え、文');assert.equal(parsing.backslash[0][0],'答え、文');assert.equal(parsing.quoted[0][0],'価格￥100、税込');assert.ok(parsing.same);assert.deepEqual(parsing.numeric,['12','24','36']);
  const math=await page.evaluate(()=>{
    const v=mathLinePrimitives(mathTokens('1^2 + x^{n+1} + 3C1 + 5P2'),0,10,12);
    return {v,graphs:[compileGraphExpression('y=sin(x)')(Math.PI/2),compileGraphExpression('y=log(x)')(100),compileGraphExpression('y=√x')(9),...graphEquations('x^2+y^2=4').map(e=>e.fn(0))]};
  });assert.ok(math.v.some(t=>t.text==='n+1'&&t.y<10&&t.size<12));assert.ok(math.v.some(t=>t.text==='3'&&t.y>10&&t.size<12));assert.ok(math.v.some(t=>t.text==='C'&&t.size===12));assert.deepEqual(math.graphs,[1,2,3,2,-2]);
  const fractionPower=await page.evaluate(()=>({tokens:mathTokens('x^12/3'),vectors:mathLinePrimitives(mathTokens('x^12/3'),0,10,12)}));assert.equal(fractionPower.tokens[0].num,'x^12');assert.ok(fractionPower.vectors.some(v=>v.text==='12'&&v.y<10&&v.size<8));
  const custom=await page.evaluate(()=>{const rows=parseAutoAnswers('1￥ア￥0.5￥観点:資料活用\n2￥イ￥1.5￥主体',{subject:'社会'}),d=buildAutoDocument(rows,'社会'),again=parseAutoAnswers(autoRowsSource(rows,{separator:'￥'}));return {totals:scoreTotals(d),aspects:again.map(r=>r.aspect)};});assert.equal(custom.totals['資料活用'],.5);assert.equal(custom.totals['主体'],1.5);assert.equal(custom.totals['合計'],2);assert.deepEqual(custom.aspects,['資料活用','主体']);
  console.log('PASS: yen/full-width/backslash delimiters, punctuation/quoted yen preservation, numeric-only mode, exponents/combinations, advanced functions');
  await page.click('#btn-from-answers');await page.fill('#creation-title','改善の確認');await page.click('#creation-next');await page.selectOption('#auto-subject','数学');await page.click('#auto-aspect-add');await page.fill('.modal [data-k="name"]','資料活用');await page.click('.modal [data-act="ok"]');assert.equal(await page.locator('#auto-base-aspect').inputValue(),'資料活用');await page.click('#auto-input-table');
  await page.fill('[data-input-cell="0,2"]','12');await page.fill('[data-input-cell="0,3"]','0.5');await page.click('#answer-input-save');assert.equal(await page.locator('[data-k="answer"]').first().inputValue(),'12');await page.click('#auto-apply');assert.equal(await page.evaluate(()=>doc.fields[0].aspect),'資料活用');
  await page.click('#side-tab-paper');await page.click('#score-settings');await page.fill('.modal [data-k="maxScore"]','0.5');await page.selectOption('.modal [data-k="scoreMode"]','total');await page.click('.modal [data-act="ok"]');assert.equal(await page.evaluate(()=>targetScore(doc)),.5);assert.equal(await page.evaluate(()=>scoreTotals(doc)['合計']),.5);
  const before=await page.evaluate(()=>{doc.drawings.push({k:'line',x1:3,y1:10,x2:5,y2:12,w:'thin'});return JSON.stringify({rects:doc.fields.map(f=>f.rects),drawings:doc.drawings});});
  await page.click('#btn-answer-editor');await page.fill('[data-k="answer"]','24');await page.click('#auto-update');assert.equal(await page.evaluate(()=>doc.answers[doc.fields[0].id]),'24');assert.equal(await page.evaluate(()=>JSON.stringify({rects:doc.fields.map(f=>f.rects),drawings:doc.drawings})),before);
  await page.click('#btn-undo');assert.equal(await page.evaluate(()=>doc.answers[doc.fields[0].id]),'12');await page.click('#btn-redo');assert.equal(await page.evaluate(()=>doc.answers[doc.fields[0].id]),'24');
  console.log('PASS: real input table, decimal scoring/custom total and atomic content-only edits with undo/redo');
  await page.evaluate(()=>{doc=buildAutoDocument(parseAutoAnswers('1￥￥4￥知￥表￥3×3',{subject:'社会'}),'社会');startApp();editTableField(doc.fields[0]);});
  await page.fill('[data-table-cell="0,0"]','長い見出しを折り返して表示します\n二行目');await page.check('#table-given');await page.click('#table-merge');await page.fill('[data-table-cell="1,0"]','秘密の解答\n次の行');await page.check('#table-cell-scoring');await page.fill('#table-cell-points','0.5');await page.locator('#table-cell-points').press('Tab');await page.fill('#table-col-width','3');await page.locator('#table-col-width').press('Tab');await page.click('#table-fit-rows');await page.click('#table-save');await page.locator('.table-modal').waitFor({state:'detached'});
  const table=await page.evaluate(()=>{const f=doc.fields[0],cells=[...buildCells(doc,true).values()];return {points:f.points,merge:f.table.merges[0],width:f.table.colWidths[0],values:tableValues(f.table,doc.answers[f.id]),missing:missingTableCells(f,doc.answers[f.id]),wrapped:cells.some(c=>c.lines?.length>1),sheet:[...buildCells(doc,false).values()].map(c=>c.t).join('')};});assert.equal(table.points,.5);assert.equal(table.merge.cols,2);assert.equal(table.width,3);assert.equal(table.values[1][0],'秘密の解答\n次の行');assert.ok(table.missing>0);assert.ok(table.wrapped);assert.ok(!table.sheet.includes('秘密'));
  let saved=await page.evaluate(()=>docJson(false));await page.evaluate(s=>loadWork(s),saved);assert.equal(await page.evaluate(()=>docJson(false)),saved);
  await page.evaluate(()=>{doc=buildAutoDocument(parseAutoAnswers('1\n'+Array.from({length:60},(_,i)=>(i+1)+'￥12￥2￥知').join('\n'),{subject:'数学'}),'数学');startApp();});
  await page.click('#side-tab-pages');await page.click('#page-split');await page.check('.modal [data-k="ok"]');await page.click('.modal [data-act="ok"]');assert.ok(await page.evaluate(()=>allPages().length>1));assert.equal(await page.evaluate(()=>allPages().reduce((n,p)=>n+p.fields.length,0)),60);assert.ok(await page.evaluate(()=>allPages().every(p=>contentScale(p)>=.95)));
  const count=await page.locator('#page-select option').count();await page.click('#side-tab-pages');await page.selectOption('#page-select','1');await page.click('#side-tab-paper');await page.selectOption('#paper-orientation','landscape');await page.click('#side-tab-pages');await page.selectOption('#page-select','0');assert.equal(await page.evaluate(()=>doc.paper.orientation),'portrait');await page.click('#side-tab-pages');await page.selectOption('#page-select','1');assert.equal(await page.evaluate(()=>doc.paper.orientation),'landscape');
  saved=await page.evaluate(()=>docJson(false));await page.evaluate(s=>loadWork(s),saved);assert.equal(await page.evaluate(()=>docJson(false)),saved);
  await page.click('#side-tab-pages');await page.click('#page-add');assert.equal(await page.locator('#page-select option').count(),count+1);await page.click('#btn-undo');assert.equal(await page.locator('#page-select option').count(),count);
  await page.click('#tab-answer');await page.click('#side-tab-pages');await page.selectOption('#page-select','0');await page.evaluate(()=>{snapshot(['answers']);doc.answers[doc.fields[0].id]='24';render();});await page.click('#side-tab-pages');await page.selectOption('#page-select','1');await page.click('#btn-undo');assert.equal(await page.evaluate(()=>doc.pageIndex),0);assert.equal(await page.evaluate(()=>doc.answers[doc.fields[0].id]),'12');await page.click('#side-tab-pages');await page.selectOption('#page-select','1');await page.click('#btn-redo');assert.equal(await page.evaluate(()=>doc.pageIndex),0);assert.equal(await page.evaluate(()=>doc.answers[doc.fields[0].id]),'24');
  console.log('PASS: multiline table, merging, column width, auto row height, missing-cell detection, decimal cell scoring, multi-page splitting and navigation/save/undo');
  await page.click('#tab-answer');await page.click('#side-tab-pages');await page.click('#page-add');assert.equal(await page.locator('#page-select option').count(),count+1);await page.click('#btn-undo');assert.equal(await page.locator('#page-select option').count(),count);await page.click('#btn-redo');assert.equal(await page.locator('#page-select option').count(),count+1);
  const enlarged=await page.evaluate(()=>{const rows=parseAutoAnswers('1\n'+Array.from({length:20},(_,i)=>(i+1)+'￥漢字《かんじ》￥2￥知').join('\n'),{subject:'国語'}),pages=buildPageDocuments(rows,'国語',newDoc('国語').paper,'大きな用紙',1.25);return {count:pages.reduce((n,p)=>n+p.fields.length,0),scales:pages.map(contentScale),ruby:answerVectorPrimitives(pages[0],true).some(v=>v.text==='か')};});assert.equal(enlarged.count,20);assert.ok(enlarged.scales.every(s=>s>=1.249));assert.ok(enlarged.ruby);
  await page.evaluate(()=>{doc=buildAutoDocument(parseAutoAnswers('1￥￥2￥知￥表￥2×2',{subject:'数学'}),'数学');const f=doc.fields[0];doc.answers[f.id]=tableAnswerText([['x^{n+1}','3C1'],['1^2','漢字《かんじ》']]);startApp();});
  const richTable=await page.evaluate(()=>({blank:answerVectorPrimitives(doc,false).filter(v=>v.k==='text').map(v=>v.text),model:answerVectorPrimitives(doc,true).filter(v=>v.k==='text').map(v=>v.text)}));assert.ok(richTable.model.includes('n+1')&&richTable.model.includes('C')&&richTable.model.includes('かんじ'));assert.ok(!richTable.blank.includes('n+1'));
  await page.evaluate(()=>{doc=buildAutoDocument(parseAutoAnswers('1￥文章￥2￥知￥解答欄のみ￥10×5',{subject:'英語'}),'英語');startApp();ui.cur={...doc.fields[0].rects[0]};});await page.click('#tab-draw');await page.click('#field-guides');await page.selectOption('.modal [data-k="guides"]','english');await page.fill('.modal [data-k="targetWords"]','80');await page.click('.modal [data-act="ok"]');assert.ok(await page.evaluate(()=>answerVectorPrimitives(doc,false).some(v=>v.text==='80語程度')));
  await page.click('#figure-add');await page.fill('.modal [data-k="x"]','5');await page.fill('.modal [data-k="y"]','20');await page.check('.modal [data-k="answerOnly"]');await page.click('.modal [data-act="ok"]');assert.ok(await page.evaluate(()=>doc.drawings.length>=60 && doc.drawings.every(d=>d.answerOnly)));
  console.log('PASS: page undo/redo from the answer tab, enlarged handwriting pages, furigana, rich math in tables, four-line guides and model-only figures');
  // The final two-page export combines a table, rich math and separate public/private images.
  await page.evaluate(()=>{
    const first=buildAutoDocument(parseAutoAnswers('1￥1^2 + x^{n+1} + 3C1￥2￥知￥数式\n2￥￥4￥知￥表￥2×2',{subject:'数学'}),'数学');
    const f=first.fields[1];f.table=tableSpec({given:[['見出し','項目'],['','']],rowHeights:[5,5]},2,2);f.rects[0].h=10;first.answers[f.id]=tableAnswerText([['見出し','項目'],['秘密\n二行','答え']]);
    const second=buildAutoDocument(parseAutoAnswers('1￥次のページ￥2￥知',{subject:'社会'}),'社会');second.paper.orientation='landscape';second.paper.contentScale=fitContentScale(second);
    doc=first;doc.bookPages=[pageCopy(first),second];doc.pageIndex=0;startApp();
  });
  assert.equal(await page.evaluate(()=>scoreTotals(doc)['合計']),8);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=20;const g=c.getContext('2d');g.fillStyle='red';g.fillRect(0,0,40,20);return c.toDataURL('image/png').split(',')[1];});
  await page.setInputFiles('#image-file',{name:'図.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.waitForSelector('.modal [data-k="id"]');await page.click('.modal [data-act="cancel"]');
  await page.evaluate(()=>{const i=doc.images[0];doc.images.push({...i,id:'private-image',name:'解答図',answerOnly:true,x:100,w:20,h:10});doc.drawings.push({k:'line',x1:2,y1:40,x2:4,y2:42,w:'thin',answerOnly:true});ui.tab='answer';render();});
  const backup=await page.evaluate(()=>{options.backupAnswers=false;return JSON.parse(docJson(true));});assert.deepEqual(backup.answers,{});assert.ok(backup.bookPages.every(p=>Object.keys(p.answers).length===0));assert.ok(backup.images.every(i=>!i.answerOnly));
  assert.equal(await page.locator('#sheet image').count(),2);await page.click('#tab-sheet');assert.equal(await page.locator('#sheet image').count(),1);await page.click('#tab-answer');
  await page.screenshot({path:path.join(out,'math-table-images.png'),fullPage:true});
  const download=page.waitForEvent('download');await page.click('#btn-xlsx');await(await download).saveAs(path.join(out,'book.xlsx'));assert.equal(await page.evaluate(()=>doc.pageIndex),0);
  await page.emulateMedia({media:'print'});await page.pdf({path:path.join(out,'book.pdf'),preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});
  await page.click('#tab-draw');await page.emulateMedia({media:'print'});await page.pdf({path:path.join(out,'drawing-tab.pdf'),preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});assert.equal(await page.evaluate(()=>ui.tab),'draw');
  await page.setViewportSize({width:390,height:844});await page.click('#btn-answer-editor');await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});assert.ok(await page.locator('.auto-modal .card').evaluate(el=>el.clientWidth<=innerWidth));await page.click('#auto-cancel');assert.deepEqual(errors,[]);
  const check=spawnSync(process.env.TEST_PYTHON_PATH || 'python3',['-c',`
from pathlib import Path
from openpyxl import load_workbook
from pypdf import PdfReader
from zipfile import ZipFile
from xml.etree import ElementTree as E
import sys
p=Path(sys.argv[1]);b=load_workbook(p/'book.xlsx')
assert b.sheetnames==['解答用紙 1','模範解答 1','解答用紙 2','模範解答 2'],b.sheetnames
assert b.worksheets[0].page_setup.orientation=='portrait' and b.worksheets[2].page_setup.orientation=='landscape'
assert len(b.worksheets[0]._images)==1 and len(b.worksheets[1]._images)==2
assert any(c.value=='秘密\\n二行' and c.alignment.wrap_text for row in b.worksheets[1] for c in row)
assert not any(c.value and '秘密' in str(c.value) for row in b.worksheets[0] for c in row)
with ZipFile(p/'book.xlsx') as z:
 ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','xdr':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'}
 model=E.fromstring(z.read('xl/drawings/drawing2.xml'));texts=[e.text for e in model.findall('.//a:t',ns)]
 assert 'n+1' in texts and 'C' in texts and '^' not in texts,texts
 ids=[e.attrib['id'] for e in model.findall('.//xdr:cNvPr',ns)];assert len(ids)==len(set(ids))
pdf=PdfReader(p/'book.pdf');assert len(pdf.pages)==2,len(pdf.pages)
assert float(pdf.pages[0].mediabox.width)<float(pdf.pages[0].mediabox.height)
assert float(pdf.pages[1].mediabox.width)>float(pdf.pages[1].mediabox.height)
draw=PdfReader(p/'drawing-tab.pdf');assert len(draw.pages)==2
assert not any('秘密' in page.extract_text() for page in draw.pages)
assert len(draw.pages[0].images)==1
print('PASS: independent multi-sheet Excel, image embedding/privacy, rich math, multiline wrap and mixed-orientation A4 PDF')
`,out],{encoding:'utf8'});process.stdout.write(check.stdout || '');process.stderr.write(check.stderr || '');assert.equal(check.status,0);console.log('Artifacts: '+out);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
