import { readFile, writeFile } from 'node:fs/promises';
import { openGame } from './game-files.mjs';
import { buildCatalog } from '../dist/lib/excel.js';
import { parseScd } from '../dist/lib/scd.js';

const [directory, output = 'dist/data/track-metadata.json'] = process.argv.slice(2);
if (!directory) throw new Error('Usage: node tools/export-metadata.mjs <sqpack> [output.json]');
let previous = {};
try { previous = JSON.parse(await readFile(output, 'utf8')).tracks || {}; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const pack = await openGame(directory);
const catalog = await buildCatalog(pack);
const tracks = {};
const paths = [...new Set(catalog.tracks.filter(t => t.available).map(t => t.path.toLowerCase()))];
for (const [index, path] of paths.entries()) {
  const { ogg, hca, reason, ...metadata } = parseScd(await pack.read(path));
  tracks[path] = { ...metadata, coverTextureId: previous[path]?.coverTextureId ?? null, coverTexturePath: previous[path]?.coverTexturePath ?? null };
  if ((index + 1) % 100 === 0) console.log(`${index + 1}/${paths.length}`);
}
await writeFile(output, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), tracks }));
console.log(`Exported ${paths.length} metadata entries (no audio).`);
