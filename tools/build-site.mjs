// GitHub Pages に置くファイル一式を site/ に作る。
//   site/index.html               … ページを開くとそのまま道具が使える
//   site/answer-sheet-maker.html  … 「名前を付けて保存」用の同じファイル
// 使い方: node tools/build-site.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync(new URL('../answer-sheet-maker.html', import.meta.url));
const dir = new URL('../site/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('index.html', dir), src);
writeFileSync(new URL('answer-sheet-maker.html', dir), src);
writeFileSync(new URL('.nojekyll', dir), '');
console.log('site/ を作りました（' + src.length + ' バイト）');
