import { readdir } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { SqPack } from '../dist/lib/sqpack.js';

// Node-only adapter for testing the same browser parser against a local install.
export async function openGame(directory, indexOnly = false) {
  const selectedName = path.basename(directory).toLowerCase();
  const children = await readdir(directory, { withFileTypes: true });
  let sqpack;
  if (selectedName === 'game') {
    const entry = children.find(item => item.isDirectory() && item.name.toLowerCase() === 'sqpack');
    if (entry) sqpack = path.join(directory, entry.name);
  } else {
    const entry = children.find(item => item.isDirectory() && item.name.toLowerCase() === 'game');
    if (entry) {
      const game = path.join(directory, entry.name);
      const gameChildren = await readdir(game, { withFileTypes: true });
      const sqpackEntry = gameChildren.find(item => item.isDirectory() && item.name.toLowerCase() === 'sqpack');
      if (sqpackEntry) sqpack = path.join(game, sqpackEntry.name);
    }
  }
  if (!sqpack) throw new Error('请选择游戏根目录或 game 文件夹，程序会自动寻找其中的 game/sqpack。');
  const files = new Map();
  const sqpackEntries = await readdir(sqpack, { withFileTypes: true });
  const repositories = sqpackEntries.filter(e => e.isDirectory() && /^(ffxiv|ex\d+)$/i.test(e.name)).map(e => [e.name.toLowerCase(), path.join(sqpack, e.name)]);
  for (const [repository, folder] of repositories) for (const name of await readdir(folder)) {
      if (!/^[0-9a-f]{6}\.win32\.(index2?|dat\d+)$/i.test(name)) continue;
      if (indexOnly && name.endsWith('.index2')) continue;
      files.set(`${repository}/${name.toLowerCase()}`, { async getFile() { return openAsBlob(path.join(folder, name)); } });
    }
  return new SqPack(files);
}
