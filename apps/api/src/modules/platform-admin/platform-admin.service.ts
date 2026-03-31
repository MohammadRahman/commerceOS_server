/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/modules/platform-admin/platform-admin.service.ts

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, MoreThanOrEqual } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { OrganizationEntity } from '../tenancy/entities/organization.entity';
import { UserEntity } from '../tenancy/entities/user.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { ChannelEntity } from '../inbox/entities/channel.entity';

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  createdAt: Date;
  userCount: number;
  orderCount: number;
  channelCount: number;
  mrr: number;
  featureFlags: Record<string, boolean>;
}

export interface PlatformOverview {
  totalOrgs: number;
  activeOrgs: number;
  totalUsers: number;
  totalOrders: number;
  totalRevenue: number;
  mrr: number;
  newOrgsThisMonth: number;
  newOrdersThisMonth: number;
}

@Injectable()
export class PlatformAdminService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private orgs: Repository<OrganizationEntity>,
    @InjectRepository(UserEntity)
    private users: Repository<UserEntity>,
    @InjectRepository(OrderEntity)
    private orders: Repository<OrderEntity>,
    @InjectRepository(ChannelEntity)
    private channels: Repository<ChannelEntity>,
    private dataSource: DataSource,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  // ── Overview ───────────────────────────────────────────────────────────────

  async getOverview(): Promise<PlatformOverview> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalOrgs,
      activeOrgs,
      totalUsers,
      totalOrders,
      newOrgsThisMonth,
      newOrdersThisMonth,
    ] = await Promise.all([
      this.orgs.count(),
      this.orgs.count({ where: { isActive: true } as any }),
      this.users.count(),
      this.orders.count(),
      this.orgs.count({
        where: { createdAt: MoreThanOrEqual(monthStart) },
      } as any),
      this.orders.count({
        where: { createdAt: MoreThanOrEqual(monthStart) },
      } as any),
    ]);

    // Revenue from orders
    const revenueResult = await this.dataSource.query(
      `SELECT COALESCE(SUM(total), 0) as total FROM orders`,
    );
    const totalRevenue = Number(revenueResult[0]?.total ?? 0);

    // MRR from subscriptions if table exists, else estimate from this month's orders
    let mrr = 0;
    try {
      const mrrResult = await this.dataSource.query(
        `SELECT COALESCE(SUM(amount), 0) as mrr FROM subscriptions WHERE status = 'active'`,
      );
      mrr = Number(mrrResult[0]?.mrr ?? 0);
    } catch {
      // subscriptions table may not exist yet
      const mrrFallback = await this.dataSource.query(
        `SELECT COALESCE(SUM(total), 0) as mrr FROM orders WHERE created_at >= $1`,
        [monthStart],
      );
      mrr = Number(mrrFallback[0]?.mrr ?? 0);
    }

    return {
      totalOrgs,
      activeOrgs,
      totalUsers,
      totalOrders,
      totalRevenue,
      mrr,
      newOrgsThisMonth,
      newOrdersThisMonth,
    };
  }

  // ── Org list ───────────────────────────────────────────────────────────────

  async listOrgs(
    page = 1,
    limit = 20,
    search?: string,
  ): Promise<{
    data: OrgSummary[];
    total: number;
    page: number;
    limit: number;
  }> {
    const qb = this.orgs.createQueryBuilder('org');
    if (search) {
      qb.where('org.name ILIKE :search OR org.slug ILIKE :search', {
        search: `%${search}%`,
      });
    }
    qb.orderBy('org.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rawOrgs, total] = await qb.getManyAndCount();

    // Batch load counts for all orgs in one query each
    const orgIds = rawOrgs.map((o) => o.id);

    const [userCounts, orderCounts, channelCounts] = await Promise.all([
      orgIds.length
        ? this.dataSource.query(
            `SELECT org_id, COUNT(*)::int as count FROM users WHERE org_id = ANY($1) GROUP BY org_id`,
            [orgIds],
          )
        : [],
      orgIds.length
        ? this.dataSource.query(
            `SELECT org_id, COUNT(*)::int as count FROM orders WHERE org_id = ANY($1) GROUP BY org_id`,
            [orgIds],
          )
        : [],
      orgIds.length
        ? this.dataSource.query(
            `SELECT org_id, COUNT(*)::int as count FROM channels WHERE org_id = ANY($1) GROUP BY org_id`,
            [orgIds],
          )
        : [],
    ]);

    const userMap = Object.fromEntries(
      userCounts.map((r: any) => [r.org_id, r.count]),
    );
    const orderMap = Object.fromEntries(
      orderCounts.map((r: any) => [r.org_id, r.count]),
    );
    const channelMap = Object.fromEntries(
      channelCounts.map((r: any) => [r.org_id, r.count]),
    );

    const data: OrgSummary[] = rawOrgs.map((org) => ({
      id: org.id,
      name: org.name,
      slug: (org as any).slug ?? '',
      plan: (org as any).plan ?? 'free',
      isActive: (org as any).isActive ?? true,
      createdAt: org.createdAt,
      userCount: userMap[org.id] ?? 0,
      orderCount: orderMap[org.id] ?? 0,
      channelCount: channelMap[org.id] ?? 0,
      mrr: (org as any).mrr ?? 0,
      featureFlags: (org as any).featureFlags ?? {},
    }));

    return { data, total, page, limit };
  }

  // ── Single org ─────────────────────────────────────────────────────────────

  async getOrg(
    orgId: string,
  ): Promise<OrgSummary & { users: any[]; recentOrders: any[] }> {
    const org = await this.orgs.findOneOrFail({ where: { id: orgId } as any });

    const [users, recentOrders, channelCount] = await Promise.all([
      this.users.find({
        where: { orgId } as any,
        order: { createdAt: 'DESC' } as any,
        take: 50,
      }),
      this.orders.find({
        where: { orgId } as any,
        order: { createdAt: 'DESC' } as any,
        take: 10,
      }),
      this.channels.count({ where: { orgId } as any }),
    ]);

    return {
      id: org.id,
      name: org.name,
      slug: (org as any).slug ?? '',
      plan: (org as any).plan ?? 'free',
      isActive: (org as any).isActive ?? true,
      createdAt: org.createdAt,
      userCount: users.length,
      orderCount: recentOrders.length,
      channelCount,
      mrr: (org as any).mrr ?? 0,
      featureFlags: (org as any).featureFlags ?? {},
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
      })),
      recentOrders,
    };
  }

  // ── Feature flags ──────────────────────────────────────────────────────────

  async setFeatureFlags(
    orgId: string,
    flags: Record<string, boolean>,
  ): Promise<void> {
    const org = await this.orgs.findOneOrFail({ where: { id: orgId } as any });
    const current = (org as any).featureFlags ?? {};
    await this.orgs.update(
      { id: orgId } as any,
      { featureFlags: { ...current, ...flags } } as any,
    );
  }

  // ── Toggle org active ──────────────────────────────────────────────────────

  async setOrgActive(orgId: string, isActive: boolean): Promise<void> {
    await this.orgs.update({ id: orgId } as any, { isActive } as any);
  }

  // ── Impersonate ────────────────────────────────────────────────────────────
  // Returns a short-lived JWT scoped to the target org's owner.
  // The impersonation token expires in 1 hour and includes an `impersonatedBy`
  // field for audit logging.

  async impersonate(
    orgId: string,
    adminUserId: string,
  ): Promise<{ token: string; expiresIn: number }> {
    // Find the owner of the target org
    const owner = await this.users.findOne({
      where: { orgId, role: 'OWNER' as any } as any,
    });

    if (!owner) {
      throw new Error('No owner found for this organization');
    }

    const secret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    const expiresIn = 3600; // 1 hour

    const token = this.jwt.sign(
      {
        sub: owner.id,
        orgId: owner.orgId,
        role: owner.role,
        isPlatformAdmin: false,
        impersonatedBy: adminUserId,
        impersonation: true,
      },
      { secret, expiresIn },
    );

    return { token, expiresIn };
  }

  // ── System health ──────────────────────────────────────────────────────────

  async getSystemHealth(): Promise<{
    database: 'ok' | 'error';
    latencyMs: number;
    totalOrgs: number;
    uptime: number;
  }> {
    const start = Date.now();
    let database: 'ok' | 'error' = 'ok';

    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      database = 'error';
    }

    const latencyMs = Date.now() - start;

    return {
      database,
      latencyMs,
      totalOrgs: await this.orgs.count(),
      uptime: process.uptime(),
    };
  }

  // ── Subscriptions overview ─────────────────────────────────────────────────

  async getSubscriptions(): Promise<any[]> {
    try {
      return await this.dataSource.query(
        `SELECT s.*, o.name as org_name
         FROM subscriptions s
         JOIN organizations o ON o.id = s.org_id
         ORDER BY s.created_at DESC
         LIMIT 100`,
      );
    } catch {
      // Table doesn't exist yet — return empty
      return [];
    }
  }
}
