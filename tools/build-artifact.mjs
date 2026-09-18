// 公開ページ（claude.ai の Artifact）用の版を作る。
//   ・Artifact 側が <!doctype html><head><body> を付けるので、その外枠を外す
//   ・中身（<title> と <style> と本文）はそのまま
// 使い方: node tools/build-artifact.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync(new URL('../answer-sheet-maker.html', import.meta.url), 'utf8');
const head = src.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta[^>]*>\s*/g, '')            // charset と viewport は Artifact 側が持つ
  .trim();
const body = src.match(/<body>([\s\S]*?)<\/body>/)[1].trim();

mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/artifact.html', import.meta.url), head + '\n\n' + body + '\n');
console.log('dist/artifact.html を書き出しました');
