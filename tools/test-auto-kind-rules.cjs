const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
(async () => {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(__dirname, '../answer-sheet-maker.html'))); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || '/usr/bin/chromium', headless: true });
  try {
    const page = await browser.newPage(); await page.goto('http://127.0.0.1:' + server.address().port);
    const checks = await page.evaluate(() => {
      const parse = (answer, subject, extra = '') => parseAutoAnswers('1\n1￥' + answer + '￥2￥知' + extra, { subject })[0];
      const cases = [['ア','mark',1,false],['7','mark',1,false],['あいうえおかきくけ','chars',9,false],['あいうえおかきくけこ','chars',10,true],['太陽','chars',2,false],['はじめ～おわり','extract',3,false],['5～10','extract',2,false],['x^2','formula',3,false],['1/2','formula',3,false],['plastic bags','chars',12,true],['H₂O','chars',3,false]];
      let count = 0;
      for (const subject of ['国語','数学','英語','理科','社会']) for (const [answer,kind,n,eight] of cases) {
        const row = parse(answer, subject);
        if (row.kind !== kind || row.n !== n || row.eight !== eight) throw new Error(JSON.stringify({ subject, answer, row, kind, n, eight }));
        count++;
      }
      const explicit = [parse('abcdefghij','英語','￥10字￥8割ラインなし'),parse('太陽','国語','￥語句'),parse('a/b','英語','￥記述')];
      return { count, explicit: explicit.map(r => [r.kind,r.eight]) };
    });
    assert.equal(checks.count, 55);
    assert.deepEqual(checks.explicit, [['chars',false],['word',false],['essay',false]]);
    await page.click('#btn-from-answers'); await page.fill('#creation-title','自動選択'); await page.click('#creation-next');
    await page.fill('#auto-source','1\n1￥太陽￥2￥知'); await page.click('#auto-parse');
    const card = page.locator('[data-row="0"]');
    assert.equal(await card.locator('[data-k="kind"]').inputValue(),'chars');
    await card.locator('[data-k="answer"]').fill('あいうえおかきくけこ');
    assert.equal(await card.locator('[data-k="eight"]').isChecked(),true);
    await card.locator('[data-k="eight"]').uncheck();
    await card.locator('[data-k="answer"]').fill('あいうえおかきくけこさ');
    assert.equal(await card.locator('[data-k="eight"]').isChecked(),false);
    await card.locator('[data-k="answer"]').fill('a^2');
    assert.equal(await card.locator('[data-k="kind"]').inputValue(),'formula');
    await card.locator('[data-k="kind"]').selectOption('word');
    await card.locator('[data-k="answer"]').fill('a/b');
    assert.equal(await card.locator('[data-k="kind"]').inputValue(),'word');
    console.log('PASS: 55 automatic cases across five subjects; 9/10-character boundary, waves, formulas, explicit annotations and manual overrides');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
