import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, rm, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { UUID } from '../src/base-record.mjs';
import { validCoverId } from '../src/cover-record.mjs';
import { OperationError } from './record-operations.mjs';

export const COVER_MAX_BYTES = 10 * 1024 * 1024;
export const COVER_MAX_PIXELS = 16_000_000;
sharp.cache({ memory: 16, files: 0, items: 16 });
sharp.concurrency(1);

// Server-owned identifiers only. Originals/EXIF and client filenames are never stored.
export function createCoverStorage(directory) {
  if (!directory || !isAbsolute(directory)) throw Error('COVERS_DIR must be absolute');
  const path = id => { if (!id || !validCoverId(id)) throw new OperationError(400, 'INVALID_COVER'); return join(directory, id); };
  const holds = join(directory, '.holds');
  return {
    async prepare(bytes) {
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > COVER_MAX_BYTES) throw new OperationError(400, 'INVALID_COVER');
      let image, thumbnail;
      try {
        const source = sharp(bytes, { limitInputPixels: COVER_MAX_PIXELS, failOn: 'warning', sequentialRead: true });
        const meta = await source.metadata();
        if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) !== 1) throw Error('format');
        image = await source.autoOrient().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        thumbnail = await sharp(image).resize({ width: 144, height: 144, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
      } catch { throw new OperationError(400, 'INVALID_COVER'); }
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const id = randomUUID(), temporary = join(directory, `.prepare-${id}`);
      try {
        await mkdir(temporary, { mode: 0o700 });
        await writeFile(join(temporary, 'image.webp'), image, { mode: 0o600, flag: 'wx' });
        await writeFile(join(temporary, 'thumb.webp'), thumbnail, { mode: 0o600, flag: 'wx' });
        await rename(temporary, path(id));
      } catch { await rm(temporary, { recursive: true, force: true }); throw new OperationError(503, 'COVER_STORAGE_UNAVAILABLE'); }
      return id;
    },
    async read(id, size) {
      if (!['image.webp', 'thumb.webp'].includes(size)) throw new OperationError(404, 'NOT_FOUND');
      try { return await readFile(join(path(id), size)); }
      catch { throw new OperationError(404, 'NOT_FOUND'); }
    },
    // A durable hold is written BEFORE attempting Sheets. Unknown outcomes and crashes
    // retain both objects, even after restart. Never infer failure from a missing row.
    async hold(ids) {
      if (ids.some(id => !validCoverId(id))) throw new OperationError(400, 'INVALID_COVER');
      await mkdir(holds, { recursive: true, mode: 0o700 });
      const token = randomUUID();
      await writeFile(join(holds, token), JSON.stringify(ids.filter(Boolean)), { mode: 0o600, flag: 'wx' });
      return token;
    },
    async release(token) {
      if (!UUID.test(token)) throw Error('Invalid hold');
      await rm(join(holds, token));
    },
    async removeUnreferenced(id, records) {
      if (!id || records.some(record => record.coverId === id)) return;
      // Fail closed: unreadable/corrupt hold metadata must prevent cleanup.
      for (const token of await readdir(holds)) {
        const ids = JSON.parse(await readFile(join(holds, token), 'utf8'));
        if (!Array.isArray(ids) || ids.some(value => !value || !validCoverId(value))) throw Error('Invalid hold');
        if (ids.includes(id)) return;
      }
      await rm(path(id), { recursive: true, force: true });
    }
  };
}
