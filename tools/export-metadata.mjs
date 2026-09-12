import { readFile, writeFile } from 'node:fs/promises';
import { openGame } from './game-files.mjs';
import { buildCatalog, readSheet } from '../dist/lib/excel.js';
import { parseScd } from '../dist/lib/scd.js';
import { iconTexturePaths } from '../dist/lib/tex.js';

const [directory, output = 'dist/data/track-metadata.json'] = process.argv.slice(2);
if (!directory) throw new Error('Usage: node tools/export-metadata.mjs <game-root-or-game-folder> [output.json]');
const INSTANCE_BGM_COLUMN = 4, CONDITION_CONTENT_COLUMN = 3, CONDITION_NAME_COLUMN = 43, CONDITION_IMAGE_COLUMN = 50;
let previous = {};
try { previous = JSON.parse(await readFile(output, 'utf8')).tracks || {}; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const pack = await openGame(directory);
const catalog = await buildCatalog(pack);
let conditions = { rows: new Map() }, instanceContents = { rows: new Map() };
try {
  conditions = await readSheet(pack, 'ContentFinderCondition');
  instanceContents = await readSheet(pack, 'InstanceContent');
} catch (error) { console.warn(`副本匹配表不可用，将只导出音频信息：${error.message}`); }
const conditionsByContent = new Map();
for (const [id, row] of conditions.rows) {
  const contentId = row[CONDITION_CONTENT_COLUMN], name = typeof row[CONDITION_NAME_COLUMN] === 'string' ? row[CONDITION_NAME_COLUMN].trim() : '';
  const imageId = Number.isInteger(row[CONDITION_IMAGE_COLUMN]) && row[CONDITION_IMAGE_COLUMN] > 0 ? row[CONDITION_IMAGE_COLUMN] : null;
  if (!Number.isInteger(contentId) || contentId <= 0 || (!name && !imageId)) continue;
  const matches = conditionsByContent.get(contentId) || [];
  matches.push({ id, name, imageId }); conditionsByContent.set(contentId, matches);
}
const contextsByBgm = new Map();
for (const [instanceContentId, row] of instanceContents.rows) {
  const bgmId = row[INSTANCE_BGM_COLUMN], contexts = conditionsByContent.get(instanceContentId);
  if (!Number.isInteger(bgmId) || bgmId <= 0 || !contexts) continue;
  const matches = contextsByBgm.get(bgmId) || [];
  for (const context of contexts) if (!matches.some(item => item.id === context.id)) matches.push(context);
  contextsByBgm.set(bgmId, matches);
}
const bgmIdsByPath = new Map();
for (const track of catalog.tracks) if (track.kind === 'bgm') bgmIdsByPath.set(track.path.toLowerCase(), track.bgmIds || [track.rowId]);
const tracks = {};
const paths = [...new Set(catalog.tracks.filter(t => t.available).map(t => t.path.toLowerCase()))];
for (const [index, path] of paths.entries()) {
  const { ogg, hca, reason, ...metadata } = parseScd(await pack.read(path));
  const contexts = (bgmIdsByPath.get(path) || []).flatMap(id => contextsByBgm.get(id) || []).filter((context, position, all) => all.findIndex(item => item.id === context.id) === position);
  const dungeons = contexts.map(context => context.name).filter(Boolean).filter((name, position, all) => all.indexOf(name) === position);
  const inferredCoverIds = contexts.map(context => context.imageId).filter(Number.isInteger).filter((id, position, all) => all.indexOf(id) === position);
  const old = previous[path] || {};
  const oldCoverIds = Array.isArray(old.coverTextureIds) ? old.coverTextureIds : Number.isInteger(old.coverTextureId) ? [old.coverTextureId] : [];
  const oldCoverPaths = Array.isArray(old.coverTexturePaths) ? old.coverTexturePaths : old.coverTexturePath ? [old.coverTexturePath] : [];
  const coverTextureIds = inferredCoverIds.length ? inferredCoverIds : oldCoverIds;
  const coverTexturePaths = inferredCoverIds.length ? coverTextureIds.flatMap(iconTexturePaths) : oldCoverPaths.length ? oldCoverPaths : coverTextureIds.flatMap(iconTexturePaths);
  tracks[path] = {
    ...metadata,
    dungeons: dungeons.length ? dungeons : (Array.isArray(old.dungeons) ? old.dungeons : []),
    coverTextureIds,
    coverTexturePaths,
    coverTextureId: coverTextureIds[0] ?? null,
    coverTexturePath: coverTexturePaths[0] ?? null,
  };
  if ((index + 1) % 100 === 0) console.log(`${index + 1}/${paths.length}`);
}
await writeFile(output, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), tracks }));
console.log(`Exported ${paths.length} metadata entries (no audio), mapped ${[...contextsByBgm.values()].reduce((sum, entries) => sum + entries.length, 0)} instance contexts.`);
