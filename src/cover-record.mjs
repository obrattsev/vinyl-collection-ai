import { UUID } from './base-record.mjs';

export const validCoverId = value => value === null || (typeof value === 'string' && value === value.toLowerCase() && UUID.test(value));
export function coverPresentation(id) {
  return id && validCoverId(id) ? { thumbnailUrl: `/media/covers/${id}/thumb.webp`, imageUrl: `/media/covers/${id}/image.webp` } : null;
}
export function validPublicCover(cover) {
  if (cover === null) return true;
  if (!cover || typeof cover !== 'object' || Object.keys(cover).length !== 2) return false;
  const match = /^\/media\/covers\/([^/]+)\/thumb\.webp$/.exec(cover.thumbnailUrl);
  return Boolean(match && validCoverId(match[1]) && cover.imageUrl === `/media/covers/${match[1]}/image.webp`);
}
