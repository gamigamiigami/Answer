// Run: node tools/test-answer-generator.cjs
// Uses the cloud environment's Playwright and Chromium; no application dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-autogen-'));
const html = fs.readFileSync(path.join(__dirname, '../answer-sheet-maker.html'));
const sample = '大問一\n問一 ア ２点 知識技能\n(1) 光合成 3点 知識技能\n(2) 日光が当たるため。 20字以内 8割ラインあり 5点 思考判断表現\n大問二\n(1) ア・ウ 完答 4点 知識技能\n(2) 解答欄のみ 3×2 4点 思考判断表現\n(3) グラフ 6×6 6点 思考判断表現';
(async () => {
  const server = http.createServer((req,res) => { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(html); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = 'http://127.0.0.1:'+server.address().port;
  let browser;
  const failures = [], external = [];
  let count = 0;
  const pass = name => { count++; console.log('PASS:',name); };
  try {
    browser = await chromium.launch({ executablePath:process.env.TEST_BROWSER_PATH || '/usr/bin/chromium',headless:true });
    const context = await browser.newContext({ viewport:{width:1366,height:900},acceptDownloads:true });
    await context.addInitScript(() => Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
    context.on('page',page => {
      page.on('pageerror',e => failures.push(e.message));
      page.on('request',r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(url+'/')) external.push(r.url()); });
    });
    const page = await context.newPage();
    await page.goto(url);
    const parse = text => page.evaluate(text => parseAutoAnswers(text),text);
    const plain = await parse('ア');
    assert.equal(plain[0].kind,'mark'); assert.equal(plain[0].points,0);
    assert.ok(plain[0].warnings.includes('観点を推定'));
    pass('Single answer infers a symbol field and reports unspecified metadata');
    const structured = await parse('大問二\n問三\n（１） (連体)修飾語 [４点 知識・技能 完答]\n② ア ２０字以内 8割ラインなし ５点 思考・判断・表現');
    assert.equal(structured[0].group,'二'); assert.equal(structured[0].label,'問三（１）');
    assert.equal(structured[0].answer,'(連体)修飾語'); assert.equal(structured[0].points,4); assert.ok(structured[0].complete);
    assert.equal(structured[1].n,20); assert.equal(structured[1].eight,false); assert.equal(structured[1].aspect,'思判表');
    pass('Hierarchical and full-width numbering, annotations, complete scoring and explicit line override');
    assert.equal((await parse('「2点」'))[0].answer,'「2点」');
    assert.equal((await parse('初終 3字 「初め 終わり'))[0].kind,'extract');
    pass('Answer text is preserved; explicit extract type survives a following character count');
    const explicit=await page.evaluate(()=>parseAutoAnswers('大問一\nア 5点 思考判断表現\n\nイ',
      {group:'三',groupStyle:'kanji',numStyle:'Q',start:1,points:2,aspect:'知技',blankGroups:true}));
    assert.equal(explicit[0].points,5); assert.equal(explicit[0].aspect,'思判表');
    assert.equal(explicit[1].group,'二'); assert.equal(explicit[1].points,2);
    pass('Explicit pasted annotations override defaults, and section breaks follow the pasted section');
    const positions = await page.evaluate(() => {
      const rows=parseAutoAnswers('大問一\n(1) ア\n(2) イ\n大問二\n(1) ウ\n大問一\n(3) エ');
      const a=buildAutoDocument(rows,'国語'); const b=buildAutoDocument(rows,'数学');
      return {groups:a.fields.map(f=>f.auto.group),v:a.fields.map(f=>({r:f.rects[0],label:f.label})),h:b.fields.map(f=>({r:f.rects[0],label:f.label}))};
    });
    assert.deepEqual(positions.groups,['一','一','一','二']);
    assert.equal(positions.v[1].label.r,positions.v[0].r.r+positions.v[0].r.h);
    assert.equal(positions.v[1].label.c,positions.v[0].label.c);
    assert.equal(positions.h[1].label.c,positions.h[0].r.c+positions.h[0].r.w);
    assert.equal(positions.h[1].label.r,positions.h[0].label.r);
    pass('Questions in the same section remain consecutive in both writing directions');
    for(const subject of ['国語','数学']){
      for(const span of [2,3]){
        const layout=await page.evaluate(({subject,span})=>{
          const vertical=subject==='国語';
          const d=buildAutoDocument(parseAutoAnswers('1\n1,,2,思,解答欄のみ,'+(vertical?span+'×2':'2×'+span)+'\n2\n1,ア,2,知'),subject);
          const headings=Object.entries(d.texts).filter(([,v])=>v.centerAcross).map(([k,v])=>({c:+k.split(',')[0],r:+k.split(',')[1],...v}));
          return {headings,cells:[...buildCells(d,false).values()],fields:d.fields,unit:CHAR_ROWS,rows:d.grid.rows,cols:d.grid.cols};
        },{subject,span});
        const [a,b]=layout.headings; assert.equal(a.span,span);
        const c=subject==='国語'?a.c+Math.floor((span-1)/2):a.c;
        const r=subject==='国語'?a.r:a.r+Math.floor((span-1)/2)*layout.unit;
        const cell=layout.cells.find(x=>x.c===c && x.r===r);
        assert.equal(cell.t,'一'); assert.equal(cell.align,'center');
        if(subject==='国語'){
          assert.equal(b.c+b.span,a.c-1);
          for(const x of layout.cells.filter(x=>x.c===a.c-1)) assert.ok(!x.t && Object.keys(x.b).length===0);
          if(span===2) assert.deepEqual(cell.mg,{w:2,h:1});
        } else {
          assert.equal(b.r,a.r+(span+1)*layout.unit);
          for(const x of layout.cells.filter(x=>x.r>=a.r+span*layout.unit && x.r<b.r)) assert.ok(!x.t && Object.keys(x.b).length===0);
          assert.deepEqual(cell.mg,{w:1,h:layout.unit*(span===2?2:1)});
        }
      }
    }
    pass('Section boundaries leave one blank column or handwriting row; headings center across odd and even spans');
    for(const subject of ['国語','数学']){
      const nested=await page.evaluate(subject=>{
        const d=buildAutoDocument(parseAutoAnswers('1\n1,(1),ア,2,知\n1,(2),イ,3,思\n2,(A),ウ,4,知\n2,(B),エ,5,知\n2\n1,(1),オ,2,知'),subject);
        return {fields:d.fields,parents:d.decorations,texts:d.texts,unit:CHAR_ROWS};
      },subject);
      const [a,b,c,e,last]=nested.fields;
      assert.equal(nested.parents.length,3);
      assert.equal(a.auto.questionId,b.auto.questionId); assert.equal(c.auto.questionId,e.auto.questionId);
      assert.notEqual(a.auto.questionId,last.auto.questionId);
      const parent=nested.parents.find(p=>p.id===a.auto.questionId);
      assert.equal(nested.texts[parent.c+','+parent.r].t,'問一');
      assert.equal(nested.texts[a.label.c+','+a.label.r].t,'(1)');
      assert.equal(nested.texts[b.label.c+','+b.label.r].t,'(2)');
      for(const f of nested.fields){
        assert.equal(f.label.w,1); assert.equal(f.label.h,subject==='国語'?1:nested.unit);
        assert.ok(!Object.values(nested.texts).some(t=>t.t===f.auto.label));
      }
      if(subject==='国語'){
        assert.equal(a.label.r,parent.r+1); assert.equal(a.rects[0].r,a.label.r+1);
        assert.equal(b.label.r,a.rects[0].r+a.rects[0].h);
      } else {
        assert.equal(a.label.c,parent.c+1); assert.equal(a.rects[0].c,a.label.c+1);
        assert.equal(b.label.c,a.rects[0].c+a.rects[0].w);
      }
    }
    const nestedWrap=await page.evaluate(()=>{
      const d=buildAutoDocument(parseAutoAnswers('1\n'+Array.from({length:20},(_,i)=>'1,('+(i+1)+'),ア,2,知').join('\n')),'国語');
      return {fields:d.fields,parents:d.decorations};
    });
    assert.ok(nestedWrap.parents.length>1);
    for(const p of nestedWrap.parents){
      const children=nestedWrap.fields.filter(f=>f.auto.questionId===p.id);
      assert.ok(children.length); assert.equal(children[0].label.r,p.r+1);
      assert.ok(children.every(f=>f.label.c===p.c && f.label.r>p.r));
    }
    pass('Parent question headings occupy separate cells, are shared by sibling subquestions, and repeat only after a wrap');
    const defaultBlank=await parse('1\n1,,2,思,解答欄のみ\n2,,2,思,解答欄のみ,2×3');
    assert.deepEqual(defaultBlank.map(r=>[r.w,r.h]),[[1,10],[2,3]]);
    const defaultRect=await page.evaluate(rows=>buildAutoDocument(rows,'国語').fields[0].rects[0],defaultBlank);
    assert.equal(defaultRect.w,1); assert.equal(defaultRect.h,20);
    pass('Answer-only fields default to width 1 and height 10 while explicit dimensions take precedence');
    for(const source of ['ア 0字','ア -1点','長い答え 2字','初終2字 あいうえ お','グラフ 40×40']){
      const result=await page.evaluate(source=>{try{buildAutoDocument(parseAutoAnswers(source),'国語');return null;}catch(e){return e.message;}},source);
      assert.ok(result,source);
    }
    pass('Invalid metadata, fixed-length overflow, asymmetric extract overflow and oversized graphs are rejected');
    await page.click('#btn-from-answers');
    await page.fill('#auto-source',sample); await page.click('#auto-parse');
    assert.equal(await page.locator('[data-row]').count(),6);
    await page.locator('[data-row="0"] [data-k="points"]').selectOption('7');
    await page.locator('[data-row="0"] [data-k="aspect"]').selectOption('思判表');
    await page.locator('[data-row="0"] [data-k="complete"]').check();
    await page.screenshot({path:path.join(output,'preview.png'),fullPage:true});
    await page.click('#auto-apply'); await page.locator('#app.on').waitFor();
    const generated=await page.evaluate(()=>JSON.parse(JSON.stringify(doc)));
    assert.equal(generated.fields.length,6); assert.equal(generated.fields[0].points,7);
    assert.equal(generated.fields[0].aspect,'思判表'); assert.equal(generated.fields[0].complete,true);
    assert.equal(Object.keys(generated.answers).length,4);
    assert.equal(generated.fields[2].type,5); assert.equal(generated.fields[2].exact,false);
    assert.ok(Object.values(generated.texts).some(t=>t.bold && t.span>1));
    pass('Preview edits generate all field types, answers, metadata and spanning section headings');
    const backup=await page.evaluate(()=>JSON.parse(docJson(true)));
    assert.deepEqual(backup.answers,{});
    assert.ok(backup.fields.every(f=>!Object.hasOwn(f.auto,'answer')));
    assert.ok(!JSON.stringify(backup).includes('光合成'));
    pass('Local backups still omit model answers when answer backups are disabled');
    await context.setOffline(true);
    await page.click('[data-tab="answer"]');
    await page.screenshot({path:path.join(output,'generated.png'),fullPage:true});
    const download=async (selector,name) => {
      const promise=page.waitForEvent('download'); await page.click(selector);
      const result=await promise; assert.equal(await result.failure(),null); await result.saveAs(path.join(output,name));
    };
    await download('#btn-xlsx','vertical.xlsx'); await download('#btn-save','vertical.json');
    pass('Generated Excel and work files export offline');
    await context.setOffline(false);
    const other=await context.newPage(); await other.goto(url);
    await other.locator('#file-open').setInputFiles(path.join(output,'vertical.json'));
    await other.locator('#app.on').waitFor();
    assert.deepEqual(await other.evaluate(()=>JSON.parse(JSON.stringify(doc))),generated);
    await other.click('#t-auto');
    assert.equal(await other.locator('[data-row="0"] [data-k="points"]').inputValue(),'7');
    assert.match(await other.locator('[data-row="1"] .auto-hint').innerText(),/欄の種類を推定/);
    pass('Save/reload retains editable generation metadata');
    await other.click('#auto-cancel'); await other.close();
    await page.click('#t-auto');
    await page.locator('[data-row="0"] [data-k="answer"]').fill('イ');
    await page.click('#auto-apply'); assert.ok(await page.locator('#auto-replace').isVisible());
    assert.equal(await page.evaluate(()=>doc.answers.f1),'ア');
    await page.check('#auto-replace'); await page.click('#auto-apply');
    assert.equal(await page.evaluate(()=>doc.answers.f1),'イ');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await page.evaluate(()=>JSON.parse(JSON.stringify(doc))),generated);
    await page.keyboard.press('Control+y'); assert.equal(await page.evaluate(()=>doc.answers.f1),'イ');
    pass('Regeneration is explicit and restores the entire document through undo/redo');
    await page.click('#t-auto'); await page.fill('#auto-source','大問一\n'+Array.from({length:200},(_,i)=>'('+ (i+1)+') ア 30字以内').join('\n')); await page.click('#auto-parse');
    await page.check('#auto-replace');
    const before=await page.evaluate(()=>JSON.stringify({doc,uid,history}));
    await page.click('#auto-apply'); assert.match(await page.locator('#auto-status').innerText(),/A4/);
    assert.equal(await page.evaluate(()=>JSON.stringify({doc,uid,history})),before);
    pass('A page-capacity failure is atomic and never drops questions');
    await page.click('#auto-cancel'); await page.click('#t-auto');
    await page.fill('#auto-source','大問一\n問一 太陽 3点 知識技能\n(1) This is a short English answer. 記述 3×2 5点 思考判断表現\n(2) アイウエ 4字 4点 知識技能\n大問二\n問一 初終2字 はじ おわ 4点 思考判断表現\n(1) 解答欄のみ 4×2 3点 思考判断表現');
    await page.click('#auto-parse'); await page.selectOption('#auto-subject','数学');
    await page.check('#auto-replace'); await page.click('#auto-apply'); await page.locator('.auto-modal').waitFor({state:'detached'});
    await download('#btn-xlsx','horizontal.xlsx'); await download('#btn-save','horizontal.json');
    const plans=await page.evaluate(()=>doc.fields.filter(f=>doc.answers[f.id]).map(f=>({fixed:f.fixedChars,answer:doc.answers[f.id],plan:answerPlan(doc,f,doc.answers[f.id])})));
    for(const p of plans) assert.ok(p.plan.need<=p.plan.room);
    const free=plans.find(p=>p.answer.startsWith('This')); assert.ok(free.plan.out.some(x=>x.ch.length>1));
    assert.ok(free.plan.out.every(x=>x.size>=6 && x.size<=11));
    const fixed=plans.find(p=>p.answer==='アイウエ'); assert.equal(fixed.plan.out.length,4); assert.ok(fixed.plan.out.every(x=>x.size===11));
    pass('Free text flows in merged runs while specified-length answers keep one character per box');
    await page.click('#t-auto');
    await page.click('#auto-add'); assert.equal(await page.locator('[data-row]').count(),6);
    await page.locator('[data-row="5"] [data-k="answer"]').fill('ウ');
    await page.locator('[data-row="5"] [data-k="group"]').selectOption('三');
    await page.check('#auto-replace'); await page.click('#auto-apply');
    assert.equal(await page.evaluate(()=>doc.fields.length),6);
    pass('Questions can be added after generation');
    await page.click('#t-auto'); await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.querySelector('.auto-modal .card').scrollWidth<=document.querySelector('.auto-modal .card').clientWidth));
    pass('Generation editor fits a phone-width screen');
    const kokugo=await context.newPage(); await kokugo.goto(url);
    await kokugo.click('#btn-from-answers'); await kokugo.click('#auto-example');
    assert.equal(await kokugo.locator('[data-row]').count(),9);
    assert.equal(await kokugo.locator('[data-row="8"] [data-k="kind"]').inputValue(),'blank');
    assert.equal(await kokugo.locator('[data-row="8"] [data-k="w"]').inputValue(),'1');
    assert.equal(await kokugo.locator('[data-row="8"] [data-k="h"]').inputValue(),'10');
    assert.equal(await kokugo.locator('[data-row="3"] [data-k="label"]').inputValue(),'問一');
    assert.equal(await kokugo.locator('[data-row="4"] [data-k="label"]').inputValue(),'問一');
    assert.equal(await kokugo.locator('[data-row="3"] [data-k="subLabel"]').inputValue(),'（１）');
    assert.equal(await kokugo.locator('[data-row="4"] [data-k="subLabel"]').inputValue(),'（２）');
    await kokugo.locator('[data-row="8"]').scrollIntoViewIfNeeded();
    await kokugo.screenshot({path:path.join(output,'sample-defaults.png'),fullPage:true});
    await kokugo.click('#auto-apply'); await kokugo.locator('#app.on').waitFor();
    assert.equal(await kokugo.evaluate(()=>doc.paper.subject),'国語');
    assert.equal(await kokugo.evaluate(()=>doc.fields.length),9);
    assert.ok(await kokugo.evaluate(()=>doc.fields.filter(f=>f.type===8).every(f=>f.rects.every(r=>doc.colw[r.c]===1.3))));
    const exampleLayout=await kokugo.evaluate(()=>{
      const [a,b]=doc.fields.slice(3,5), parent=doc.decorations.find(v=>v.id===a.auto.questionId);
      return {sameParent:a.auto.questionId===b.auto.questionId,parent:doc.texts[parent.c+','+parent.r].t,
        first:doc.texts[a.label.c+','+a.label.r].t,second:doc.texts[b.label.c+','+b.label.r].t,
        parentRow:parent.r,firstLabelRow:a.label.r,firstAnswer:a.rects[0],secondLabel:b.label,
        blank:doc.fields[8].rects[0]};
    });
    assert.equal(exampleLayout.sameParent,true); assert.equal(exampleLayout.parent,'問一');
    assert.equal(exampleLayout.first,'（１）'); assert.equal(exampleLayout.second,'（２）');
    assert.equal(exampleLayout.firstLabelRow,exampleLayout.parentRow+1);
    assert.equal(exampleLayout.firstAnswer.r,exampleLayout.firstLabelRow+1);
    assert.equal(exampleLayout.secondLabel.r,exampleLayout.firstAnswer.r+exampleLayout.firstAnswer.h);
    assert.equal(exampleLayout.blank.w,1); assert.equal(exampleLayout.blank.h,20);
    pass('The built-in example shows width 1 / height 10 and generates sibling (1) / (2) cells under one parent');
    await kokugo.click('[data-tab="answer"]');
    await kokugo.screenshot({path:path.join(output,'kokugo.png'),fullPage:true});
    for(const [selector,name] of [['#btn-xlsx','kokugo.xlsx'],['#btn-save','kokugo.json']]){
      const promise=kokugo.waitForEvent('download'); await kokugo.click(selector);
      const result=await promise; assert.equal(await result.failure(),null); await result.saveAs(path.join(output,name));
    }
    pass('Japanese sample includes symbols, words, kanji, constrained and free prose, complete answers and extracts');
    const cellPoint=async (c,r) => kokugo.evaluate(({c,r})=>{
      const rect=svg.getBoundingClientRect();
      return {x:rect.x+(geo.x0+colXmm(c)+colWmm(c)/2)/geo.pw*rect.width,
        y:rect.y+(geo.y0+(r+0.5)*RH)/geo.ph*rect.height};
    },{c,r});
    await kokugo.click('[data-tab="sheet"]');
    const first=await kokugo.evaluate(()=>doc.fields[0].rects[0]);
    const point=await cellPoint(first.c,first.r);
    await kokugo.mouse.click(point.x,point.y); await kokugo.keyboard.press('Space');
    await kokugo.locator('.modal [data-k="points"]').fill('4');
    await kokugo.locator('.modal [data-k="aspect"] [data-v="思判表"]').click();
    await kokugo.locator('.modal [data-act="ok"]').click();
    assert.equal(await kokugo.evaluate(()=>doc.fields[0].points),4);
    await kokugo.click('[data-tab="answer"]'); await kokugo.keyboard.press('Enter');
    await kokugo.locator('#cell-input').fill('イ'); await kokugo.keyboard.press('Enter');
    assert.equal(await kokugo.evaluate(()=>doc.answers.f1),'イ');
    await kokugo.click('[data-tab="draw"]');
    const from=await cellPoint(1,4),to=await cellPoint(3,6);
    await kokugo.mouse.move(from.x,from.y); await kokugo.mouse.down();
    await kokugo.mouse.move(to.x,to.y); await kokugo.mouse.up();
    assert.equal(await kokugo.evaluate(()=>doc.drawings.length),1);
    const edited=await kokugo.evaluate(()=>JSON.parse(JSON.stringify(doc)));
    await kokugo.click('[data-tab="sheet"]'); await kokugo.click('#t-auto');
    assert.equal(await kokugo.locator('[data-row="0"] [data-k="points"]').inputValue(),'4');
    assert.equal(await kokugo.locator('[data-row="0"] [data-k="answer"]').inputValue(),'イ');
    await kokugo.check('#auto-replace'); await kokugo.click('#auto-apply');
    await kokugo.keyboard.press('Control+z');
    assert.deepEqual(await kokugo.evaluate(()=>JSON.parse(JSON.stringify(doc))),edited);
    pass('Generated fields use existing scoring, answer entry and drawing tools; replacement undo restores all edits');
    const hierarchy=await context.newPage(); await hierarchy.goto(url); await hierarchy.click('#btn-from-answers');
    await hierarchy.fill('#auto-source','1\n問一(1),ア,2,知,解答欄のみ,3×2\n(2),イ,2,知\n2\n1,ウ,2,知,解答欄のみ,2×2');
    await hierarchy.click('#auto-parse');
    assert.equal(await hierarchy.locator('[data-row="0"] [data-k="label"]').inputValue(),'問一');
    assert.equal(await hierarchy.locator('[data-row="0"] [data-k="subLabel"]').inputValue(),'(1)');
    await hierarchy.locator('[data-row="1"] [data-k="label"]').selectOption('問二');
    assert.match(await hierarchy.locator('#auto-source').inputValue(),/2，\(2\)，イ/);
    await hierarchy.locator('[data-row="1"] [data-k="label"]').selectOption('問一');
    await hierarchy.locator('[data-row="0"] [data-k="subLabel"]').selectOption('(A)');
    assert.match(await hierarchy.locator('#auto-source').inputValue(),/1，\(A\)，ア/);
    await hierarchy.locator('[data-row="0"] [data-k="subLabel"]').selectOption('!custom');
    await hierarchy.locator('[data-row="0"] [data-k="subLabelCustom"]').fill('a');
    assert.match(await hierarchy.locator('#auto-source').inputValue(),/1，\(a\)，ア/);
    await hierarchy.locator('[data-row="0"] [data-k="subLabelCustom"]').fill('');
    await hierarchy.locator('[data-row="0"] [data-k="subLabelCustom"]').pressSequentially('(21)');
    assert.match(await hierarchy.locator('#auto-source').inputValue(),/1，\(21\)，ア/);
    await hierarchy.locator('[data-row="0"] [data-k="subLabel"]').selectOption('');
    assert.match(await hierarchy.locator('#auto-source').inputValue(),/1，ア/);
    await hierarchy.locator('[data-row="0"] [data-k="subLabel"]').selectOption('(1)');
    await hierarchy.click('#auto-parse');
    assert.equal(await hierarchy.locator('[data-row="1"] [data-k="subLabel"]').inputValue(),'(2)');
    await hierarchy.click('#auto-add');
    assert.equal(await hierarchy.locator('[data-row="3"] [data-k="label"]').inputValue(),'問二');
    await hierarchy.locator('[data-row="3"] [data-k="answer"]').fill('エ');
    await hierarchy.screenshot({path:path.join(output,'subquestion-editor.png'),fullPage:true});
    await hierarchy.click('#auto-apply'); await hierarchy.locator('#app.on').waitFor();
    assert.deepEqual(await hierarchy.evaluate(()=>doc.fields.map(f=>f.auto.label)),['問一(1)','問一(2)','問二','問一']);
    await hierarchy.click('[data-tab="answer"]');
    await hierarchy.screenshot({path:path.join(output,'section-spacing.png'),fullPage:true});
    for(const [selector,name] of [['#btn-xlsx','sections.xlsx'],['#btn-save','sections.json']]){
      const promise=hierarchy.waitForEvent('download'); await hierarchy.click(selector);
      const result=await promise; assert.equal(await result.failure(),null); await result.saveAs(path.join(output,name));
    }
    const loaded=await context.newPage(); await loaded.goto(url);
    await loaded.locator('#file-open').setInputFiles(path.join(output,'sections.json')); await loaded.locator('#app.on').waitFor();
    await loaded.click('#btn-answer-editor');
    assert.equal(await loaded.locator('[data-row="0"] [data-k="label"]').inputValue(),'問一');
    assert.equal(await loaded.locator('[data-row="0"] [data-k="subLabel"]').inputValue(),'(1)');
    assert.equal(await loaded.locator('[data-row="1"] [data-k="subLabel"]').inputValue(),'(2)');
    await loaded.setViewportSize({width:390,height:844});
    assert.ok(await loaded.evaluate(()=>document.querySelector('.auto-modal .card').scrollWidth<=document.querySelector('.auto-modal .card').clientWidth));
    pass('Sibling subquestions have independent numbering controls, preserve parent numbers, and survive generation and save/reload');
    await loaded.click('#auto-cancel'); await loaded.setViewportSize({width:1366,height:900});
    const parentCell=await loaded.evaluate(()=>{const p=doc.decorations.find(v=>v.questionHeading);return {c:p.c,r:p.r};});
    await loaded.evaluate(p=>{ ui.targets=[]; ui.sel=null; ui.extra=[]; ui.cur=p; render(); },parentCell);
    await loaded.keyboard.press('Enter'); await loaded.locator('#cell-input').fill('問三'); await loaded.keyboard.press('Enter');
    assert.equal(await loaded.evaluate(p=>doc.texts[p.c+','+p.r].t,parentCell),'問三');
    await loaded.click('#btn-answer-editor');
    assert.equal(await loaded.locator('[data-row="0"] [data-k="label"]').inputValue(),'問三');
    assert.equal(await loaded.locator('[data-row="1"] [data-k="label"]').inputValue(),'問三');
    assert.equal(await loaded.locator('[data-row="1"] [data-k="subLabel"]').inputValue(),'(2)');
    await loaded.check('#auto-replace'); await loaded.click('#auto-apply');
    assert.deepEqual(await loaded.evaluate(()=>doc.fields.slice(0,2).map(f=>f.auto.label)),['問三(1)','問三(2)']);
    pass('Editing the shared parent cell updates both siblings when reopening and regenerating');
    const blanks=await context.newPage(); await blanks.goto(url); await blanks.click('#btn-from-answers');
    await blanks.fill('#auto-source','1\n1,,2,思,解答欄のみ\n2,ア,2,知'); await blanks.click('#auto-parse');
    const blankCard=blanks.locator('[data-row="0"]');
    assert.equal(await blankCard.locator('[data-k="w"]').inputValue(),'1');
    assert.equal(await blankCard.locator('[data-k="h"]').inputValue(),'10');
    await blanks.locator('[data-row="1"] [data-k="kind"]').selectOption('blank');
    assert.equal(await blanks.locator('[data-row="1"] [data-k="w"]').inputValue(),'1');
    assert.equal(await blanks.locator('[data-row="1"] [data-k="h"]').inputValue(),'10');
    await blanks.locator('[data-row="1"] [data-k="h"]').fill('4');
    await blanks.locator('[data-row="1"] [data-k="w"]').fill('2');
    await blanks.click('#auto-apply'); await blanks.locator('#app.on').waitFor();
    assert.deepEqual(await blanks.evaluate(()=>doc.fields.map(f=>[f.rects[0].w,f.rects[0].h])),[[1,20],[2,8]]);
    for(const [selector,name] of [['#btn-xlsx','blanks.xlsx'],['#btn-save','blanks.json']]){
      const promise=blanks.waitForEvent('download'); await blanks.click(selector);
      const result=await promise; assert.equal(await result.failure(),null); await result.saveAs(path.join(output,name));
    }
    await blanks.click('#btn-answer-editor');
    assert.equal(await blankCard.locator('[data-k="h"]').inputValue(),'10');
    assert.equal(await blanks.locator('[data-row="1"] [data-k="w"]').inputValue(),'2');
    assert.equal(await blanks.locator('[data-row="1"] [data-k="h"]').inputValue(),'4');
    await blanks.click('#auto-cancel');
    await blanks.evaluate(()=>{const r=doc.fields[0].rects[0];ui.targets=[];ui.extra=[];ui.sel={c:r.c,r:r.r+6,w:1,h:2};insertCells();ui.sel=null;render();});
    await blanks.click('#btn-answer-editor');
    assert.equal(await blankCard.locator('[data-k="h"]').inputValue(),'11');
    pass('Answer-only size defaults are visible on parsing and type selection, remain editable, and survive regeneration');
    const excel=spawnSync('python3',[path.join(__dirname,'check-answer-generator-xlsx.py'),output],{encoding:'utf8'});
    if(excel.stdout) process.stdout.write(excel.stdout);
    if(excel.stderr) process.stderr.write(excel.stderr);
    assert.equal(excel.status,0,'Excel inspection failed');
    pass('All five browser-exported workbooks pass independent openpyxl inspection');
    const wrapping=await page.evaluate(()=>{
      const d=buildAutoDocument(parseAutoAnswers('大問一\n'+Array.from({length:20},(_,i)=>'('+(i+1)+') ア').join('\n')),'国語');
      return {fields:d.fields,texts:d.texts,grid:d.grid};
    });
    const firstColumn=wrapping.fields[0].label.c;
    const wrapped=wrapping.fields.find(f=>f.label.c<firstColumn);
    assert.ok(wrapped); assert.equal(wrapped.label.r,wrapping.fields[0].label.r);
    assert.equal(wrapped.auto.group,'一'); assert.equal(wrapped.auto.label,'(13)');
    const occupied=new Set();
    for(const f of wrapping.fields) for(const r of [...f.rects,f.label]){
      assert.ok(r.c>=0 && r.r>=0 && r.c+r.w<=wrapping.grid.cols && r.r+r.h<=wrapping.grid.rows);
      for(let c=r.c;c<r.c+r.w;c++) for(let y=r.r;y<r.r+r.h;y++){
        const key=c+','+y; assert.ok(!occupied.has(key)); occupied.add(key);
      }
    }
    pass('Consecutive questions wrap to the next column with section and numbering intact, without overlap');
    const records=await parse('＿＿＿＿＿＿\n１\n１，ア、２，知\n２，こんにちは、２、思\n２\n１，（１）、ウ、２、知\n＿＿＿＿＿＿');
    assert.deepEqual(records.map(r=>[r.group,r.label,r.answer,r.points,r.aspect]),[
      ['一','問一','ア',2,'知技'],['一','問二','こんにちは',2,'思判表'],['二','問一（１）','ウ',2,'知技']]);
    const quoted=await parse('1\n1,(A),"知、思",3,思\n2,"(1)",2,知\n3,"ア、2",4,知\n4,"一行目\n二行目",5,思');
    assert.equal(quoted[0].label,'問一(A)'); assert.equal(quoted[0].answer,'知、思');
    assert.equal(quoted[1].answer,'(1)'); assert.equal(quoted[2].answer,'ア、2');
    assert.equal(quoted[3].answer,'一行目\n二行目');
    const restoredRecords=await page.evaluate(rows=>parseAutoAnswers(autoRowsSource(rows)),quoted);
    assert.deepEqual(restoredRecords.map(r=>[r.label,r.answer,r.points,r.aspect]),quoted.map(r=>[r.label,r.answer,r.points,r.aspect]));
    pass('Requested comma format, standalone section numbers, alphabetic subquestions and quoted answers round-trip');
    for(const input of [
      '1\n1,（１）,ア,2,知\n（２）,イ,3,思',
      '1\n1（１）,ア,2,知\n（２）,イ,3,思',
      '1\n問一（１）,ア,2,知\n（２）,イ,3,思',
      '1\n問一,（１）,ア,2,知\n（２）,イ,3,思',
      '1\n問一\n（１）,ア,2,知\n（２）,イ,3,思'
    ]){
      assert.deepEqual((await parse(input)).map(r=>[r.label,r.answer,r.points,r.aspect]),[
        ['問一（１）','ア',2,'知技'],['問一（２）','イ',3,'思判表']]);
    }
    const changedParent=await parse('1\n1,(1),ア,2,知\n問二 ウ 2点 知\n(A),イ,3,思\n2\n(1),エ,4,知');
    assert.equal(changedParent[2].label,'問二(A)'); assert.equal(changedParent[2].answer,'イ');
    assert.equal(changedParent[3].label,'(1)'); assert.equal(changedParent[3].answer,'エ');
    const followingBare=await parse('1\n1,ア,2,知\nイ');
    assert.equal(followingBare[1].label,'(2)'); assert.equal(followingBare[1].answer,'イ');
    pass('Subquestion numbers are inferred from separate or attached parentheses and inherit the current parent without leaking across sections');
    const wide=await page.evaluate(()=>buildAutoDocument(parseAutoAnswers('1\n1,ア,2,知\n2,理由。,4,思,80字\n3,,4,思,解答欄のみ,2×3'),'国語').fields);
    assert.equal(wide[1].label.r,wide[0].label.r);
    assert.ok(Math.max(...wide[1].rects.map(r=>r.c+r.w))<=wide[0].label.c);
    assert.ok(wide[1].rects.every(r=>r.r===wide[1].label.r+1));
    assert.equal(wide[2].label.r,wide[0].label.r);
    assert.ok(wide[2].rects[0].c+wide[2].rects[0].w<=Math.min(...wide[1].rects.map(r=>r.c)));
    pass('Both multi-column character fields and wide rectangles start at the top of a fresh column');
    const easy=await context.newPage();
    await easy.addInitScript(()=>localStorage.setItem('answer-sheet-maker/options',JSON.stringify({autoInput:{points:1000,kind:'chars',n:1000,group:'十',numStyle:'M'}})));
    await easy.goto(url); await easy.click('#btn-from-answers');
    assert.equal(await easy.locator('#auto-next-group,#auto-save-defaults').count(),0);
    await easy.fill('#auto-source','１\n１，ア、２，知\n２，こんにちは、２、思\n２\n１，（１）、ウ、２、知');
    await easy.click('#auto-parse');
    assert.equal(await easy.locator('[data-row]').count(),3);
    assert.equal(await easy.locator('[data-row="0"] [data-k="kind"]').inputValue(),'mark');
    assert.equal(await easy.locator('[data-row="1"] [data-k="kind"]').inputValue(),'word');
    assert.equal(await easy.locator('[data-k="kind"] option[value="auto"]').count(),0);
    assert.equal(await easy.locator('[data-row="0"] [data-k="points"]').inputValue(),'2');
    pass('The editor shows actual inferred kinds, removes registration and memory buttons, and ignores old hidden defaults');
    await easy.locator('[data-row="0"] [data-check]').check(); await easy.locator('[data-row="2"] [data-check]').check();
    assert.equal(await easy.locator('#auto-bulk-scope').inputValue(),'selected');
    await easy.selectOption('#auto-bulk-points','5'); await easy.click('#auto-bulk-apply');
    assert.equal(await easy.locator('[data-row="0"] [data-k="points"]').inputValue(),'5');
    assert.equal(await easy.locator('[data-row="1"] [data-k="points"]').inputValue(),'2');
    assert.equal(await easy.locator('[data-row="2"] [data-k="points"]').inputValue(),'5');
    assert.equal(await easy.locator('[data-row="0"] [data-k="aspect"]').inputValue(),'知技');
    await easy.selectOption('#auto-bulk-scope','group:一'); await easy.selectOption('#auto-bulk-points','');
    await easy.selectOption('#auto-bulk-aspect','思判表'); await easy.click('#auto-bulk-apply');
    assert.equal(await easy.locator('[data-row="0"] [data-k="aspect"]').inputValue(),'思判表');
    assert.equal(await easy.locator('[data-row="2"] [data-k="aspect"]').inputValue(),'知技');
    assert.equal(await easy.locator('[data-row="0"] [data-k="points"]').inputValue(),'5');
    await easy.selectOption('#auto-bulk-scope','all'); await easy.selectOption('#auto-bulk-points','3');
    await easy.selectOption('#auto-bulk-aspect','知技'); await easy.click('#auto-bulk-apply');
    for(let i=0;i<3;i++) assert.equal(await easy.locator('[data-row="'+i+'"] [data-k="points"]').inputValue(),'3');
    pass('Scores and aspects can be changed independently for checked questions, a section or all questions');
    await easy.locator('[data-row="0"] [data-k="kind"]').selectOption('chars');
    await easy.locator('[data-row="0"] [data-k="n"]').fill('10'); await easy.locator('[data-row="0"] [data-k="eight"]').check();
    await easy.locator('[data-row="0"] [data-k="points"]').selectOption('custom');
    await easy.locator('[data-row="0"] [data-k="pointsCustom"]').fill('7');
    assert.match(await easy.locator('#auto-source').inputValue(),/10字/);
    await easy.click('#auto-parse');
    assert.equal(await easy.locator('[data-row="0"] [data-k="kind"]').inputValue(),'chars');
    assert.equal(await easy.locator('[data-row="0"] [data-k="points"]').inputValue(),'7');
    await easy.screenshot({path:path.join(output,'editor-revised.png'),fullPage:true});
    await easy.click('#auto-apply'); await easy.locator('#app.on').waitFor();
    assert.equal(await easy.evaluate(()=>doc.fields.length),3);
    for(const tab of ['answer','draw','sheet']){
      await easy.click('[data-tab="'+tab+'"]'); assert.ok(await easy.locator('#btn-answer-editor').isVisible());
      await easy.click('#btn-answer-editor'); assert.equal(await easy.locator('[data-row]').count(),3);
      assert.equal(await easy.locator('[data-row="0"] [data-k="points"]').inputValue(),'7');
      assert.match(await easy.locator('#auto-source').inputValue(),/10字/);
      await easy.click('#auto-cancel');
    }
    pass('The top-bar entry reopens the current input and row editor from every tab');
    const blankPoint=await easy.evaluate(()=>{const r=svg.getBoundingClientRect();return {x:r.x+(geo.x0+colXmm(2)+colWmm(2)/2)/geo.pw*r.width,y:r.y+(geo.y0+4.5*RH)/geo.ph*r.height};});
    await easy.mouse.click(blankPoint.x,blankPoint.y); await easy.keyboard.press('2');
    assert.equal(await easy.evaluate(()=>doc.fields.length),4);
    await easy.click('#btn-answer-editor'); assert.equal(await easy.locator('[data-row]').count(),4);
    await easy.click('#auto-cancel');
    pass('Manually added fields remain visible when reopening the generation editor');
    assert.deepEqual(failures,[]); assert.deepEqual(external,[]);
    pass('No JavaScript errors or external requests');
    console.log(count+' checks passed'); console.log('Artifacts: '+output);
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
