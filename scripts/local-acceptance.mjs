// Isolated, disposable acceptance server: no .env, Google client or persistent data.
import { createApp } from '../server/app.mjs';
import { createAuth, hashPassword } from '../server/auth.mjs';
import { createCollectionService } from '../server/collection-service.mjs';
import { createWishlistService } from '../server/wishlist-service.mjs';
import { createTransferService } from '../server/transfer-service.mjs';
import { createWriteQueue } from '../server/record-operations.mjs';
import { record } from '../tests/fixtures/collection.mjs';
import { wish } from '../tests/fixtures/wishlist.mjs';

const port = 8013;
const origin = `http://127.0.0.1:${port}`;
const password = 'local-acceptance-only';
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
  { ...record, artist: 'Zebra', album: 'Late', albumYear: '2000', genre: 'Legacy genre' },
  { ...record, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', artist: 'Alpha', album: 'Second', albumYear: '1990', genre: 'Various', recordYear: null, note: '=1+1' },
  { ...record, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', artist: 'Alpha', album: 'First', albumYear: '1980', genre: 'New Age', note: 'Текст; "кавычки"\nНовая строка' }
], 'getCollection');
const wishlist = memory([
  { ...wish, artist: 'Wish Zebra', album: 'Wish Late', genre: 'Legacy genre' },
  { ...wish, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', artist: 'Wish Alpha', album: 'Wish First', genre: 'New Age', additionalGenre: 'Various' }
], 'getWishlist');
const serial = createWriteQueue();
const auth = createAuth({ passwordHash: await hashPassword(password), origin, production: false });
const server = createApp({ ...createCollectionService(collection, serial), ...createWishlistService(wishlist, collection, serial),
  transferRecord: createTransferService(wishlist, collection, serial) }, { auth });
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Порт ${port} занят. Остановите предыдущий acceptance-сервер.` : 'Не удалось запустить acceptance-сервер.'); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Локальный acceptance: ${origin}/collection\nПароль: ${password}\nТолько вымышленные данные в памяти. Перезапуск сбрасывает изменения.`));
