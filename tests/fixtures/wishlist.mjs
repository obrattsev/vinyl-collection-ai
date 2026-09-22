import { record } from './collection.mjs';
const { purchaseDate, purchaseStore, purchasePrice, ...common } = record;
export const wish = { ...common, storeUrl: 'https://example.com/vinyl' };
export const { id, ...wishDraft } = wish;
export const purchase = { purchaseDate: null, purchaseStore: null, purchasePrice: 0 };
export function memoryRepository(initial = [], kind = 'wishlist') {
  let records = structuredClone(initial);
  const repo = {
    writes: [],
    read: async () => structuredClone(records),
    replace: next => { records = structuredClone(next); },
    appendRecord: async value => { repo.writes.push(['append', value.id]); records.push(structuredClone(value)); },
    deleteRecord: async value => { repo.writes.push(['delete', value.id]); records = records.filter(r => r.id.toLowerCase() !== value.id.toLowerCase()); }
  };
  repo[kind === 'wishlist' ? 'getWishlist' : 'getCollection'] = () => repo.read();
  return repo;
}
