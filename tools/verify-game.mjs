import assert from 'node:assert/strict';
import { openGame } from './game-files.mjs';
import { buildCatalog } from '../dist/lib/excel.js';
import { parseScd } from '../dist/lib/scd.js';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: npm run verify:game -- <sqpack/ffxiv directory> [--all]');
const pack = await openGame(directory);
const catalog = await buildCatalog(pack, console.log);
const available = catalog.tracks.filter(t => t.available);
console.log(JSON.stringify({ language: catalog.language, tracks: catalog.tracks.length, available: available.length, orchestrion: available.filter(t => t.kind === 'orchestrion').length, sample: catalog.tracks.slice(0, 3) }, null, 2));
assert(available.length > 100);
const samples = process.argv.includes('--all') ? available : available.filter(t => /BGM_ORCH_(001|006|130|153|921)|BGM_Battle_Dungeon_01|BGM_Rade_01|BGM_Town_Gri_Day/i.test(t.path));
const results = [];
for (const track of samples) {
  try {
    const info = parseScd(await pack.read(track.path));
    const { ogg, hca, ...metadata } = info;
    results.push({ title: track.title, path: track.path, ...metadata });
    if (!process.argv.includes('--all')) console.log(JSON.stringify(results.at(-1)));
  } catch (error) { results.push({ path: track.path, error: error.message }); console.error(track.path, error.message); }
}
console.log(JSON.stringify({ scanned: results.length, errors: results.filter(r => r.error), codecs: results.reduce((a, r) => { a[r.codec || 'error'] = (a[r.codec || 'error'] || 0) + 1; return a; }, {}), loops: results.filter(r => r.loop).length, marks: results.filter(r => r.marks?.length).length }, null, 2));
assert.equal(results.filter(r => r.error).length, 0);
const indexPack = await openGame(directory, true);
assert.deepEqual(await indexPack.read('exd/Orchestrion.exh'), await pack.read('exd/Orchestrion.exh'));
console.log('index / index2 路径解析一致。');
