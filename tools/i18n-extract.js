// Lists the Chinese text of a page that its English dictionaries don't cover yet.
//   node tools/i18n-extract.js <page>          missing strings as a JS object to fill in
//   node tools/i18n-extract.js <page> --all    every string, translated or not
// <page> is a folder in public/ (e.g. werewolf), "portal" or "common".
// Template literals become templates: `輪到 ${name}` -> '輪到 {0}'.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CJK = /[㐀-鿿豈-﫿]/;
const [page, flag] = process.argv.slice(2);
if (!page) {
  console.error('usage: node tools/i18n-extract.js <page> [--all]');
  process.exit(1);
}

// Which part of server.js belongs to which dictionary
const SERVER_SECTIONS = [
  ['common', 1, 1710], ['topten', 2338, 2502], ['whoami', 2503, 2986],
  ['undercover', 2987, 3407], ['mascarade', 3408, 4088], ['werewolf', 4089, 4534], ['decrypto', 4535, 4923],
  ['avalon', 4924, 5383], ['common', 5384, 5421], ['bloody99', 5422, Infinity]
];
// Section starts are found by their headers so the line numbers above can drift
const SECTION_HEADERS = { topten: 'TOPTEN (天才猜心王)', whoami: 'WHOAMI (名人猜猜我是誰)', undercover: 'UNDERCOVER (誰是臥底)', mascarade: 'MASCARADE (化裝舞會)', werewolf: 'ONE NIGHT WEREWOLF', decrypto: 'DECRYPTO (截碼戰)', avalon: 'AVALON (阿瓦隆)', chat: 'ROOM CHAT (every game)', bloody99: 'BLOODY 99 (血腥99)' };

function serverSections() {
  const lines = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').split(/\r?\n/);
  const starts = Object.entries(SECTION_HEADERS).map(([name, header]) => [name, lines.findIndex(l => l.includes(header))]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]);
  const sections = [['common', 0]].concat(starts);
  return sections.map(([name, start], i) => ({ name: name === 'chat' ? 'common' : name, text: lines.slice(start, i + 1 < sections.length ? sections[i + 1][1] : lines.length).join('\n') }));
}

// Pull string literals out of JS; templates get {n} for each ${…}
function jsStrings(src) {
  const out = [];
  let i = 0;
  const readTemplate = () => {
    let text = '';
    let n = 0;
    i++; // opening backtick
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { text += src[i + 1] === 'n' ? '\n' : src[i + 1]; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        let depth = 1;
        const start = i + 2;
        i += 2;
        while (i < src.length && depth) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') depth--;
          else if (src[i] === '`') { readTemplate(); continue; }
          else if (src[i] === "'" || src[i] === '"') { readQuoted(src[i]); continue; }
          i++;
        }
        out.push(...jsStrings(src.slice(start, i - 1)));
        text += `{${n++}}`;
        continue;
      }
      text += src[i++];
    }
    i++;
    if (CJK.test(text)) out.push(text);
  };
  const readQuoted = (q) => {
    let text = '';
    i++;
    while (i < src.length && src[i] !== q && src[i] !== '\n') {
      if (src[i] === '\\') { text += src[i + 1] === 'n' ? '\n' : src[i + 1]; i += 2; continue; }
      text += src[i++];
    }
    i++;
    if (CJK.test(text)) out.push(text);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) break; continue; }
    if (c === '`') { readTemplate(); continue; }
    if (c === "'" || c === '"') { readQuoted(c); continue; }
    i++;
  }
  return out;
}

// Text between tags and a few attributes in HTML
function htmlStrings(src) {
  const out = [];
  const body = src.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  body.replace(/>([^<>]+)</g, (_, t) => { const s = t.replace(/\s+/g, ' ').trim(); if (CJK.test(s)) out.push(s); });
  body.replace(/(?:placeholder|title|aria-label)="([^"]*)"/g, (_, t) => { if (CJK.test(t)) out.push(t.trim()); });
  // Inline onclick handlers etc. can hold strings too
  body.replace(/on\w+="([^"]*)"/g, (_, t) => out.push(...jsStrings(t)));
  return out;
}

function pageStrings(name) {
  const strings = [];
  const dirFiles = (dir, exts) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => exts.some(e => f.endsWith(e))).map(f => path.join(dir, f)) : []);
  if (name === 'portal') {
    strings.push(...htmlStrings(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8')));
    strings.push(...jsStrings(fs.readFileSync(path.join(ROOT, 'public/portal.js'), 'utf8')));
  } else if (name === 'common') {
    dirFiles(path.join(ROOT, 'public/shared'), ['.js']).forEach(f => strings.push(...jsStrings(fs.readFileSync(f, 'utf8'))));
  } else {
    dirFiles(path.join(ROOT, 'public', name), ['.html']).forEach(f => strings.push(...htmlStrings(fs.readFileSync(f, 'utf8'))));
    dirFiles(path.join(ROOT, 'public', name), ['.js']).forEach(f => strings.push(...jsStrings(fs.readFileSync(f, 'utf8'))));
  }
  const serverName = name === 'whonum' ? 'whoami' : name;
  serverSections().filter(s => s.name === serverName).forEach(s => strings.push(...jsStrings(s.text)));
  // HTML snippets built in JS become separate text pieces on the page
  const pieces = strings.flatMap(s => (/<[a-z][^>]*>/i.test(s)
    ? s.replace(/<[^>]*>/g, '\u0000').split('\u0000').map(t => t.replace(/\s+/g, ' ').trim())
    : [s]));
  // Multi-line strings are translated line by line
  return [...new Set(pieces.flatMap(s => s.split('\n')).map(s => s.trim()).filter(s => CJK.test(s)))];
}

// Keys already in the dictionaries this page loads
function knownKeys(name) {
  const keys = new Set();
  const sandbox = { BoardgameI18n: { add: (d) => Object.keys(d).forEach(k => keys.add(k)) } };
  vm.createContext(sandbox);
  const files = new Set(['common', name, ...(name === 'whonum' ? ['whoami'] : [])]);
  files.forEach(f => {
    const file = path.join(ROOT, 'public/shared/i18n', `${f}.js`);
    if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
  });
  return keys;
}

// A string counts as translated if a key matches it exactly or as a template
function coverage(keys) {
  // Tiny glue templates like '{0}（{1}）' don't count as covering a whole sentence
  const templates = [...keys].filter(k => /\{\d+\}/.test(k) && k.replace(/\{\d+\}|\s/g, '').length >= 3).map(k => new RegExp('^' + k.split(/\{\d+\}/).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]+?') + '$'));
  return { has: (s) => keys.has(s) || templates.some(re => re.test(s)) };
}

const strings = pageStrings(page);
const known = coverage(knownKeys(page));
const list = flag === '--all' ? strings : strings.filter(s => !known.has(s));
console.log(`// ${page}: ${strings.length} strings, ${strings.length - strings.filter(s => !known.has(s)).length} translated, ${strings.filter(s => !known.has(s)).length} missing`);
list.forEach(s => console.log(`    ${JSON.stringify(s)}: '',`));
