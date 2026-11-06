const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'answer-simple-'));
 const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1366,height:900},acceptDownloads:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
  const url='http://127.0.0.1:'+server.address().port;
  await page.goto(url);
  assert.equal(await page.locator('#blank-row').isVisible(),false);
  await page.screenshot({path:path.join(out,'01-start.png')});
  await page.click('#btn-start-help');assert.equal(await page.locator('.quick-instructions li').count(),4);
  await page.click('#help-tab-advanced');assert.equal(await page.locator('#help-panel-advanced').isVisible(),true);
  assert.equal(await page.locator('.help-modal').textContent().then(t=>t.includes('${')),false);
  await page.keyboard.press('Escape');
  await page.click('#start-tab-other');assert.equal(await page.locator('#blank-row').isVisible(),true);
  await page.locator('#start-tab-other').press('ArrowLeft');assert.equal(await page.locator('#btn-from-answers').isVisible(),true);
  await page.click('#btn-from-answers');await page.fill('#creation-grade','二');await page.fill('#creation-title','テスト');await page.click('#creation-next');
  assert.deepEqual(errors,[]);
  assert.equal(await page.locator('#auto-range-add').isVisible(),false);
  assert.equal(await page.locator('#auto-source').isVisible(),false);
  assert.equal(await page.locator('#auto-tab-review').isDisabled(),true);
  await page.screenshot({path:path.join(out,'02-method.png')});
  await page.click('#auto-method-table');
  await page.fill('[data-input-cell="0,2"]','太陽');
  await page.click('#answer-input-add');await page.fill('[data-input-cell="1,2"]','ア');
  await page.screenshot({path:path.join(out,'03-table.png')});
  await page.click('#answer-input-save');
  assert.equal(await page.locator('[data-row]').count(),2);
  assert.equal(await page.locator('#auto-bulk-kind').isVisible(),false);
  await page.screenshot({path:path.join(out,'04-review.png')});
  await page.click('#review-tab-settings');assert.equal(await page.locator('#auto-bulk-kind').isVisible(),true);
  await page.selectOption('#auto-bulk-kind','essay');await page.fill('#auto-bulk-width','2');await page.fill('#auto-bulk-height','3');await page.click('#auto-bulk-apply');
  await page.click('#review-tab-list');assert.equal(await page.locator('[data-row="0"] [data-k="kind"]').inputValue(),'essay');
  await page.click('#auto-apply');assert.equal(await page.evaluate(()=>doc.paper.title),'テスト');assert.match(await page.evaluate(()=>doc.paper.nameLabel),/^二年/);
  for(const title of ['二 テスト','二年 テスト','独自のタイトル']){await page.evaluate(title=>{doc.paper.title=title;loadWork(docJson(false));},title);assert.equal(await page.evaluate(()=>doc.paper.title),title==='独自のタイトル'?title:'テスト');}await page.evaluate(()=>{doc.paper.title='テスト';render();});
  assert.equal(await page.locator('#field-tools').isVisible(),false);
  assert.equal(await page.locator('#tab-draw').isVisible(),false);
  assert.equal(await page.locator('#btn-xlsx').isVisible(),true);
  assert.equal(await page.locator('#btn-answer-editor').innerText(),'問題・答え・解答欄を編集');
  await page.waitForFunction(()=>document.querySelector('#backup-status').textContent.includes('一時保存済み'));
  assert.equal(await page.locator('#save-indicator').isVisible(),true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(BK_KEY)).answers[doc.fields[0].id]),'太陽');
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new Error('storage full');};backup();Storage.prototype.setItem=original;});
  assert.match(await page.locator('#backup-status').innerText(),/一時保存できません/);
  await page.evaluate(()=>backup());
  assert.match(await page.locator('#backup-status').innerText(),/一時保存済み/);

  const before=await page.evaluate(()=>JSON.stringify(doc));
  await page.locator('#workspace-basic').focus();await page.keyboard.press('Digit1');await page.keyboard.press('Backspace');
  assert.equal(await page.evaluate(()=>JSON.stringify(doc)),before,'preview keyboard must not change the sheet');
  assert.equal(await page.locator('#workbar').isVisible(),true);await page.click('#btn-zi');assert.equal(await page.evaluate(()=>ui.zoom),1.25);await page.click('#btn-zo');assert.equal(await page.evaluate(()=>ui.zoom),1);await page.click('#btn-zfit');assert.equal(await page.evaluate(()=>ui.zoom),0);assert.equal(await page.locator('#basic-guidance').isVisible(),false);assert.equal(await page.locator('#app-footer').count(),0);await page.click('#tab-answer');assert.equal(await page.evaluate(()=>ui.tab),'answer');await page.click('#tab-sheet');assert.equal(await page.evaluate(()=>ui.tab),'sheet');await page.click('#tab-answer');
  await page.screenshot({path:path.join(out,'05-sheet.png')});
  const download=page.waitForEvent('download');await page.click('#btn-xlsx');await(await download).saveAs(path.join(out,'answers.xlsx'));
  const excel=spawnSync('python3',['-c',`import openpyxl,sys
b=openpyxl.load_workbook(sys.argv[1]);assert len(b.sheetnames)==2,b.sheetnames
text=lambda s: ''.join(str(c.value or '') for row in s for c in row)
a=text(b.worksheets[1]);s=text(b.worksheets[0]);assert all(c in a for c in '太陽ア'),a
assert '太陽' not in s and 'ア' not in s,s
print('PASS: independent Excel inspection; both sheets and both answers retained')`,path.join(out,'answers.xlsx')],{encoding:'utf8'});
  process.stdout.write(excel.stdout);process.stderr.write(excel.stderr);assert.equal(excel.status,0);
  await page.click('#workspace-detail');await page.click('#tab-sheet');assert.equal(await page.locator('#field-tools').isVisible(),true);
  await page.click('#side-tab-paper');assert.equal(await page.locator('#content-scale').isVisible(),true);
  await page.click('#tab-draw');assert.equal(await page.locator('#draw-tools').isVisible(),true);
  await page.click('#workspace-basic');assert.equal(await page.locator('#tab-sheet').getAttribute('aria-selected'),'true');
  assert.equal(await page.evaluate(()=>JSON.stringify(doc)),before,'switching modes must preserve the document');
  // Multi-page navigation remains available with the editing tools hidden.
  await page.evaluate(()=>{doc.bookPages=[pageCopy(doc),pageCopy(doc)];doc.pageIndex=0;render();});
  await page.click('#workspace-detail');assert.equal(await page.locator('#review-page-select').isVisible(),true);await page.selectOption('#review-page-select','1');assert.equal(await page.evaluate(()=>doc.pageIndex),1);
  await page.click('#btn-answer-editor');assert.equal(await page.locator('[data-row]').count(),4);await page.click('#auto-cancel');
  await page.click('#more-menu summary');const save=page.waitForEvent('download');await page.click('#btn-save');await(await save).saveAs(path.join(out,'work.json'));
  const saved=JSON.parse(fs.readFileSync(path.join(out,'work.json'),'utf8'));assert.equal(saved.bookPages.length,2);
  await page.setInputFiles('#file-open',path.join(out,'work.json'));await page.locator('#field-tools').waitFor({state:'hidden'});assert.equal(await page.locator('#field-tools').isVisible(),false);
  assert.deepEqual(await page.evaluate(()=>Object.values(doc.answers)),['太陽','ア']);
  // Every viewport keeps an obvious next action and allows scrolling long tables.
  for(const width of [390,768,1366]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'workspace overflow '+width);
   await page.screenshot({path:path.join(out,'workspace-'+width+'.png')});
  }
  await page.goto(url);await page.click('#btn-from-answers');await page.fill('#creation-title','一括入力');await page.click('#creation-next');
  await page.click('#auto-input-bulk');
  const sample=await page.locator('#auto-bulk-example pre').innerText();
  assert.equal(sample,'1\n1￥ア\n2￥太陽');
  await page.fill('#auto-source',sample);
  await page.click('#auto-method-back');await page.click('#auto-method-table');
  assert.equal(await page.locator('[data-input-cell="0,2"]').inputValue(),'ア');assert.equal(await page.locator('[data-input-cell="1,2"]').inputValue(),'太陽');
  await page.click('#answer-input-cancel');await page.click('#auto-input-bulk');assert.equal(await page.locator('#auto-source').inputValue(),sample);
  await page.click('#bulk-tab-help');assert.equal(await page.locator('#auto-answers-only').isVisible(),true);
  await page.click('#bulk-tab-write');assert.equal(await page.locator('#auto-source').inputValue(),sample);
  page.once('dialog',d=>d.dismiss());await page.click('#auto-example');assert.equal(await page.locator('#auto-source').inputValue(),sample);
  for(const width of [390,768,1366]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.locator('.auto-modal .card').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'modal overflow '+width);
   const b=await page.locator('#auto-parse').boundingBox();assert.ok(b.y>=0 && b.y+b.height<=844,'parse button in viewport '+width);
   await page.screenshot({path:path.join(out,'bulk-'+width+'.png')});
  }
  await page.click('#auto-parse');await page.click('#auto-back');assert.equal(await page.locator('#auto-source').inputValue(),sample);
  await page.click('#auto-parse');await page.click('#auto-apply');assert.deepEqual(await page.evaluate(()=>Object.values(doc.answers)),['ア','太陽']);
  await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:path.join(out,'dark.png')});
  await page.goto(url);await page.click('#start-tab-other');await page.click('[data-blank="数学"]');await page.fill('#creation-title','手作業');await page.click('#creation-next');
  assert.equal(await page.locator('#field-tools').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: novice table → review → Excel flow; bulk input; advanced tabs; keyboard; page navigation; mobile; dark theme');console.log('Artifacts: '+out);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
