// Run: node tools/test-answer-padding.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'answer-padding-'));
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1366,height:1000},acceptDownloads:true});
  await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
  await page.goto('http://127.0.0.1:'+server.address().port);
  const result=await page.evaluate(()=>{
   doc=buildAutoDocument(parseAutoAnswers('1\n1,地方分権,2,知,語句,4×2\n2,ア,2,知,記号\n3,国民の権利を守るため。,4,思,20字以内',{subject:'社会'}),'社会');
   startApp();ui.tab='answer';render();
   const cells=[...buildCells(doc,true).values()],word=cells.find(c=>c.t==='地方分権'),mark=cells.find(c=>c.t==='ア');
   const text=[...document.querySelectorAll('#sheet text')].find(t=>t.textContent==='地方分権');
   const field=doc.fields[0].rects[0],actual=+text.getAttribute('x')-(geo.x0+colXmm(field.c));
   const geometry=doc.fields.map(f=>f.rects),answers={...doc.answers};
   const fixed=answerPlan(doc,doc.fields[2],doc.answers.f3).out;
   // A long answer has a reserve at both ends on every line, including when font size is reduced.
   const d=newDoc('英語'),f={type:6,rects:[{c:2,r:12,w:4,h:8}],fixedChars:false};
   const sentence='These students enjoy learning science together every day.';
   const plan=answerPlan(d,f,sentence);
   const widths=plan.out.map(({p,ch,size})=>({used:mathTextWidth(ch.trimEnd(),size),limit:(p.mw*CW-2*answerInset(size))*.92}));
   const mathDoc=newDoc('数学'),mf={type:6,rects:[{c:2,r:12,w:4,h:4}],fixedChars:false};
   const math=fractionAnswerPlan(mathDoc,mf,'x = 1/2'),box=rectMM(mathDoc,mf.rects[0]);
   return {word,mark,actual,expected:answerInset(word.size),fixed:fixed.every(x=>!x.p.indent),widths,
    content:plan.out.map(x=>x.ch).join(''),sentence,complete:plan.need<=plan.room,
    mathInset:Math.min(...math.vectors.map(v=>v.k==='line'?v.x1:v.x))-box.x,
    unchanged:JSON.stringify(geometry)===JSON.stringify(doc.fields.map(f=>f.rects)) && JSON.stringify(answers)===JSON.stringify(doc.answers)};
  });
  assert.equal(result.word.indent,1);assert.ok(Math.abs(result.actual-result.expected)<.01);
  assert.ok(result.actual>2);assert.equal(result.mark.align,'center');assert.equal(result.mark.indent,0);
  assert.equal(result.fixed,true);assert.equal(result.content,result.sentence);assert.equal(result.complete,true);
  assert.ok(result.widths.every(w=>w.used<=w.limit+.01));assert.ok(result.mathInset>=1.5);assert.equal(result.unchanged,true);
  console.log('PASS: visible inset, centered symbols, fixed character cells, long-text reserve and fraction padding');
  await page.click('#tab-answer');
  await page.screenshot({path:path.join(output,'padding.png'),fullPage:true});
  const pending=page.waitForEvent('download');await page.click('#btn-xlsx');await(await pending).saveAs(path.join(output,'padding.xlsx'));
  const py=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`
from openpyxl import load_workbook
import sys
b=load_workbook(sys.argv[1])
model=b['模範解答'];blank=b['解答用紙']
word=next(c for row in model for c in row if c.value=='地方分権')
mark=next(c for row in model for c in row if c.value=='ア')
assert word.alignment.indent==1 and word.alignment.horizontal=='left'
assert mark.alignment.indent==0 and mark.alignment.horizontal=='center'
assert all(c.alignment.indent==0 for row in blank for c in row)
assert all(c.alignment.indent==0 for row in model for c in row if c.value and len(str(c.value))==1)
print('PASS: exported Excel has model-answer indentation without indenting blank sheets or character cells')
`,path.join(output,'padding.xlsx')],{encoding:'utf8'});
  process.stdout.write(py.stdout);process.stderr.write(py.stderr);assert.equal(py.status,0);
  const vertical=await page.evaluate(()=>{
   doc=buildAutoDocument(parseAutoAnswers('1\n1,相手の気持ちを考えたから。,4,思,記述,1×10\n2,太陽,2,知,語句,1×2'),'国語');
   startApp();ui.tab='answer';render();
   return doc.fields.map(f=>{
    const text=doc.answers[f.id],rect=f.rects[0],cell=[...buildCells(doc,true).values()].find(c=>c.t===text);
    const node=[...document.querySelectorAll('#sheet text')].find(n=>n.textContent===text);
    const glyphs=[...node.querySelectorAll('tspan')],first=glyphs[0],last=glyphs[glyphs.length-1];
    const top=geo.y0+rect.r*RH,bottom=top+rect.h*RH,half=ptmm(cell.size)/2;
    return {text,rect,cell,topGap:+first.getAttribute('y')-half-top,bottomGap:bottom-(+last.getAttribute('y')+half)};
   });
  });
  assert.equal(vertical[0].cell.r,vertical[0].rect.r+1);
  assert.equal(vertical[0].cell.mg.h,vertical[0].rect.h-2);
  assert.ok(vertical[0].topGap>=3.81 && vertical[0].bottomGap>=3.81);
  assert.equal(vertical[1].cell.valign,'center');
  assert.ok(vertical[1].topGap>1 && Math.abs(vertical[1].topGap-vertical[1].bottomGap)<.01);
  await page.click('#tab-answer');await page.screenshot({path:path.join(output,'vertical-padding.png'),fullPage:true});
  const jp=page.waitForEvent('download');await page.click('#btn-xlsx');await(await jp).saveAs(path.join(output,'vertical-padding.xlsx'));
  const check=spawnSync(process.env.TEST_PYTHON_PATH||'python3',['-c',`
import sys,json
from openpyxl import load_workbook
b=load_workbook(sys.argv[1]);fields=json.loads(sys.argv[2]);s=b['模範解答']
for i,f in enumerate(fields):
 c=next(c for row in s for c in row if c.value==f['text'])
 assert c.alignment.textRotation==255
 assert c.alignment.vertical==('top' if i==0 else 'center')
 if i==0:
  r=f['rect'];assert c.row==r['r']+2
  merged=next(m for m in s.merged_cells.ranges if c.coordinate in m)
  assert merged.max_row==r['r']+r['h']-1
  assert s.cell(r['r']+1,c.column).value is None
  assert s.cell(r['r']+r['h'],c.column).value is None
print('PASS: Japanese model answers leave blank top/bottom rows in Excel; short fields stay centered')
`,path.join(output,'vertical-padding.xlsx'),JSON.stringify(vertical)],{encoding:'utf8'});
  process.stdout.write(check.stdout);process.stderr.write(check.stderr);assert.equal(check.status,0);
  console.log('3 padding checks passed\nArtifacts: '+output);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
