// Собирает программу в один файл MapPin.html: открывается двойным щелчком, без установки.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

let html = readFileSync('dist/index.html', 'utf8');
const assets = readdirSync('dist/assets');
if (assets.filter((f) => f.endsWith('.js')).length !== 1) throw new Error('Ожидался один JS-файл: ' + assets.join(', '));

html = html.replace(/<script type="module" crossorigin src="\.\/assets\/([^"]+)"><\/script>/, (_, f) => {
  const js = readFileSync(`dist/assets/${f}`, 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/assets\/([^"]+)">/, (_, f) => `<style>${readFileSync(`dist/assets/${f}`, 'utf8')}</style>`);
// Встроенный скрипт не пройдёт CSP с script-src 'self'.
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '');
if (/assets\//.test(html)) throw new Error('Остались внешние ссылки на assets/');
writeFileSync('MapPin.html', html);
console.log(`MapPin.html: ${(html.length / 1024).toFixed(0)} КБ`);
