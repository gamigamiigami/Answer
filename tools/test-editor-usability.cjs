const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-editor-usability-'));
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(__dirname, '../answer-sheet-maker.html'))); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || '/usr/bin/chromium', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 950 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
    const url = 'http://127.0.0.1:' + server.address().port;
    await page.goto(url); await page.click('#btn-from-answers');
    page.once('dialog', d => { assert.match(d.message(), /入力されてへんで/); d.dismiss(); });
    await page.click('#creation-next'); assert.equal(await page.locator('#creation-title').isVisible(), true);
    page.once('dialog', d => d.accept()); await page.click('#creation-next');
    page.once('dialog', d => d.accept()); await page.click('#auto-parse');
    await page.locator('.auto-modal').waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => [doc.paper.title, doc.paper.grade, doc.paper.testName, doc.fields.length]), ['', '', '', 0]);
    console.log('PASS: empty inputs offer confirmation; cancellation preserves the form and acceptance starts a truly blank sheet');

    await page.goto(url); await page.click('#btn-from-answers');
    await page.fill('#creation-grade', '2'); await page.fill('#creation-title', '国語テスト'); await page.click('#creation-next');
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const box = await page.locator('#auto-parse').boundingBox();
      const cancel = await page.locator('#auto-cancel').boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 844 && box.x > cancel.x, JSON.stringify({ width, box, cancel }));
    }
    await page.setViewportSize({ width: 1366, height: 950 });
    await page.fill('#auto-source', '1\n1￥あ、。っゃ。￥2￥知\n2￥(1)￥太陽￥2￥知'); await page.click('#auto-parse'); await page.click('#auto-apply');
    await page.locator('.auto-modal').waitFor({ state: 'detached' });
    const geometry = await page.evaluate(() => {
      const cells = buildCells(doc, true), corners = [...cells.values()].filter(x => ['、', '。', 'っ', 'ゃ'].includes(x.t));
      const frames = [...doc.fields.flatMap(f => f.label ? [f.label] : []), ...doc.decorations.filter(q => q.questionHeading)];
      const picture=el('svg');appendCellArtwork(doc,cells,picture);
      const drawn=[...picture.querySelectorAll('text')].filter(t=>['、','。','っ','ゃ'].includes(t.textContent));
      const upperRight=drawn.length===corners.length && corners.every((c,i)=>{
        const box=rectMM(doc,{c:c.c,r:c.r,w:c.mg?.w || 1,h:c.mg?.h || CHAR_ROWS}),text=drawn[i];
        return +text.getAttribute('y')<box.y+box.h/2 && +text.getAttribute('x')>box.x+box.w/2;
      });
      return { grade: doc.paper.grade, name: doc.paper.testName, title: doc.paper.title, upperRight, corners: corners.map(c => [c.t, c.align, c.valign]), boxed: frames.every(r => { const b = unionBorders(cells, r.c, r.r, r.w, r.h); return b.top && b.bottom && b.left && b.right; }) };
    });
    assert.equal(geometry.grade, '2'); assert.equal(geometry.name, '国語テスト'); assert.equal(geometry.title, '2 国語テスト');
    assert.ok(geometry.corners.length >= 5); assert.ok(geometry.corners.every(c => c[1] === 'right' && c[2] === 'top')); assert.equal(geometry.upperRight,true); assert.equal(geometry.boxed, true);
    await page.click('#tab-answer'); await page.screenshot({ path: path.join(out, 'vertical-corners.png') });
    const download = page.waitForEvent('download'); await page.click('#btn-xlsx'); await (await download).saveAs(path.join(out, 'corners.xlsx'));
    const excel = spawnSync(process.env.TEST_PYTHON_PATH || 'python3', ['-c', `
import sys, openpyxl
b=openpyxl.load_workbook(sys.argv[1]); found=[]
for s in b:
 for row in s:
  for c in row:
   if c.value in ['、','。','っ','ゃ']:
    assert c.alignment.horizontal=='right' and c.alignment.vertical=='top',(s.title,c.coordinate,c.alignment)
    found.append(c.value)
assert len(found)>=5,found
print('PASS: independent Excel inspection confirms right/top vertical punctuation and small kana')
`, path.join(out, 'corners.xlsx')], { encoding: 'utf8' });
    process.stdout.write(excel.stdout); process.stderr.write(excel.stderr); assert.equal(excel.status, 0);
    console.log('PASS: grade/test name persist; parse button stays visible to the right of cancel on PC/mobile; all question labels have four borders');

    await page.evaluate(() => openKanbunEditor({ answer: '不/ズ/レ 学/ブ/', onSave: (a, g) => window.kanbunResult = { a, g } }));
    const position = async j => page.locator('[data-i="0"][data-j="' + j + '"]').boundingBox();
    const center = await position(0), right = await position(1), left = await position(2);
    assert.ok(left.x < center.x && center.x < right.x && right.y > center.y && left.y > center.y);
    await page.fill('#kanbun-count', '3'); await page.locator('#kanbun-count').press('Tab');
    assert.equal(await page.locator('[data-i]').count(), 9);
    await page.fill('[data-i="2"][data-j="0"]', '人');
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(out, 'kanbun-direct-mobile.png') });
    await page.click('#kanbun-save'); assert.equal(await page.evaluate(() => parseKanbun(window.kanbunResult.a).length), 3);
    const kanbun = await page.evaluate(() => { const d = buildAutoDocument(parseAutoAnswers('1\n1￥不/ズ/レ 学/ブ/￥2￥知￥漢文'), '国語'), f = d.fields[0], b = unionBorders(buildCells(d, false), f.rects[0].c, f.rects[0].r, f.rects[0].w, f.rects[0].h); return { borders: !!(b.top && b.bottom && b.left && b.right), lines: kanbunPrimitives(d, f, d.answers[f.id], true).filter(v => v.k === 'line').length }; });
    assert.deepEqual(kanbun, { borders: true, lines: 12 });
    console.log('PASS: direct center/right/left kanbun inputs, square count changes and outer answer frame');

    await page.evaluate(() => openTableEditor({ table: { rows: 2, cols: 2, merges: [{ r: 0, c: 0, rows: 1, cols: 2 }] }, onSave: (t, a) => window.tableResult = { t, a } }));
    assert.equal(await page.locator('[data-table-cell]').count(), 3);
    assert.equal(await page.locator('[data-table-cell="0,0"]').evaluate(e => e.closest('td').colSpan), 2);
    assert.equal(await page.locator('[data-table-cell="0,0"]').evaluate(e => getComputedStyle(e).borderTopWidth), '0px');
    await page.fill('[data-table-cell="0,0"]', '見出し'); await page.check('#table-given');
    await page.fill('[data-table-cell="1,0"]', '答え'); await page.screenshot({ path: path.join(out, 'table-direct-mobile.png') });
    await page.click('#table-save'); assert.equal(await page.evaluate(() => window.tableResult.t.given[0][0]), '見出し');
    assert.deepEqual(errors, []); console.log('PASS: one contiguous table with actual merged cells supports direct text/header editing');
    console.log('Artifacts: ' + out);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
