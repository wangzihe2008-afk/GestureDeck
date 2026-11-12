import { readdir, readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = table[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// Small, portable ZIP writer; no shell tools or extra runtime dependencies.
export async function zipDirectory(directory, exclude = () => false, prefix = '') {
  const local = [],
    central = [];
  let offset = 0,
    count = 0;
  async function walk(dir, relative = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (exclude(rel, entry)) continue;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = await readFile(path.join(dir, entry.name));
      const compressed = deflateRawSync(bytes, { level: 6 });
      const name = Buffer.from(prefix + rel, 'utf8');
      const crc = crc32(bytes);
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0x800, 6);
      header.writeUInt16LE(8, 8);
      header.writeUInt16LE(33, 12);
      header.writeUInt32LE(crc, 14);
      header.writeUInt32LE(compressed.length, 18);
      header.writeUInt32LE(bytes.length, 22);
      header.writeUInt16LE(name.length, 26);
      local.push(header, name, compressed);
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50);
      record.writeUInt16LE(20, 4);
      record.writeUInt16LE(20, 6);
      record.writeUInt16LE(0x800, 8);
      record.writeUInt16LE(8, 10);
      record.writeUInt16LE(33, 14);
      record.writeUInt32LE(crc, 16);
      record.writeUInt32LE(compressed.length, 20);
      record.writeUInt32LE(bytes.length, 24);
      record.writeUInt16LE(name.length, 28);
      record.writeUInt32LE(offset, 42);
      central.push(record, name);
      offset += header.length + name.length + compressed.length;
      count++;
    }
  }
  await walk(directory);
  const directoryBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryBytes, end]);
}
