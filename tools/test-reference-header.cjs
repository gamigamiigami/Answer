const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'testomo-reference-header-')),server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html;charset=utf-8');r.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')))});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium'});const page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{doc=buildAutoDocument(parseAutoAnswers('1\n1￥ア￥2￥知\n2￥太陽￥2￥知'),'国語');startApp();});
  const header=await page.evaluate(()=>{const h=headerLayout(doc);return {cols:doc.grid.cols,rows:doc.grid.rows,nameLabel:doc.paper.nameLabel,items:h.texts.map(t=>({...t,box:{x:geo.x0+docColumnMM(doc,t.c),y:geo.y0+t.r*RH,w:docColumnMM(doc,t.c+t.mg.w)-docColumnMM(doc,t.c),h:t.mg.h*RH}}))};});fs.writeFileSync(path.join(out,'header.json'),JSON.stringify(header));
  assert.equal(header.items.find(t=>t.valign==='bottom').size,16);assert.ok(header.items.every(t=>t.bold));
  await page.screenshot({path:path.join(out,'reference-header.png'),fullPage:true});const download=page.waitForEvent('download');await page.click('#btn-xlsx');await(await download).saveAs(path.join(out,'header.xlsx'));
  const saved=await page.evaluate(()=>docJson(false));await page.evaluate(s=>loadWork(s),saved);assert.equal(await page.evaluate(()=>docJson(false)),saved);
  await page.evaluate(()=>{const d=newDoc('国語');d.paper.nameLabel=standardNameLabel(d.paper,10);loadWork(JSON.stringify(d));});assert.equal(await page.evaluate(()=>doc.paper.nameLabel),header.nameLabel);
  await page.evaluate(()=>{doc.paper.nameLabel='学校で指定した氏名欄';loadWork(docJson(false));});assert.equal(await page.evaluate(()=>doc.paper.nameLabel),'学校で指定した氏名欄');assert.deepEqual(errors,[]);
  const check=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`
from pathlib import Path
from openpyxl import load_workbook
import sys,json,math
p=Path(sys.argv[1]);ref=load_workbook(sys.argv[2],keep_vba=True)['解答欄'];generated=load_workbook(p/'header.xlsx');ui=json.loads((p/'header.json').read_text(encoding='utf8'))
def colmm(width):return (math.floor(width*7+.5)+5)*25.4/96*.8
widths={i:d.width for d in ref.column_dimensions.values() for i in range(d.min,min(d.max,27)+1)}
gridw=sum(colmm(widths[c]) for c in range(2,28));rowmm=lambda r:(ref.row_dimensions[r].height or ref.sheet_format.defaultRowHeight)*25.4/72*.8
gridh=sum(rowmm(r) for r in range(1,49));x0=(297-gridw)/2;y0=(210-gridh)/2
for i,(cell,end,alignment) in enumerate([('Z2',47,'bottom'),('AA2',43,'center')]):
 original=ref[cell];col=original.column
 expected={'x':x0+sum(colmm(widths[c]) for c in range(2,col)),'y':y0+rowmm(1),'w':colmm(widths[col]),'h':sum(rowmm(r) for r in range(2,end+1))}
 actual=ui['items'][1-i]
 assert actual['size']==original.font.sz and actual['bold']==original.font.b
 assert actual['valign']==alignment
 for axis,v in expected.items():assert abs(actual['box'][axis]-v)<.5,(cell,axis,actual['box'],expected)
 if i==0:assert ui['nameLabel']==original.value,(repr(ui['nameLabel']),repr(original.value))
 for s in generated:
  c=s.cell(2,ui['cols']-1+i);assert c.font.sz==original.font.sz and c.font.bold==original.font.bold
  assert c.alignment.vertical==alignment and c.alignment.textRotation==255
  assert abs(s.column_dimensions[c.column_letter].width-widths[col])<1e-5
  assert any(m.min_row==2 and m.max_row==end and m.min_col==c.column and m.max_col==c.column for m in s.merged_cells.ranges)
print('PASS: reference workbook name text, font, bold, column widths, merge heights, alignment and A4 positions (within 0.5mm)')
`,out,path.join(__dirname,'../docs/reference/R6_kokugo_answer_sheet.xlsm')],{encoding:'utf8'});process.stdout.write(check.stdout||'');process.stderr.write(check.stderr||'');assert.equal(check.status,0);console.log('Artifacts: '+out);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
