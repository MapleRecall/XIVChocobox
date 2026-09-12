import { openGame } from './game-files.mjs';
import { readSheet } from '../dist/lib/excel.js';

const root = process.argv[2] || 'C:/Games/FFXIV';
const pack = await openGame(root);
const bgm = await readSheet(pack, 'BGM');
const matches = [...bgm.rows.entries()].filter(([, row]) => String(row[0] || '').toLowerCase().includes('crystaltower'));
const ids = new Set(matches.map(([id]) => id));
const situation = await readSheet(pack, 'BGMSituation');
const situations = [...situation.rows.entries()].filter(([, row]) => row.some(value => ids.has(value)));
const linkedSheets = {};
for (const name of ['TerritoryType', 'InstanceContent', 'Fate', 'Mount']) {
  try {
    const sheet = await readSheet(pack, name);
    linkedSheets[name] = { language: sheet.language, rows: [...sheet.rows.entries()].filter(([, row]) => row.some(value => ids.has(value))).slice(0, 50) };
  } catch (error) { linkedSheets[name] = { error: error.message }; }
}
console.log(JSON.stringify({ bgmLanguage: bgm.language, matches, situationLanguage: situation.language, situations, linkedSheets }, null, 2));
