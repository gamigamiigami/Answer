const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.resolve(__dirname, '../answer-sheet-maker.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || '/usr/bin/chromium', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== url) external.push(r.url()); });
    await page.goto(url);
    await page.click('#btn-from-answers');
    await page.fill('#creation-title', 'プレビュー確認');
    await page.click('#creation-next');
    await page.fill('#auto-source', '1\n1,太陽,2,知,漢字2字');
    await page.click('#auto-parse');
    const card = page.locator('[data-row="0"]'), preview = card.locator('.auto-preview-sheet');
    await preview.locator('svg').waitFor();
    assert.match(await preview.textContent(), /太陽/);
    await card.locator('[data-preview]').click();
    await page.locator('.auto-preview-dialog svg').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.auto-preview-dialog').waitFor({ state: 'detached' });
    assert.equal(await card.isVisible(), true);
    assert.equal(await card.locator('[data-preview]').evaluate(e => e === document.activeElement), true);
    const original = await preview.innerHTML();
    await card.locator('[data-k="kind"]').selectOption('chars');
    assert.notEqual(await preview.innerHTML(), original);
    await card.locator('.auto-detail summary').click();
    const before = await preview.locator('svg').getAttribute('viewBox');
    await card.locator('[data-k="n"]').fill('10');
    assert.notEqual(await preview.locator('svg').getAttribute('viewBox'), before);
    await card.locator('[data-k="answer"]').fill('月');
    assert.match(await preview.textContent(), /月/);
    await card.locator('[data-k="n"]').fill('0');
    assert.equal(await preview.locator('svg').count(), 0);
    assert.match(await preview.textContent(), /字数/);
    await card.locator('[data-k="n"]').fill('10');
    await preview.locator('svg').waitFor();
    assert.equal(await page.evaluate(() => doc), null);
    console.log('PASS: type, answer and size update immediately; invalid sizes show guidance and recover without creating a document');

    const cases = await page.evaluate(() => {
      const before = JSON.stringify({ doc, uid, ui });
      let count = 0;
      for (const subject of ['国語', '数学']) for (const [kind] of AUTO_KINDS) {
        const answer = kind === 'graph' ? 'y=x^2' : kind === 'table' ? 'ア\tイ' : kind === 'extract' ? '太～陽' : kind === 'kanbun' ? '山' : '太陽';
        const row = { ...parseAutoAnswers('1\n1,太陽,2,知')[0], kind, kindAuto: false, answer, n: 10, w: 0, h: 0 };
        const image = autoAnswerPreview(row, subject);
        if (!image.querySelector('line,path,rect')) throw new Error(subject + ' ' + kind + ' has no field');
        if (image.getAttribute('viewBox').split(' ').some(n => !Number.isFinite(+n))) throw new Error('Invalid bounds');
        count++;
      }
      return { count, unchanged: before === JSON.stringify({ doc, uid, ui }) };
    });
    assert.equal(cases.count, 30); assert.equal(cases.unchanged, true);
    console.log('PASS: all 15 field kinds render in both writing directions without changing the document, IDs or editing state');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await preview.scrollIntoViewIfNeeded();
    assert.equal(await card.evaluate(c => c.scrollWidth <= c.clientWidth + 2), true);
    await page.screenshot({ path: '/tmp/answer-preview-mobile.png' });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/answer-preview-desktop.png' });
    await page.click('#auto-apply');
    await page.locator('.auto-modal').waitFor({ state: 'detached' });
    await page.click('#btn-answer-editor');
    await page.locator('.auto-preview-sheet svg').waitFor();
    const saved = await page.evaluate(() => JSON.stringify(doc));
    await page.locator('[data-k="answer"]').fill('未確定');
    await page.click('#auto-cancel');
    assert.equal(await page.evaluate(() => JSON.stringify(doc)), saved);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log('PASS: mobile/dark preview, generation, reopening and cancelling preserve saved work; no script errors or external requests');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
