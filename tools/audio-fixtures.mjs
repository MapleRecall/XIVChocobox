import http from 'node:http';
import { openGame } from './game-files.mjs';
import { parseScd } from '../dist/lib/scd.js';
import { readFile } from 'node:fs/promises';

// Temporary read-only localhost fixture service, never part of dist.
// Only fixed sample tracks are exposed, and only to the local preview origin.
const directory = process.argv[2];
if (!directory) throw new Error('Provide the local sqpack directory.');
const pack = await openGame(directory);
const tracks = {
  snow: 'music/ffxiv/Orchestrion/BGM_ORCH_001.scd',
  dungeon: 'music/ffxiv/BGM_Battle_Dungeon_01.scd',
  raid: 'music/ffxiv/BGM_Rade_01.scd',
  crystal02: 'music/ffxiv/BGM_Con_CrystalTower_02.scd',
  expansion: 'music/ex1/BGM_EX1_Alex03.scd',
};
http.createServer(async (req, res) => {
  try {
    if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:4173') { res.writeHead(403).end(); return; }
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:4173');
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/verify.js') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(new URL('../tests/browser-audio.mjs', import.meta.url))); return;
    }
    const key = url.pathname.split('.')[0].slice(1);
    if (!tracks[key]) { res.writeHead(404).end(); return; }
    const info = parseScd(await pack.read(tracks[key]));
    if (url.pathname.endsWith('.ogg')) { res.setHeader('Content-Type', 'audio/ogg'); res.end(info.ogg); }
    else { delete info.ogg; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(info)); }
  } catch (error) { res.writeHead(500).end(error.message); }
}).listen(4174, '127.0.0.1', () => console.log('Audio fixtures: http://127.0.0.1:4174'));
