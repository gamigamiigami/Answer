const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, '../answer-sheet-maker.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || '/usr/bin/chromium', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.click('#btn-from-answers'); await page.fill('#creation-title', '記述統合'); await page.click('#creation-next');
    await page.selectOption('#auto-subject', '英語');
    await page.click('#auto-input-bulk');await page.fill('#auto-source', '1\n1,,2,思,解答欄のみ'); await page.click('#auto-parse');
    const card = page.locator('[data-row="0"]');
    assert.equal(await card.locator('[data-k="w"]').inputValue(),'10');
    assert.equal(await card.locator('[data-k="h"]').inputValue(),'1');
    for (const subject of ['国語', '英語', '数学', '理科', '社会']) {
      await page.selectOption('#auto-subject', subject);
      const expected = subject === '国語' ? ['mark', 'word', 'chars', 'extract', 'essay', 'kanji', 'kanbun'] : ['mark', 'word', 'formula', 'chars', 'essay', 'graph', 'table'];
      assert.deepEqual(await card.locator('[data-k="kind"] > option').evaluateAll(nodes => nodes.map(n => n.value)), expected);
      assert.deepEqual(await page.locator('#auto-bulk-kind > option').evaluateAll(nodes => nodes.slice(1).map(n => n.value)), expected);
      assert.equal(await card.locator('optgroup').getAttribute('label'), 'その他');
    }
    await page.selectOption('#auto-subject', '英語');
    assert.equal(await card.locator('[data-k="kind"]').inputValue(), 'essay');
    assert.equal(await card.locator('option[value="blank"], option[value="sentence"], option[value="working"]').count(), 0);
    assert.equal(await card.locator('[data-k="w"]').isVisible(), true);
    await card.locator('[data-k="w"]').fill('6'); await card.locator('[data-k="h"]').fill('3');
    await card.locator('[data-k="answer"]').fill('This is a pen.');
    assert.equal(await card.locator('[data-k="w"]').inputValue(), '6');
    assert.equal(await card.locator('[data-k="h"]').inputValue(), '3');
    await card.locator('[data-k="answer"]').fill(''); await page.click('#auto-apply');
    await page.locator('.auto-modal').waitFor({ state: 'detached' });
    const rect = await page.evaluate(() => doc.fields[0].rects[0]);
    assert.equal(rect.w, 6); assert.equal(rect.h, 6);
    const work = await page.evaluate(() => docJson(false));
    await page.evaluate(work => loadWork(work), work); await page.click('#btn-answer-editor');
    assert.equal(await card.locator('[data-k="w"]').inputValue(), '6');
    assert.equal(await card.locator('[data-k="h"]').inputValue(), '3');
    console.log('PASS: blank/prose share one choice; visible dimensions survive answer edits, generation, save/load and reopening');
    const defaults=await page.evaluate(()=>['数学','英語','理科','社会','その他'].map(subject=>{const d=buildAutoDocument(parseAutoAnswers('1\n1,,2,思,解答欄のみ',{subject}),subject);return [d.fields[0].rects[0].w,d.fields[0].rects[0].h];}));
    assert.deepEqual(defaults,Array(5).fill([10,2]));
    const result = await page.evaluate(() => {
      const base = { ...parseAutoAnswers('1\n1,太陽,2,知')[0], kindAuto: false };
      const shapes = answer => buildAutoDocument([{ ...base, kind: 'essay', answer, w: 6, h: 3 }], '英語').fields[0].rects;
      const word = answer => buildAutoDocument([{ ...base, kind: 'word', answer, w: 0, h: 0 }], '国語').fields[0].rects;
      const old = ['sentence', 'working', 'blank', 'essay'].map(kind => buildAutoDocument([{ ...base, kind, answer: '', w: 7, h: 5 }], '英語').fields[0].rects);
      return { fixed: JSON.stringify(shapes('A')) === JSON.stringify(shapes('This is a pen.')), automatic: JSON.stringify(word('太陽')) !== JSON.stringify(word('光合成')), old: old.every(r => r[0].w === 7 && r[0].h === 10), formula: AUTO_KIND_CHOICES.some(([k]) => k === 'formula') };
    });
    assert.deepEqual(result, { fixed: true, automatic: true, old: true, formula: true });
    assert.deepEqual(errors, []);
    console.log('PASS: prose size stays fixed, words resize automatically, legacy forms retain explicit dimensions, formula remains separate');
    await card.locator('[data-k="kind"]').selectOption('chars');
    assert.equal(await card.locator('[data-k="n"]').isVisible(), true);
    assert.equal(await card.locator('[data-k="eight"]').isVisible(), true);
    await page.click('#auto-tab-input'); await page.click('#auto-method-table');
    assert.deepEqual(await page.locator('[data-input-cell="0,5"] > option').evaluateAll(nodes => nodes.slice(2).map(n => n.value)), ['mark', 'word', 'formula', 'chars', 'essay', 'graph', 'table']);
    await page.click('#answer-input-cancel');
    console.log('PASS: subject-specific order matches in row and bulk menus; character count and 80% line toggle are visible together');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
