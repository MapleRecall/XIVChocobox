import { readFile, writeFile } from 'node:fs/promises';
import { openGame } from './game-files.mjs';
import { buildCatalog, readSheet } from '../dist/lib/excel.js';
import { parseScd } from '../dist/lib/scd.js';
import { iconTexturePaths } from '../dist/lib/tex.js';
import { BGM_USAGE_OVERRIDES } from '../dist/lib/bgm-locations.js';
import { bgmLocations } from '../dist/lib/bgm-location-i18n.js';

const [directory, output = 'dist/data/track-metadata.json'] = process.argv.slice(2);
if (!directory) throw new Error('Usage: node tools/export-metadata.mjs <game-root-or-game-or-sqpack-folder> [output.json]');
// Column 45 is ContentFinderCondition.ContentType in the game Excel schema.
const INSTANCE_BGM_COLUMN = 4, CONDITION_CONTENT_COLUMN = 3, CONDITION_TYPE_COLUMN = 45, CONDITION_NAME_COLUMN = 43, CONDITION_IMAGE_COLUMN = 50;
const TERRITORY_CONDITION_COLUMN = 10, TERRITORY_BGM_SITUATION_COLUMN = 19, TERRITORY_PLACE_COLUMN = 5, SITUATION_BGM_COLUMNS = [0, 1, 2, 3, 4];
let previous = {};
try { previous = JSON.parse(await readFile(output, 'utf8')).tracks || {}; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const pack = await openGame(directory);
const catalog = await buildCatalog(pack);
let conditions = { rows: new Map() }, instanceContents = { rows: new Map() }, territories = { rows: new Map() }, bgmSituations = { rows: new Map() }, placeNames = { rows: new Map() };
try {
  conditions = await readSheet(pack, 'ContentFinderCondition');
  instanceContents = await readSheet(pack, 'InstanceContent');
  territories = await readSheet(pack, 'TerritoryType');
  bgmSituations = await readSheet(pack, 'BGMSituation');
  placeNames = await readSheet(pack, 'PlaceName');
} catch (error) { console.warn(`副本匹配表不可用，将只导出音频信息：${error.message}`); }
const conditionsByContent = new Map();
for (const [id, row] of conditions.rows) {
  const contentId = row[CONDITION_CONTENT_COLUMN], name = typeof row[CONDITION_NAME_COLUMN] === 'string' ? row[CONDITION_NAME_COLUMN].trim() : '';
  const imageId = Number.isInteger(row[CONDITION_IMAGE_COLUMN]) && row[CONDITION_IMAGE_COLUMN] > 0 ? row[CONDITION_IMAGE_COLUMN] : null;
  if (!Number.isInteger(contentId) || contentId <= 0 || (!name && !imageId)) continue;
  const matches = conditionsByContent.get(contentId) || [];
  const contentType = Number.isInteger(row[CONDITION_TYPE_COLUMN]) ? row[CONDITION_TYPE_COLUMN] : 0;
  matches.push({ id, name, imageId, contentType }); conditionsByContent.set(contentId, matches);
}
const contextsByBgm = new Map();
function addContext(bgmId, context) {
  if (!Number.isInteger(bgmId) || bgmId <= 0) return;
  const matches = contextsByBgm.get(bgmId) || [];
  if (!matches.some(item => item.key === context.key)) matches.push(context);
  contextsByBgm.set(bgmId, matches);
}
// ContentFinderCondition.ContentType lets reused tracks keep their real duty
// context ahead of Gold Saucer, minigame, quest-battle, and other special rows.
// For example, BGM row 149 is linked to The Praetorium (type 2) as well as
// Gold Saucer rows (type 19); the normal duty wins and the special reuse stays
// available only when no stronger duty context exists.
const PRIMARY_CONTENT_TYPES = new Set([2, 4, 5, 21, 28, 30, 37, 38]);
const SECONDARY_CONTENT_TYPES = new Set([26, 27, 29]);
const LOW_PRIORITY_CONTENT_TYPES = new Set([7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 31, 32, 35, 36]);
function contextPriority(context) {
  if (PRIMARY_CONTENT_TYPES.has(context.contentType)) return 0;
  if (SECONDARY_CONTENT_TYPES.has(context.contentType)) return 1;
  if (LOW_PRIORITY_CONTENT_TYPES.has(context.contentType)) return 3;
  return 2;
}
function preferredContexts(contexts) {
  if (!contexts.length) return [];
  const best = Math.min(...contexts.map(contextPriority));
  return contexts.filter(context => contextPriority(context) === best);
}
function curatedUsage(bgmIds, locale) {
  const names = bgmLocations(bgmIds, locale), imageIds = [];
  for (const bgmId of bgmIds) {
    const override = BGM_USAGE_OVERRIDES[bgmId];
    for (const imageId of Array.isArray(override?.imageIds) ? override.imageIds : []) if (Number.isInteger(imageId) && imageId > 0 && !imageIds.includes(imageId)) imageIds.push(imageId);
  }
  return { names, imageIds };
}
for (const [instanceContentId, row] of instanceContents.rows) {
  const bgmId = row[INSTANCE_BGM_COLUMN], contexts = conditionsByContent.get(instanceContentId);
  if (!Number.isInteger(bgmId) || bgmId <= 0 || !contexts) continue;
  for (const context of contexts) addContext(bgmId, { ...context, key: `instance:${context.id}` });
}
for (const [territoryId, row] of territories.rows) {
  const conditionId = row[TERRITORY_CONDITION_COLUMN], situation = bgmSituations.rows.get(row[TERRITORY_BGM_SITUATION_COLUMN]), condition = conditions.rows.get(conditionId);
  if (!Number.isInteger(conditionId) || conditionId <= 0 || !condition || !situation) continue;
  const placeName = placeNames.rows.get(row[TERRITORY_PLACE_COLUMN])?.[0]?.trim();
  const name = placeName || (typeof condition[CONDITION_NAME_COLUMN] === 'string' ? condition[CONDITION_NAME_COLUMN].trim() : '');
  const imageId = Number.isInteger(condition[CONDITION_IMAGE_COLUMN]) && condition[CONDITION_IMAGE_COLUMN] > 0 ? condition[CONDITION_IMAGE_COLUMN] : null;
  if (!name && !imageId) continue;
  const contentType = Number.isInteger(condition[CONDITION_TYPE_COLUMN]) ? condition[CONDITION_TYPE_COLUMN] : 0;
  for (const column of SITUATION_BGM_COLUMNS) addContext(situation[column], { key: `territory:${territoryId}:${conditionId}`, id: conditionId, name, imageId, contentType });
}
const bgmIdsByPath = new Map();
for (const track of catalog.tracks) if (track.kind === 'bgm') bgmIdsByPath.set(track.path.toLowerCase(), track.bgmIds || [track.rowId]);
const tracks = {};
const paths = [...new Set(catalog.tracks.filter(t => t.available).map(t => t.path.toLowerCase()))];
for (const [index, path] of paths.entries()) {
  const { ogg, hca, reason, ...metadata } = parseScd(await pack.read(path));
  const bgmIds = bgmIdsByPath.get(path) || [];
  const contexts = bgmIds.flatMap(id => contextsByBgm.get(id) || []).filter((context, position, all) => all.findIndex(item => item.key === context.key) === position);
  const relevantContexts = preferredContexts(contexts);
  const dungeons = relevantContexts.map(context => context.name).filter(Boolean).filter((name, position, all) => all.indexOf(name) === position);
  const curatedByLocale = Object.fromEntries(['zh', 'en', 'ja'].map(locale => [locale, curatedUsage(bgmIds, locale)]));
  const inferredCoverIds = relevantContexts.map(context => context.imageId).filter(Number.isInteger).filter((id, position, all) => all.indexOf(id) === position);
  const old = previous[path] || {};
  const oldCoverIds = Array.isArray(old.coverTextureIds) ? old.coverTextureIds : Number.isInteger(old.coverTextureId) ? [old.coverTextureId] : [];
  const oldCoverPaths = Array.isArray(old.coverTexturePaths) ? old.coverTexturePaths : old.coverTexturePath ? [old.coverTexturePath] : [];
  const oldDungeons = Array.isArray(old.dungeons) ? old.dungeons : [];
  const oldUses = Array.isArray(old.uses) ? old.uses : [];
  const usageByLocale = Object.fromEntries(['zh', 'en', 'ja'].map(locale => {
    const curated = curatedByLocale[locale].names;
    return [locale, curated.length ? curated : dungeons.length ? dungeons : oldUses.length ? oldUses : oldDungeons];
  }));
  const uses = usageByLocale.zh;
  const automaticCoverIds = inferredCoverIds.length ? inferredCoverIds : curatedByLocale.zh.imageIds;
  const coverTextureIds = automaticCoverIds.length ? automaticCoverIds : oldCoverIds;
  const coverTexturePaths = automaticCoverIds.length ? coverTextureIds.flatMap(iconTexturePaths) : oldCoverPaths.length ? oldCoverPaths : coverTextureIds.flatMap(iconTexturePaths);
  tracks[path] = {
    ...metadata,
    dungeons: dungeons.length ? dungeons : oldDungeons,
    uses,
    usageByLocale,
    coverTextureIds,
    coverTexturePaths,
    coverTextureId: coverTextureIds[0] ?? null,
    coverTexturePath: coverTexturePaths[0] ?? null,
  };
  if ((index + 1) % 100 === 0) console.log(`${index + 1}/${paths.length}`);
}
await writeFile(output, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), tracks }));
console.log(`Exported ${paths.length} metadata entries (no audio), mapped ${[...contextsByBgm.values()].reduce((sum, entries) => sum + entries.length, 0)} table contexts plus curated BGM usage.`);
