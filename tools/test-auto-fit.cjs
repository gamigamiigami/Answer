// Run: node tools/test-auto-fit.cjs (Playwright, Chromium, Python/openpyxl)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const groups = (n,answer='ア',kind='記号') => Array.from({length:n},(_,i)=>(i+1)+'\n1,'+answer+',2,知,'+kind).join('\n');
const fixtures = [
  {name:'gap',subject:'国語',source:groups(12),gap:80,width:100},
  {name:'width',subject:'国語',source:groups(17),gap:40,width:87.5},
  {name:'kanji',subject:'国語',source:groups(14,'太陽','漢字2字'),gap:40,width:90},
  {name:'single',subject:'国語',source:'1\n'+Array.from({length:45},(_,i)=>(i+1)+',,2,思,解答欄のみ').join('\n'),gap:100,width:92.5},
  {name:'horizontal-gap',subject:'数学',source:groups(12),gap:50,width:100},
  {name:'horizontal-width',subject:'数学',source:'1\n'+Array.from({length:90},(_,i)=>(i+1)+',あいうえおか,2,知,語句,6×1').join('\n'),gap:100,width:85}
];
(async()=>{
  const html=fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html'));
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'answer-fit-'));
  let browser, count=0;
  const pass=message=>{count++; console.log('PASS:',message);};
  try {
    browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH || '/usr/bin/chromium',headless:true});
    const page=await browser.newPage({viewport:{width:1366,height:900},acceptDownloads:true});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
    await page.goto('http://127.0.0.1:'+server.address().port);
    const normal=await page.evaluate(()=>{
      const rows=parseAutoAnswers(AUTO_SAMPLE), d=buildAutoDocument(rows,'国語');
      const baseline=buildAutoLayout(rows,'国語',null,'',{gap:1,width:1});
      return {same:JSON.stringify(d)===JSON.stringify(baseline),fit:d.paper.autoFit};
    });
    assert.equal(normal.same,true); assert.equal(normal.fit,undefined);
    pass('A sheet that already fits keeps its original spacing and field widths');

    for(const fixture of fixtures){
      const result=await page.evaluate(({source,subject})=>{
        const rows=parseAutoAnswers(source), d=buildAutoDocument(rows,subject), vertical=d.paper.writing==='vertical';
        const occupied=new Set(headerLayout(d).reserved); let overlap=false;
        for(const f of d.fields) for(const [c,r] of fieldFootprint(d,f)){
          const key=c+','+r; if(occupied.has(key)) overlap=true; occupied.add(key);
        }
        const heads=Object.entries(d.texts).filter(([,v])=>v.centerAcross).map(([k,v])=>({c:+k.split(',')[0],r:+k.split(',')[1],span:v.span}));
        const gaps=heads.slice(1).map((h,i)=>vertical ? d.colw[h.c+h.span] : h.r-(heads[i].r+heads[i].span*CHAR_ROWS));
        const widths=d.fields.flatMap(f=>f.rects.flatMap(r=>Array.from({length:r.w},(_,i)=>d.colw[r.c+i])));
        return {fit:d.paper.autoFit,count:d.fields.length,expected:rows.length,overlap,outside:countOutside(d,d.grid),
          gaps,widths,total:d.colw.reduce((s,v)=>s+CW*v,0),limit:printableW(d),
          headerWidths:vertical ? d.colw.slice(-6) : [],
          blanks:d.fields.filter(f=>f.auto.kind==='blank').map(f=>[f.rects[0].w,f.rects[0].h]),
          complete:d.fields.every(f=>!d.answers[f.id] || answerPlan(d,f,d.answers[f.id]).need<=answerPlan(d,f,d.answers[f.id]).room)};
      },fixture);
      assert.deepEqual(result.fit,{gapPercent:fixture.gap,widthPercent:fixture.width});
      assert.equal(result.count,result.expected); assert.equal(result.overlap,false); assert.equal(result.outside,0);
      assert.ok(result.total<=result.limit+0.001); assert.equal(result.complete,true);
      assert.ok(result.widths.every(w=>Math.abs(w-fixture.width/100*(fixture.name==='kanji'?1.3:1))<0.0001));
      assert.ok(result.gaps.every(g=>Math.abs(g-(fixture.subject==='国語'?fixture.gap/100:1))<0.0001));
      assert.ok(result.headerWidths.every(w=>w===1));
      assert.ok(result.blanks.every(([w,h])=>w===1 && h===20));
      pass(fixture.name+': all questions fit A4 without overlap; gaps are uniform, counts/heights and header widths are preserved');
    }

    // Exercise the actual workflow, including saved width arrays, headers and Excel.
    for(const fixture of fixtures.filter(f=>['gap','width','horizontal-width'].includes(f.name))){
      await page.evaluate(()=>{doc=null;});
      await page.evaluate(()=>openAnswerGenerator('自動調整テスト'));
      await page.selectOption('#auto-subject',fixture.subject);
      await page.fill('#auto-source',fixture.source); await page.click('#auto-parse');
      await page.click('#auto-apply');
      assert.match(await page.locator('#status').innerText(),/作成時の自動調整/);
      assert.ok(await page.locator('#status .chip').first().evaluate(n=>{const r=n.getBoundingClientRect();return n.textContent.startsWith('作成時の自動調整') && r.left>=0 && r.right<=innerWidth;}));
      const saved=await page.evaluate(()=>docJson(false));
      await page.evaluate(saved=>loadWork(saved),saved);
      assert.equal(await page.evaluate(()=>docJson(false)),saved);
      await page.click('#more-menu > summary'); await page.click('#btn-settings');
      await page.click('.modal [data-act="ok"]');
      assert.equal(await page.locator('.modal').count(),0);
      assert.equal(await page.evaluate(()=>docJson(false)),saved);
      await page.click('#btn-answer-editor');
      assert.equal(await page.locator('[data-row]').count(),fixture.name==='horizontal-width'?90:fixture.name==='gap'?12:17);
      await page.check('#auto-replace'); await page.click('#auto-apply');
      const geometry=d=>{d.fields.forEach(f=>delete f.auto);return d;};
      assert.deepEqual(geometry(await page.evaluate(()=>JSON.parse(docJson(false)))),geometry(JSON.parse(saved)));
      await page.click('#tab-answer');
      await page.screenshot({path:path.join(output,fixture.name+'.png'),fullPage:true});
      for(const [selector,extension] of [['#btn-xlsx','xlsx'],['#btn-save','json']]){
        const pending=page.waitForEvent('download'); await page.click(selector); const file=await pending;
        await file.saveAs(path.join(output,fixture.name+'.'+extension));
      }
    }
    pass('Adjusted layouts survive save/load, unchanged settings, regeneration, and actual Excel export');

    const saved=await page.evaluate(()=>docJson(false));
    await page.click('#btn-answer-editor'); await page.click('#auto-tab-input');
    await page.fill('#auto-source',groups(20)); await page.click('#auto-parse'); await page.selectOption('#auto-subject','国語');
    await page.check('#auto-replace');
    const before=await page.evaluate(()=>JSON.stringify({doc,uid,history}));
    await page.click('#auto-apply');
    assert.match(await page.locator('#auto-status').innerText(),/80％.*A4/);
    assert.equal(await page.evaluate(()=>JSON.stringify({doc,uid,history})),before);
    await page.click('#auto-cancel');
    await page.click('#btn-answer-editor'); await page.click('#auto-tab-input');
    await page.fill('#auto-source','1\n1,ア,2,知'); await page.click('#auto-parse');
    await page.check('#auto-replace'); await page.click('#auto-apply');
    assert.equal(await page.evaluate(()=>doc.paper.autoFit),undefined);
    await page.keyboard.press('Control+z'); assert.equal(await page.evaluate(()=>docJson(false)),saved);
    await page.keyboard.press('Control+y'); assert.equal(await page.evaluate(()=>doc.fields.length),1);
    pass('The lower limit fails atomically, smaller revisions return to normal, and undo/redo restores adjusted widths');

    const python=spawnSync('python3',['-c',`
import json,sys
from pathlib import Path
from openpyxl import load_workbook
p=Path(sys.argv[1])
for name in ['gap','width','horizontal-width']:
 d=json.loads((p/(name+'.json')).read_text())
 b=load_workbook(p/(name+'.xlsx'))
 assert b.sheetnames==['解答用紙','模範解答']
 for s in b:
  assert s.page_setup.scale==80 and str(s.page_setup.paperSize)=='9'
  for c,factor in enumerate(d['colw'],1):
   width=next(v.width for v in s.column_dimensions.values() if v.min<=c<=v.max)
   assert abs(width-6.125*factor)<0.0002, (name,c,width,factor)
  if d['paper']['writing']=='vertical':
   assert s.cell(2,d['grid']['cols']).value==d['paper']['title']
   assert s.cell(2,d['grid']['cols']).alignment.textRotation==255
  else: assert s.cell(1,1).value==d['paper']['title']
  seen=set()
  for m in s.merged_cells.ranges:
   assert m.max_col<=d['grid']['cols'] and m.max_row<=d['grid']['rows']
   for coordinate in m.cells:
    assert coordinate not in seen
    seen.add(coordinate)
 model=[str(cell.value) for row in b['模範解答'] for cell in row if cell.value is not None]
 for answer in d['answers'].values(): assert answer in model, (name,answer)
 print('PASS: '+name+' exported Excel preserves all adjusted column widths, title, model answers and non-overlapping merges')
`,output],{encoding:'utf8'});
    process.stdout.write(python.stdout); process.stderr.write(python.stderr);
    assert.equal(python.status,0);
    assert.deepEqual(errors,[]);
    pass('Independent workbook checks and browser execution complete without errors');
    console.log(count+' auto-fit checks passed\nArtifacts: '+output);
  } finally { if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
