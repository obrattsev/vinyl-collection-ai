// Both sections share the same four-criterion search contract.
import { searchCollection, validateSearchCriteria } from './collection-rules.mjs';
export { validateSearchCriteria as validateWishlistCriteria };
export const searchWishlist = (records, criteria = {}) => searchCollection(records, { ...criteria, favoriteOnly: false });
