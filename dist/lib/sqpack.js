import { ascii, cstring, pathHash, readRange, requireRange, view } from './binary.js';

export class SqPack {
  constructor(files) { this.files = files; this.indices = new Map(); }

  static async fromDirectory(directory) {
    // Handles are retained, not the contents of multi-gigabyte DAT files.
    const entriesOf = async folder => {
      const entries = [];
      for await (const entry of folder.entries()) entries.push(entry);
      return entries;
    };
    const findDirectory = (entries, wanted) => entries.find(([name, handle]) => handle.kind === 'directory' && name.toLowerCase() === wanted)?.[1] || null;
    const selectedEntries = await entriesOf(directory), selectedName = String(directory.name || '').toLowerCase();
    let sqpack = null;
    if (selectedName === 'game') sqpack = findDirectory(selectedEntries, 'sqpack');
    if (!sqpack) {
      const game = findDirectory(selectedEntries, 'game');
      if (game) sqpack = findDirectory(await entriesOf(game), 'sqpack');
    }
    if (!sqpack) throw new Error('请选择游戏根目录或 game 文件夹，程序会自动寻找其中的 game/sqpack。');
    const files = new Map();
    const collect = async (folder, repository) => {
      for await (const [name, handle] of folder.entries()) {
        if (handle.kind === 'file' && /^[0-9a-f]{6}\.win32\.(index2?|dat\d+)$/i.test(name)) files.set(`${repository}/${name.toLowerCase()}`, handle);
      }
    };
    for await (const [name, handle] of sqpack.entries()) {
      if (handle.kind === 'directory' && /^(ffxiv|ex\d+)$/i.test(name)) await collect(handle, name.toLowerCase());
    }
    if (![...files.keys()].some(n => n.startsWith('ffxiv/0a') && /\.index2?$/.test(n)) || ![...files.keys()].some(n => n.startsWith('ffxiv/0c') && /\.index2?$/.test(n))) {
      throw new Error('所选目录不是完整的游戏资源目录，请确认其中包含 game/sqpack 及完整的本体资源。');
    }
    return new SqPack(files);
  }

  async file(name) {
    const handle = this.files.get(name);
    if (!handle) throw new Error(`资源目录缺少 ${name}。请确认游戏文件完整。`);
    return handle.getFile ? handle.getFile() : handle;
  }

  async loadIndex(name) {
    if (this.indices.has(name)) return this.indices.get(name);
    const bytes = new Uint8Array(await (await this.file(name)).arrayBuffer());
    requireRange(bytes, 0, 24, name);
    if (ascii(bytes, 0, 6) !== 'SqPack') throw new Error(`${name} 不是有效的 SqPack 索引。`);
    const d = view(bytes), header = d.getUint32(12, true);
    requireRange(bytes, header, 0x60, name);
    const start = d.getUint32(header + 8, true), size = d.getUint32(header + 12, true);
    requireRange(bytes, start, size, name);
    const index2 = name.endsWith('index2'), stride = index2 ? 8 : 16;
    if (size % stride) throw new Error(`${name} 的索引条目大小无效。`);
    const lookup = new Map();
    for (let p = start; p < start + size; p += stride) {
      const key = index2 ? d.getUint32(p, true) : `${d.getUint32(p + 4, true)}:${d.getUint32(p, true)}`;
      lookup.set(key, d.getUint32(p + (index2 ? 4 : 8), true));
    }
    const synonyms = new Map();
    const synonymOffset = d.getUint32(header + 0x50, true), synonymSize = d.getUint32(header + 0x54, true);
    requireRange(bytes, synonymOffset, synonymSize, name);
    for (let p = synonymOffset; p + 256 <= synonymOffset + synonymSize; p += 256) {
      const path = cstring(bytes, p + 16, p + 256).toLowerCase();
      if (path) synonyms.set(path, d.getUint32(p + 8, true));
    }
    const index = { lookup, synonyms, index2, stem: name.replace(/\.index2?$/, '') };
    this.indices.set(name, index);
    return index;
  }

  async locate(path) {
    path = path.toLowerCase().replaceAll('\\', '/');
    const repository = path.startsWith('music/') ? path.split('/')[1] : 'ffxiv';
    const category = path.startsWith('exd/') ? '0a' : /^music\/(ffxiv|ex\d+)\//.test(path) ? '0c' : path.startsWith('ui/') ? '06' : null;
    if (!category) return null;
    const names = [...this.files.keys()].filter(n => n.startsWith(`${repository}/${category}`) && /\.index2?$/.test(n));
    // Prefer index2, but accept installations containing only .index.
    for (const name of names) {
      if (name.endsWith('.index') && this.files.has(name + '2')) continue;
      const index = await this.loadIndex(name), slash = path.lastIndexOf('/');
      const key = index.index2 ? pathHash(path) : `${pathHash(path.slice(0, slash))}:${pathHash(path.slice(slash + 1))}`;
      let locator = index.lookup.get(key);
      if (locator === undefined) continue;
      if (locator & 1) locator = index.synonyms.get(path);
      if (locator === undefined || (locator & 1)) continue;
      return { dat: `${index.stem}.dat${(locator >>> 1) & 7}`, offset: (locator >>> 4) * 128 };
    }
    return null;
  }

