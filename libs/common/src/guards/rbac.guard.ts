/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERM_KEY } from '../decorators/require-perm.decorator';
import { Permission, ROLE_PERMISSIONS } from '@app/common';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission>(
      REQUIRE_PERM_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) return true;

    const req = context.switchToHttp().getRequest();
    const role = req.user?.role;
    if (!role) throw new ForbiddenException('Missing role');

    const perms = ROLE_PERMISSIONS[role] ?? [];
    if (!perms.includes(required)) {
      throw new ForbiddenException(`Missing permission: ${required}`);
    }

    return true;
  }
}
