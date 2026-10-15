import { createPostgresServices } from '../postgres/services.mjs';
import { OperationError } from '../record-operations.mjs';
export function scopedServices(pool, _guestOwnerId, covers, statistics = null) {
  const factory = session => {
    const userId=session?.userId;
    const services=session ? createPostgresServices(pool,userId,covers,async client=>{
      if(!session)throw new OperationError(401,'AUTH_REQUIRED');
      if(session.legacy)return;
      const result=await client.query(`SELECT s.user_id FROM vinyl.auth_sessions s JOIN vinyl.user_auth a ON a.user_id=s.user_id
        WHERE s.token_digest=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.last_seen_at>clock_timestamp()-interval '1 day'
        AND a.status='active' AND a.auth_version=s.auth_version`,[session.tokenDigest,session.userId]);
      if(!result.rowCount)throw new OperationError(401,'AUTH_REQUIRED');
    },statistics) : {coverStorage:covers,getCollection:async()=>{throw new OperationError(401,'AUTH_REQUIRED');},getWishlist:async()=>{throw new OperationError(401,'AUTH_REQUIRED');}};
    services.publicSalePrice=async()=>Boolean(session && (await pool.query('SELECT show_sale_price FROM vinyl.users WHERE id=$1',[userId])).rows[0]?.show_sale_price);
    services.authorizeList=async section=>{
      if(session)return;
      throw new OperationError(401,'AUTH_REQUIRED');
    };
    services.authorizeCover=async id=>{
      const {rowCount}=await pool.query(`SELECT c.id FROM vinyl.covers c JOIN vinyl.users u ON u.id=c.user_id WHERE c.id=$1 AND (
        EXISTS(SELECT 1 FROM vinyl.collection_records r WHERE r.cover_id=c.id AND r.user_id=c.user_id AND (c.user_id=$2 OR u.collection_public)) OR
        EXISTS(SELECT 1 FROM vinyl.wishlist_records r WHERE r.cover_id=c.id AND r.user_id=c.user_id AND (c.user_id=$2 OR u.wishlist_public)))`,[id,session?.userId || null]);
      if(!rowCount)throw new OperationError(404,'NOT_FOUND');
    };
    return services;
  };
  // A URL selects a read target only; mutation services always use the session UUID.
  factory.profile = async (login, section, session) => {
    const field = {collection:'collection_public',wishlist:'wishlist_public'}[section];
    if (!field) throw new OperationError(404,'NOT_FOUND');
    const {rows} = await pool.query(`SELECT id,login,show_sale_price,${field} AS public FROM vinyl.users WHERE login_normalized=$1`, [login.toLowerCase()]);
    const user = rows[0];
    if (!user) throw new OperationError(404,'NOT_FOUND');
    if (!user.public && session?.userId !== user.id) throw new OperationError(403,'COLLECTION_PRIVATE');
    const services = createPostgresServices(pool,user.id,covers);
    return {login:user.login, showSalePrice:user.show_sale_price, owner:session?.userId === user.id,
      records: () => section === 'wishlist' ? services.getWishlist() : services.getCollection()};
  };
  return factory;
}