  async read(path) {
    const location = await this.locate(path);
    if (!location) throw new Error(`所选目录中没有 ${path}。`);
    const file = await this.file(location.dat), base = location.offset;
    const head = view(await readRange(file, base, 24));
    const headerSize = head.getUint32(0, true), type = head.getUint32(4, true);
    const size = head.getUint32(8, true), blocks = head.getUint32(20, true);
    if (type === 4) return this.readTexture(file, base, headerSize, size, blocks, path);
    if (type !== 2) throw new Error(`${path} 使用暂不支持的资源类型 ${type}。`);
    if (size > 128 * 1024 * 1024 || headerSize > 1024 * 1024 || headerSize < 24 + blocks * 8) throw new Error(`${path} 的资源头大小异常。`);
    const table = view(await readRange(file, base + 24, blocks * 8));
    let packedSize = 0;
    for (let i = 0; i < blocks; i++) packedSize = Math.max(packedSize, table.getUint32(i * 8, true) + table.getUint16(i * 8 + 4, true));
    if (packedSize > 160 * 1024 * 1024) throw new Error('压缩资源过大。');
    const packed = await readRange(file, base + headerSize, packedSize), data = view(packed);
    const output = new Uint8Array(size);
    let target = 0;
    // Batch decompression avoids thousands of separate disk reads per song.
    for (let first = 0; first < blocks; first += 24) {
      const decoded = await Promise.all(Array.from({ length: Math.min(24, blocks - first) }, async (_, k) => {
        const i = first + k, at = table.getUint32(i * 8, true);
        requireRange(packed, at, 16);
        const blockHeader = data.getUint32(at, true), compressed = data.getUint32(at + 8, true), uncompressed = data.getUint32(at + 12, true);
        if (blockHeader < 16 || uncompressed !== table.getUint16(i * 8 + 6, true)) throw new Error('压缩块头与索引不一致。');
        const length = compressed === 32000 ? uncompressed : compressed;
        requireRange(packed, at + blockHeader, length);
        const chunk = packed.subarray(at + blockHeader, at + blockHeader + length);
        if (compressed === 32000) return chunk;
        const stream = new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const result = new Uint8Array(await new Response(stream).arrayBuffer());
        if (result.length !== uncompressed) throw new Error('解压后长度与资源头不一致。');
        return result;
      }));
      for (const chunk of decoded) { requireRange(output, target, chunk.length); output.set(chunk, target); target += chunk.length; }
    }
    if (target !== size) throw new Error(`${path} 解压后长度不完整。`);
    return output;
  }

  async readTexture(file, base, headerSize, size, mipCount, path) {
    if (size > 128 * 1024 * 1024 || headerSize > 1024 * 1024 || headerSize < 24 + mipCount * 20 || !Number.isInteger(mipCount) || mipCount < 1 || mipCount > 32) throw new Error(`${path} 的纹理头大小异常。`);
    const table = view(await readRange(file, base + 24, mipCount * 20));
    const mips = Array.from({ length: mipCount }, (_, index) => ({
      offset: table.getUint32(index * 20, true),
      parts: table.getUint32(index * 20 + 16, true),
    }));
    const partCount = mips.reduce((total, mip) => total + mip.parts, 0);
    const sizes = view(await readRange(file, base + 24 + mipCount * 20, partCount * 2));
    const output = new Uint8Array(size), textureHeader = new Uint8Array(await readRange(file, base + headerSize, 80));
    output.set(textureHeader);
    let target = textureHeader.length, sizeIndex = 0;
    for (const mip of mips) {
      let offset = base + headerSize + mip.offset;
      for (let part = 0; part < mip.parts; part++, sizeIndex++) {
        const stride = sizes.getUint16(sizeIndex * 2, true);
        if (stride < 16) throw new Error(`${path} 的纹理压缩块大小异常。`);
        const block = view(await readRange(file, offset, 16));
        const compressed = block.getUint32(8, true), uncompressed = block.getUint32(12, true);
        if (uncompressed > size - target || compressed > stride - 16) throw new Error(`${path} 的纹理压缩块超出范围。`);
        const chunk = new Uint8Array(await readRange(file, offset + 16, compressed === 32000 ? uncompressed : compressed));
        let decoded = chunk;
        if (compressed !== 32000) {
          const stream = new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          decoded = new Uint8Array(await new Response(stream).arrayBuffer());
          if (decoded.length !== uncompressed) throw new Error(`${path} 的纹理压缩块解压后长度不一致。`);
        }
        output.set(decoded, target); target += decoded.length; offset += stride;
      }
    }
    if (target !== size) throw new Error(`${path} 解压后长度不完整。`);
    return output;
  }
}
