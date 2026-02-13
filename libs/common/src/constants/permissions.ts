export type Permission =
  | 'inbox:read'
  | 'inbox:write'
  | 'orders:read'
  | 'orders:write'
  | 'payments:write'
  | 'shipments:write'
  | 'reports:read'
  | 'admin:manage';

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  OWNER: [
    'admin:manage',
    'inbox:read',
    'inbox:write',
    'orders:read',
    'orders:write',
    'payments:write',
    'shipments:write',
    'reports:read',
  ],
  ADMIN: [
    'inbox:read',
    'inbox:write',
    'orders:read',
    'orders:write',
    'payments:write',
    'shipments:write',
    'reports:read',
  ],
  AGENT: ['inbox:read', 'inbox:write', 'orders:read', 'orders:write'],
};
