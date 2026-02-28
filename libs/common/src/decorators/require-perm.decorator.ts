/**
 * libs/common/src/decorators/require-perm.decorator.ts
 */
import { SetMetadata } from '@nestjs/common';
import { Permission } from '../constants/permissions';

export const REQUIRE_PERM_KEY = 'require_perm';
export const RequirePerm = (permission: Permission) =>
  SetMetadata(REQUIRE_PERM_KEY, permission);
// import { Permission } from '@app/common';
// import { SetMetadata } from '@nestjs/common';

// export const REQUIRE_PERM_KEY = 'require_perm';
// export const RequirePerm = (perm: Permission) =>
//   SetMetadata(REQUIRE_PERM_KEY, perm);
