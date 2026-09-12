import { ascii, cstring, requireRange, view } from './binary.js';

const languages = { 0: '', 1: 'ja', 2: 'en', 3: 'de', 4: 'fr', 5: 'chs', 6: 'ko', 7: 'cht' };

export async function readSheet(pack, name) {
  const bytes = await pack.read(`exd/${name}.exh`), d = view(bytes);
  requireRange(bytes, 0, 32);
  if (ascii(bytes, 0, 4) !== 'EXHF' || d.getUint16(16) !== 1) throw new Error(`${name} 数据表格式暂不支持。`);
  const fixed = d.getUint16(6), columnsCount = d.getUint16(8), pagesCount = d.getUint16(10), languagesCount = d.getUint16(12);
  requireRange(bytes, 32, columnsCount * 4 + pagesCount * 8 + languagesCount * 2);
  const columns = Array.from({ length: columnsCount }, (_, i) => ({ type: d.getUint16(32 + i * 4), offset: d.getUint16(34 + i * 4) }));
  const pagesAt = 32 + columnsCount * 4, langsAt = pagesAt + pagesCount * 8;
  const declared = Array.from({ length: languagesCount }, (_, i) => d.getUint16(langsAt + i * 2, true));
  const candidates = [5, 2, 1, 4, 3, 7, 6, 0].filter(id => declared.includes(id));
  if (!candidates.length) candidates.push(0);
  const firstPage = d.getUint32(pagesAt);
  const pagePath = (page, language) => `exd/${name}_${page}${languages[language] ? '_' + languages[language] : ''}.exd`;
  let language;
  for (const id of candidates) if (await pack.locate(pagePath(firstPage, id))) { language = id; break; }
  if (language === undefined) throw new Error(`找不到 ${name} 的可用语言数据。`);
  const rows = new Map();
  for (let p = 0; p < pagesCount; p++) {
    const raw = await pack.read(pagePath(d.getUint32(pagesAt + p * 8), language)), v = view(raw);
    requireRange(raw, 0, 32);
    if (ascii(raw, 0, 4) !== 'EXDF') throw new Error(`${name} 数据页损坏。`);
    const indexSize = v.getUint32(8);
    requireRange(raw, 32, indexSize);
    for (let i = 32; i < 32 + indexSize; i += 8) {
      const id = v.getUint32(i), at = v.getUint32(i + 4);
      requireRange(raw, at, 6);
      const length = v.getUint32(at), base = at + 6;
      requireRange(raw, base, length);
      requireRange(raw, base, fixed);
      const values = columns.map(column => {
        const c = base + column.offset;
        switch (column.type) {
          case 0: return cstring(raw, base + fixed + v.getUint32(c), base + length);
          case 1: return Boolean(v.getUint8(c));
          case 2: return v.getInt8(c);
          case 3: return v.getUint8(c);
          case 4: return v.getInt16(c);
          case 5: return v.getUint16(c);
          case 6: return v.getInt32(c);
          case 7: return v.getUint32(c);
          case 9: return v.getFloat32(c);
          default: if (column.type >= 25 && column.type <= 32) return Boolean(v.getUint8(c) & (1 << (column.type - 25))); return null;
        }
      });
      rows.set(id, values);
    }
  }
  return { rows, language: languages[language] || 'none' };
}

export async function buildCatalog(pack, progress = () => {}) {
  progress('正在读取管弦乐谱名称…');
  const names = await readSheet(pack, 'Orchestrion');
  progress('正在读取管弦乐谱路径…');
  const paths = await readSheet(pack, 'OrchestrionPath');
  progress('正在读取游戏配乐目录…');
  const bgm = await readSheet(pack, 'BGM');
  const tracks = [];
  for (const [id, row] of paths.rows) {
    const path = row[0];
    if (!path || !path.toLowerCase().endsWith('.scd')) continue;
    const named = names.rows.get(id) || [];
    tracks.push({ id: `orchestrion:${id}`, rowId: id, kind: 'orchestrion', title: named[0] || `管弦乐谱 ${id}`, description: named[1] || '', path });
  }
  const byPath = new Map();
  for (const [id, row] of bgm.rows) {
    const path = row[0];
    if (!path || !path.toLowerCase().endsWith('.scd')) continue;
    if (byPath.has(path.toLowerCase())) { byPath.get(path.toLowerCase()).bgmIds.push(id); continue; }
    const track = { id: `bgm:${id}`, rowId: id, bgmIds: [id], kind: 'bgm', title: path.split('/').pop().replace(/\.scd$/i, ''), description: '', path };
    tracks.push(track); byPath.set(path.toLowerCase(), track);
  }
  progress('正在检查曲目是否位于所选目录…');
  for (const track of tracks) {
    const location = await pack.locate(track.path);
    track.available = Boolean(location && pack.files.has(location.dat));
    track.unavailableReason = track.available ? null : !track.path.toLowerCase().startsWith('music/ffxiv/') ? '资料片资源不可用，请选择完整 sqpack 目录' : '所选目录缺少资源';
  }
  return { tracks, language: names.language, repositories: [...new Set([...pack.files.keys()].map(n => n.split('/')[0]))].sort() };
}
