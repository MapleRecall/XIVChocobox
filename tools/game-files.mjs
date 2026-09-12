import { readdir } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { SqPack } from '../dist/lib/sqpack.js';

// Node-only adapter for testing the same browser parser against a local install.
export async function openGame(directory, indexOnly = false) {
  const files = new Map();
  const children = await readdir(directory, { withFileTypes: true });
  let repositories = children.filter(e => e.isDirectory() && /^(ffxiv|ex\d+)$/.test(e.name)).map(e => [e.name, path.join(directory, e.name)]);
  if (!repositories.length) repositories = [['ffxiv', directory]];
  for (const [repository, folder] of repositories) for (const name of await readdir(folder)) {
      if (!/^(0a|0c)[0-9a-f]{4}\.win32\.(index2?|dat\d+)$/i.test(name)) continue;
      if (indexOnly && name.endsWith('.index2')) continue;
      files.set(`${repository}/${name.toLowerCase()}`, { async getFile() { return openAsBlob(path.join(folder, name)); } });
    }
  return new SqPack(files);
}
