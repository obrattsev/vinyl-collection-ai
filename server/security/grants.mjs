// Run only through separately authorized migration/admin tooling. No runtime DDL.
export function authGrants(runtimeRole, backupRole) {
  for (const role of [runtimeRole,backupRole]) if(!/^[a-z][a-z0-9_]{0,62}$/.test(role))throw Error('Invalid role identifier');
  return `GRANT SELECT ON vinyl.restore_epoch,vinyl.restore_quarantine TO "${runtimeRole}";
GRANT SELECT,INSERT,UPDATE,DELETE ON vinyl.restore_recovery_grants TO "${runtimeRole}";
GRANT SELECT ON vinyl.restore_epoch,vinyl.restore_quarantine,vinyl.restore_recovery_grants TO "${backupRole}";
GRANT INSERT ON vinyl.users,vinyl.login_reservations TO "${runtimeRole}";
GRANT DELETE ON vinyl.users,vinyl.covers TO "${runtimeRole}";
GRANT UPDATE(collection_public,wishlist_public,show_sale_price,updated_at) ON vinyl.users TO "${runtimeRole}";
GRANT SELECT,INSERT,UPDATE,DELETE ON vinyl.cover_cleanup TO "${runtimeRole}";
GRANT SELECT ON vinyl.cover_cleanup TO "${backupRole}";
GRANT SELECT,INSERT,UPDATE,DELETE ON vinyl.user_auth,vinyl.auth_sessions,vinyl.auth_flows,vinyl.auth_challenges,vinyl.auth_rate_limits TO "${runtimeRole}";
GRANT SELECT ON vinyl.user_auth,vinyl.auth_sessions,vinyl.auth_flows,vinyl.auth_challenges,vinyl.auth_rate_limits TO "${backupRole}";`;
}
