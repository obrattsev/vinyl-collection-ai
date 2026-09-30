import { createReportService } from '../server/bug-reports.mjs';
// Isolated, disposable acceptance server: no .env, Google client or persistent data.
import { createApp } from '../server/app.mjs';
import { createAuth, hashPassword } from '../server/auth.mjs';
import { createCollectionService } from '../server/collection-service.mjs';
import { createWishlistService } from '../server/wishlist-service.mjs';
import { createTransferService } from '../server/transfer-service.mjs';
import { createWriteQueue } from '../server/record-operations.mjs';
import { record } from '../tests/fixtures/collection.mjs';
import { wish } from '../tests/fixtures/wishlist.mjs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCoverStorage } from '../server/cover-storage.mjs';
import { createPresentationService } from '../server/presentation-service.mjs';

const port = 8013;
const origin = `http://127.0.0.1:${port}`;
const password = 'local-acceptance-only';
const directory = await mkdtemp(join(tmpdir(), 'vinyl-3d-acceptance-'));
const covers = createCoverStorage(join(directory, 'covers'));
const sample = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#bf7557"/><circle cx="300" cy="280" r="205" fill="#243c48"/><circle cx="300" cy="280" r="55" fill="#f5d7a0"/><text x="300" y="555" text-anchor="middle" font-size="40" fill="#ffffff">LOCAL TEST</text></svg>');
const png = await sharp(sample).png().toBuffer();
const existingCover = await covers.prepare(png);
for (const format of ['png', 'jpeg', 'webp']) await writeFile(join(directory, `sample.${format}`), await sharp(png).rotate(90).toFormat(format).toBuffer(), { mode: 0o600 });
function memory(initial, readName) {
  let records = structuredClone(initial);
  return {
    [readName]: async () => structuredClone(records),
    appendRecord: async value => { records.push(structuredClone(value)); },
    updateRecord: async value => { records = records.map(r => r.id === value.id ? structuredClone(value) : r); },
    deleteRecord: async value => { records = records.filter(r => r.id !== value.id); }
  };
}
const collection = memory([
  { ...record, artist: 'Zebra', album: 'Late', albumYear: '2000', genre: 'Legacy genre', coverId: existingCover, favorite: true },
  { ...record, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', artist: 'Alpha', album: 'Second', albumYear: '1990', genre: 'Various', recordYear: null, note: '=1+1' },
  { ...record, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', artist: 'Alpha', album: 'First', albumYear: '1980', genre: 'New Age', note: 'Текст; "кавычки"\nНовая строка' }
], 'getCollection');
const wishlist = memory([
  { ...wish, artist: 'Wish Zebra', album: 'Wish Late', genre: 'Legacy genre', coverId: existingCover },
  { ...wish, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', artist: 'Wish Alpha', album: 'Wish First', genre: 'New Age', additionalGenre: 'Various' }
], 'getWishlist');
const serial = createWriteQueue();
const auth = createAuth({ passwordHash: await hashPassword(password), origin, production: false });
const server = createApp({ ...createCollectionService(collection, serial), ...createWishlistService(wishlist, collection, serial),
  createReport: createReportService(memory([], 'getRecords')),
  transferRecord: createTransferService(wishlist, collection, serial, covers),
  ...createPresentationService({ collection, wishlist, covers, serial }) }, { auth });
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Порт ${port} занят. Остановите предыдущий acceptance-сервер.` : 'Не удалось запустить acceptance-сервер.'); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Локальный acceptance 3D: ${origin}/collection\nПароль: ${password}\nЗаписи и reports вымышленные, в памяти; цитаты — согласованный каталог. Перезапуск сбрасывает изменения.\nТестовые изображения и временное хранилище: ${directory}`));
