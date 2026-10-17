// Run: node tools/test-help.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html'));
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'answer-help-'));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.click('#btn-start-help');
  assert.equal(await page.locator('#help-panel-quick').isVisible(),true);
  await page.keyboard.press('Escape');
  await page.screenshot({path:path.join(output,'start.png')});
  await page.click('#btn-from-answers');await page.fill('#creation-title','取説の練習');await page.click('#creation-next');
  await page.screenshot({path:path.join(output,'input-mode.png')});
  await page.fill('#auto-source','編集中の答え');await page.click('#auto-help');
  assert.equal(await page.locator('#help-tab-format').getAttribute('aria-selected'),'true');
  const example=await page.locator('#help-basic-example').innerText();assert.ok(example.includes('\n'));
  await page.screenshot({path:path.join(output,'format.png')});
  await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#help-panel-quick').isVisible(),true);
  assert.equal(await page.locator('#help-panel-advanced').isVisible(),false);
  await page.screenshot({path:path.join(output,'quick.png')});
  await page.locator('[data-help-go="format"]').click();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#help-panel-advanced').isVisible(),true);
  await page.locator('#help-panel-advanced summary').first().click();
  assert.equal(await page.locator('.help-modal').isVisible(),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#auto-source').inputValue(),'編集中の答え');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'auto-help');
  await page.fill('#auto-source',example);await page.click('#auto-parse');
  assert.equal(await page.locator('[data-row]').count(),3);await page.click('#auto-apply');
  const result=await page.evaluate(()=>({answers:Object.values(doc.answers).filter(Boolean),title:doc.paper.title}));
  assert.equal(result.title,'取説の練習');for(const answer of ['ア','太陽','相手の気持ちを考えたから。']) assert.ok(result.answers.includes(answer));
  assert.equal(await page.locator('#more-menu #btn-help').count(),0);
  assert.equal(await page.locator('#btn-help').isVisible(),true);
  await page.click('#btn-help');assert.equal(await page.locator('#help-panel-quick').isVisible(),true);
  await page.locator('.help-modal [data-act="ok"]').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'help-tab-quick');
  for(const width of [390,768]){
   await page.setViewportSize({width,height:844});
   for(const tab of ['quick','format','advanced']){
    await page.click('#help-tab-'+tab);
    assert.ok(await page.locator('.help-modal .card').evaluate(n=>n.scrollWidth<=n.clientWidth));
    await page.screenshot({path:path.join(output,tab+'-'+width+'.png')});
   }
  }
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{doc=newDoc('数学');startApp();ui.tab='sheet';ui.cur={c:5,r:20};document.activeElement.blur();render();});
  const before=await page.evaluate(()=>doc.fields.length);
  const key=await page.locator('[data-field="2"]').getAttribute('aria-keyshortcuts');
  await page.keyboard.press(key);
  assert.equal(await page.evaluate(()=>doc.fields.length),before+1);
  assert.equal(await page.evaluate(()=>doc.fields.at(-1).type),2);
  assert.deepEqual(errors,[]);console.log('PASS: Help tabs, keyboard, nested dialog, input preservation, real example generation, and mobile layout');console.log(output);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
