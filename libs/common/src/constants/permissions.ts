/**
 * libs/common/src/constants/permissions.ts
 *
 * SINGLE SOURCE OF TRUTH for all role-based permissions.
 * The RbacGuard reads this. Add @RequirePerm('resource:action') to any endpoint.
 *
 * Role strings match UserRole enum exactly (UPPERCASE):
 *   OWNER  — full access to everything
 *   ADMIN  — team management + read-only integrations, NO billing/security/access
 *   AGENT  — read-only on settings, full inbox + orders only
 */

export type Permission = string; // "resource:action"

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  // ── OWNER: everything ─────────────────────────────────────────────────────
  OWNER: [
    'org:read',
    'org:write',
    'team:read',
    'team:write',
    'team:delete',
    'team:manage',
    'channels:read',
    'channels:write',
    'channels:delete',
    'payments:read',
    'payments:write',
    'couriers:read',
    'couriers:write',
    'orders:read',
    'orders:write',
    'inbox:read',
    'inbox:write',
    'analytics:read',
    'billing:read',
    'billing:write',
    'security:read',
    'security:write',
    'access:read',
    'access:write',
    'shipments:write',
    'bookkeeping:write',
    'bookkeeping:read',
  ],

  // ── ADMIN: team mgmt + view-only integrations, NO billing/security/access ─
  ADMIN: [
    'org:read',
    'team:read',
    'team:write',
    'team:delete',
    'channels:read',
    'payments:read',
    'couriers:read',
    'orders:read',
    'orders:write',
    'inbox:read',
    'inbox:write',
    'analytics:read',
    // NOT allowed: org:write, channels:write, payments:write, couriers:write,
    //              team:manage, billing, security, access
  ],

  // ── AGENT: read-only settings, full inbox + orders ────────────────────────
  AGENT: [
    'org:read',
    'team:read',
    'channels:read',
    'payments:read',
    'couriers:read',
    'orders:read',
    'orders:write',
    'inbox:read',
    'inbox:write',
    'analytics:read',
    // NOT allowed: any write on settings, billing, security, access, team:write
  ],
};
// export type Permission =
//   | 'inbox:read'
//   | 'inbox:write'
//   | 'orders:read'
//   | 'orders:write'
//   | 'payments:write'
//   | 'shipments:write'
//   | 'reports:read'
//   | 'admin:manage';

// export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
//   OWNER: [
//     'admin:manage',
//     'inbox:read',
//     'inbox:write',
//     'orders:read',
//     'orders:write',
//     'payments:write',
//     'shipments:write',
//     'reports:read',
//   ],
//   ADMIN: [
//     'inbox:read',
//     'inbox:write',
//     'orders:read',
//     'orders:write',
//     'payments:write',
//     'shipments:write',
//     'reports:read',
//   ],
//   AGENT: ['inbox:read', 'inbox:write', 'orders:read', 'orders:write'],
// };
