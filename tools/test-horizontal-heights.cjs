const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
(async()=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'answer-heights-'));
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(process.env.TEST_HTML || path.join(__dirname,'../answer-sheet-maker.html')));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH || '/usr/bin/chromium',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1366,height:1000},acceptDownloads:true});
    await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
    await page.goto('http://127.0.0.1:'+server.address().port);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const subject of ['数学','英語','理科','社会','その他'])for(const heading of ['above','side']){
      const result=await page.evaluate(({subject,heading})=>{
        const source='1\n1￥ア\n2￥太陽\n3￥用語￥2￥知￥語句\n2\n1￥(1)￥A￥太陽\n1￥(1)￥B￥月\n2￥(1)￥理由￥2￥思￥記述￥3×2\n2￥(2)￥理由￥2￥思￥記述￥3×4\n3\n1￥あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ￥2￥知￥30字\n4\n1￥x^2￥2￥知￥数式\n2￥太～陽￥2￥知￥初終1字\n5\n1￥ア\tイ￥2￥知￥表￥2×2\n6\n1￥y=x^2￥2￥知￥グラフ￥4×4';
        const rows=parseAutoAnswers(source,{subject});
        doc=buildAutoDocument(rows,subject,{...newDoc(subject).paper,groupHeading:heading});
        startApp();ui.tab='answer';render();
        const cells=buildCells(doc,true),boxes=doc.fields.flatMap(f=>[...f.rects,...(f.label?[f.label]:[])]).concat(doc.decorations.filter(d=>d.questionHeading));
        const used=new Set(headerLayout(doc).reserved);let overlaps=0;
        for(const b of boxes)for(let c=b.c;c<b.c+b.w;c++)for(let r=b.r;r<b.r+b.h;r++){const k=c+','+r;if(used.has(k))overlaps++;used.add(k);}
        const fields=doc.fields.map(f=>({kind:f.auto.kind,rects:f.rects,label:f.label,explicit:f.auto.h,
          border:f.label?unionBorders(cells,f.label.c,f.label.r,f.label.w,f.label.h):null}));
        const parents=doc.decorations.filter(h=>h.questionHeading).map(h=>({frame:h,children:doc.fields.filter(f=>[f.auto.questionId,f.auto.subQuestionId].includes(h.id)).flatMap(f=>f.rects)}));
        return {fields,parents,overlaps,outside:countOutside(doc,doc.grid),work:docJson(false)};
      },{subject,heading});
      assert.equal(result.fields.filter(f=>f.kind==='essay').length,2);
      assert.equal(result.overlaps,0,subject+' '+heading+' overlaps');assert.equal(result.outside,0);
      for(const f of result.fields){
        const top=Math.min(...f.rects.map(r=>r.r)),bottom=Math.max(...f.rects.map(r=>r.r+r.h));
        assert.equal(f.label.r,top);assert.equal(f.label.r+f.label.h,bottom,subject+' '+heading+' '+f.kind+' label bottom');
        assert.ok(f.border.top && f.border.bottom && f.border.left && f.border.right);
        if(f.kind==='chars')assert.ok(f.rects.every(r=>r.h===2),'Character cells keep their handwriting height');
        if(f.kind==='essay' && f.explicit)assert.equal(f.rects[0].h,f.explicit*2,'Explicit height is preserved');
      }
      assert.equal(result.fields[0].rects[0].h,result.fields[1].rects[0].h,'Adjacent mark and character fields have matching height');
      for(const p of result.parents)assert.equal(p.frame.r+p.frame.h,Math.max(...p.children.map(r=>r.r+r.h)),'Parent number covers child fields');
      await page.screenshot({path:path.join(out,subject+'-'+heading+'.png'),fullPage:true});
      fs.writeFileSync(path.join(out,subject+'-'+heading+'.json'),result.work);
      const pending=page.waitForEvent('download');await page.click('#btn-xlsx');await(await pending).saveAs(path.join(out,subject+'-'+heading+'.xlsx'));
      await page.evaluate(work=>loadWork(work),result.work);assert.equal(await page.evaluate(()=>docJson(false)),result.work);
      console.log('PASS:',subject,heading,'number alignment, explicit sizes, handwriting cells, no overlaps, save/load');
    }
    const vertical=await page.evaluate(()=>{const d=buildAutoDocument(parseAutoAnswers('1\n1￥ア\n2￥太陽'), '国語');return d.fields.map(f=>({h:f.rects[0].h,label:f.label.h}));});
    assert.deepEqual(vertical,[{h:3,label:1},{h:4,label:1}]);
    const py=spawnSync(process.env.TEST_PYTHON_PATH || 'python3',['-c',`
import sys,json
from pathlib import Path
from openpyxl import load_workbook
for path in Path(sys.argv[1]).glob('*.xlsx'):
 work=json.loads(path.with_suffix('.json').read_text())
 for sheet in load_workbook(path):
  occupied=set()
  for m in sheet.merged_cells.ranges:
   for row in range(m.min_row,m.max_row+1):
    for col in range(m.min_col,m.max_col+1):
     assert (row,col) not in occupied,(path,m)
     occupied.add((row,col))
  frames=[f['label'] for f in work['fields'] if f.get('label')]+[h for h in work['decorations'] if h.get('questionHeading')]
  for b in frames:
   c,r,w,h=b['c']+1,b['r']+1,b['w'],b['h']
   assert any((m.min_col,m.min_row,m.max_col,m.max_row)==(c,r,c+w-1,r+h-1) for m in sheet.merged_cells.ranges),(path,b)
   assert sheet.cell(r,c).border.top.style and sheet.cell(r+h-1,c).border.bottom.style,(path,b)
 print('PASS: Excel number merges and borders',path.stem)
`,out],{encoding:'utf8'});
    process.stdout.write(py.stdout);process.stderr.write(py.stderr);assert.equal(py.status,0);assert.deepEqual(errors,[]);
    console.log('PASS: Japanese geometry preserved. Artifacts:',out);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
