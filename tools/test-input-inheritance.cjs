const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH || '/usr/bin/chromium',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1366,height:950}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  const cell=(r,c)=>page.locator('[data-input-cell="'+r+','+c+'"]');
  const open=()=>page.evaluate(()=>openAnswerInputTable([],{subject:'数学',points:2,aspect:'知技',numStyle:'digit'},rows=>window.inputResult=rows));
  await open();
  const tsv='1\t1\t太陽\t3\t思\t語句\n\t\t月\t\t\t\n2\t\t海\t0\t知\t自動\n\t\t\t\t\t';
  await cell(0,0).evaluate((node,text)=>{const dt=new DataTransfer();dt.setData('text/plain',text);node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));},tsv);
  assert.equal(await cell(1,0).inputValue(),'');assert.match(await cell(1,0).getAttribute('placeholder'),/1/);
  assert.match(await cell(1,3).getAttribute('placeholder'),/3/);
  assert.match(await cell(1,4).locator('option:checked').innerText(),/思考/);
  assert.match(await cell(1,5).locator('option:checked').innerText(),/語句/);
  assert.match(await cell(2,5).locator('option[value=""]').innerText(),/語句/);
  assert.match(await cell(2,1).getAttribute('placeholder'),/1/);assert.match(await cell(3,1).getAttribute('placeholder'),/2/);
  await cell(0,0).fill('4');await cell(0,3).fill('5');
  assert.match(await cell(1,0).getAttribute('placeholder'),/4/);assert.match(await cell(1,3).getAttribute('placeholder'),/5/);
  await page.click('#answer-input-save');
  let result=await page.evaluate(()=>window.inputResult);
  assert.deepEqual(result.map(r=>[r.group,r.label,r.answer,r.points,r.aspect,r.kind]),[
   ['4','問1','太陽',5,'思判表','word'],['4','問2','月',5,'思判表','word'],
   ['2','問1','海',0,'知技','mark'],['2','問2','',0,'知技','blank']
  ]);
  console.log('PASS: Excel blanks inherit metadata, live hints follow edits, numbering resets by section, zero scores and blank answers survive');
  await open();await cell(0,1).fill('(7)');await cell(0,2).fill('山');await cell(0,3).fill('4');
  await page.click('#answer-input-add');await cell(1,2).fill('川');
  assert.match(await cell(1,1).getAttribute('placeholder'),/\(8\)/);assert.equal(await cell(1,0).inputValue(),'');
  await page.click('#answer-input-add');await cell(2,0).fill('2');await cell(2,2).fill('海');
  await page.click('#answer-input-add');await cell(3,2).fill('空');
  await page.click('[data-delete-input="1"]');
  assert.match(await cell(1,1).getAttribute('placeholder'),/1/);assert.match(await cell(2,1).getAttribute('placeholder'),/2/);
  await page.click('#answer-input-save');result=await page.evaluate(()=>window.inputResult);
  assert.deepEqual(result.map(r=>[r.group,r.label,r.answer,r.points]),[['1','(7)','山',4],['2','問1','海',4],['2','問2','空',4]]);
  console.log('PASS: row addition/deletion recalculates inheritance and sequential numbers without copying answers');
  await open();for(const c of [0,1,3])await cell(0,c).fill('');await cell(0,4).selectOption('');await cell(0,5).selectOption('');
  await cell(0,2).fill('太陽');await cell(0,3).fill('abc');await page.click('#answer-input-save');assert.match(await page.locator('#answer-input-status').innerText(),/点数/);
  await cell(0,3).fill('');await page.click('#answer-input-save');result=await page.evaluate(()=>window.inputResult);
  assert.deepEqual([result[0].group,result[0].label,result[0].points,result[0].aspect],['1','問1',2,'知技']);
  console.log('PASS: blank first row uses defaults; invalid scores remain editable');
  await page.click('#btn-from-answers');await page.fill('#creation-title','入力省略');await page.click('#creation-next');
  await page.selectOption('#auto-subject','数学');await page.click('#auto-input-table');await cell(0,2).fill('太陽');
  await page.click('#answer-input-add');await cell(1,2).fill('月');await page.click('#answer-input-save');
  assert.equal(await page.locator('[data-row]').count(),2);await page.click('#auto-apply');
  assert.deepEqual(await page.evaluate(()=>Object.values(doc.answers)),['太陽','月']);
  assert.equal(await page.evaluate(()=>new Set(doc.fields.map(f=>f.auto.group)).size),1);
  assert.deepEqual(errors,[]);console.log('PASS: input table → review → generated sheet keeps inherited sections and distinct answers');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
