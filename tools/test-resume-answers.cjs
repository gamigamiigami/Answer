const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'../answer-sheet-maker.html')));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH || '/usr/bin/chromium',headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.clock.install();const url='http://127.0.0.1:'+server.address().port;await page.goto(url);
  assert.equal(await page.evaluate(()=>options.backupAnswers),true);
  await page.evaluate(()=>localStorage.setItem(OPT_KEY,JSON.stringify({backupAnswers:false,clearOnExit:false,uiLarge:true})));
  await page.reload();assert.deepEqual(await page.evaluate(()=>[options.backupAnswers,options.uiLarge]),[true,true]);
  const expected=await page.evaluate(()=>{
   const pages=[buildAutoDocument(parseAutoAnswers('1\n1￥太陽￥2￥知\n2￥ア\tイ￥2￥知￥表￥2×1',{subject:'数学'}),'数学'),buildAutoDocument(parseAutoAnswers('1\n1￥y=x^2￥2￥知￥グラフ￥4×4',{subject:'数学'}),'数学')];
   pages[0].drawings.push({k:'line',x1:1,y1:12,x2:2,y2:14,w:'thin',answerOnly:true});
   pages[1].images=[{id:'resume-image',x:1,y:30,w:5,h:5,answerOnly:true,data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}];
   replacePageData(pages[1],pages,1);startApp();ui.dirty=true;
   return allPages().map(p=>({answers:p.answers,graphs:p.answerGraphs,images:p.images || [],drawings:p.drawings}));
  });
  await page.clock.fastForward(21000);
  assert.ok(await page.evaluate(()=>localStorage.getItem(BK_KEY)));
  await page.reload();await page.click('#btn-resume');
  const actual=()=>page.evaluate(()=>allPages().map(p=>({answers:p.answers,graphs:p.answerGraphs,images:p.images || [],drawings:p.drawings})));
  assert.deepEqual(await actual(),expected);
  console.log('PASS: old paper-only preference migrates; timed backup and resume restore all-page answers, tables, graphs, images and drawings');
  await page.evaluate(()=>{doc.answers[doc.fields[0].id]='y=x+1';ui.dirty=true;});
  await page.reload();await page.click('#btn-resume');assert.equal(await page.evaluate(()=>doc.answers[doc.fields[0].id]),'y=x+1');
  console.log('PASS: closing/reloading before the next timer preserves the latest model answer');
  await page.evaluate(()=>{options.backupAnswers=false;saveOptions();backup();});
  await page.reload();assert.equal(await page.evaluate(()=>options.backupAnswers),false);await page.click('#btn-resume');
  assert.ok((await actual()).every(p=>Object.keys(p.answers).length===0 && Object.keys(p.graphs).length===0 && p.images.length===0 && p.drawings.length===0));
  console.log('PASS: a new explicit paper-only preference remains respected');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
