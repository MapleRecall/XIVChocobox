import http from 'node:http';
import { openGame } from './game-files.mjs';
import { parseScd } from '../dist/lib/scd.js';
import { readFile } from 'node:fs/promises';

// Temporary read-only localhost fixture service, never part of dist.
// Only fixed sample tracks are exposed, and only to the local preview origin.
const directory = process.argv[2];
if (!directory) throw new Error('Provide the local game root or game directory.');
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
    if (url.pathname === '/verify.js' || url.pathname === '/verify-variant.js') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(new URL(url.pathname === '/verify.js' ? '../tests/browser-audio.mjs' : '../tests/browser-variant.mjs', import.meta.url))); return;
    }
    if (url.pathname === '/audio-worklet.js' || url.pathname === '/lib/loop-cursor.js') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(new URL(url.pathname === '/audio-worklet.js' ? '../dist/audio-worklet.js' : '../dist/lib/loop-cursor.js', import.meta.url))); return;
    }
    if (url.pathname === '/verify.html' || url.pathname === '/verify-variant.html') {
      const script = url.pathname === '/verify.html' ? '/verify.js' : '/verify-variant.js';
      const functionName = url.pathname === '/verify.html' ? 'verifyAudio' : 'verifyVariant';
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><meta charset="utf-8"><title>Audio verification</title><pre id="result">running…</pre><script type="module">import { ${functionName} } from '${script}'; ${functionName}().then(value => { document.querySelector('#result').textContent = JSON.stringify(value, null, 2); }).catch(error => { document.querySelector('#result').textContent = error.stack || error.message; document.title = 'Audio verification failed'; });</script>`);
      return;
    }
    const key = url.pathname.split('.')[0].slice(1);
    if (!tracks[key]) { res.writeHead(404).end(); return; }
    const info = parseScd(await pack.read(tracks[key]));
    if (url.pathname.endsWith('.ogg')) { res.setHeader('Content-Type', 'audio/ogg'); res.end(info.ogg); }
    else { delete info.ogg; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(info)); }
  } catch (error) { res.writeHead(500).end(error.message); }
}).listen(4174, '127.0.0.1', () => console.log('Audio fixtures: http://127.0.0.1:4174'));
