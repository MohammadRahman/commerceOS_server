/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { OrgContext } from '../types/request-context';

export const Ctx = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): OrgContext => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as OrgContext;
  },
);

export const OrgId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    return req.user?.orgId;
  },
);

export const UserId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    return req.user?.userId;
  },
);
