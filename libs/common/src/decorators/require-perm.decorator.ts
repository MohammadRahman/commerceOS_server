import { Permission } from '@app/common';
import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERM_KEY = 'require_perm';
export const RequirePerm = (perm: Permission) =>
  SetMetadata(REQUIRE_PERM_KEY, perm);
