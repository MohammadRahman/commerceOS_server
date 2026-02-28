/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/modules/health/health.controller.ts

import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    @InjectDataSource() private dataSource: DataSource,
    @Inject('HEALTH_REDIS') private redis: Redis,
  ) {}

  // GET /health — load balancers, UptimeRobot, k8s readiness
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      // Postgres
      () => this.db.pingCheck('postgres', { connection: this.dataSource }),

      // Redis — direct ping, no extra decorator needed
      async () => {
        try {
          const pong = await this.redis.ping();
          return { redis: { status: pong === 'PONG' ? 'up' : 'down' } };
        } catch {
          return { redis: { status: 'down' } };
        }
      },

      // Memory heap — alert if > 300MB
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),

      // Disk — alert if > 95% used (lower this in prod if you want earlier warning)
      () =>
        this.disk.checkStorage('disk', {
          path: '/',
          thresholdPercent: process.env.NODE_ENV === 'production' ? 0.85 : 0.98,
        }),
    ]);
  }

  // GET /health/live — liveness probe (just "am I alive")
  @Get('live')
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // GET /health/ready — readiness probe (can I serve traffic?)
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.db.pingCheck('postgres', { connection: this.dataSource }),
    ]);
  }
}
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unsafe-return */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// // apps/api/src/modules/health/health.controller.ts

// import { Controller, Get, Inject } from '@nestjs/common';
// import {
//   HealthCheck,
//   HealthCheckService,
//   TypeOrmHealthIndicator,
//   MemoryHealthIndicator,
//   DiskHealthIndicator,
// } from '@nestjs/terminus';
// import { SkipThrottle } from '@nestjs/throttler';
// import { InjectDataSource } from '@nestjs/typeorm';
// import { DataSource } from 'typeorm';
// import type { Redis } from 'ioredis';

// @Controller('health')
// @SkipThrottle()
// export class HealthController {
//   constructor(
//     private health: HealthCheckService,
//     private db: TypeOrmHealthIndicator,
//     private memory: MemoryHealthIndicator,
//     private disk: DiskHealthIndicator,
//     @InjectDataSource() private dataSource: DataSource,
//     @Inject('HEALTH_REDIS') private redis: Redis,
//   ) {}

//   // GET /health — load balancers, UptimeRobot, k8s readiness
//   @Get()
//   @HealthCheck()
//   check() {
//     return this.health.check([
//       // Postgres
//       () => this.db.pingCheck('postgres', { connection: this.dataSource }),

//       // Redis — direct ping, no extra decorator needed
//       async () => {
//         try {
//           const pong = await this.redis.ping();
//           return { redis: { status: pong === 'PONG' ? 'up' : 'down' } };
//         } catch {
//           return { redis: { status: 'down' } };
//         }
//       },

//       // Memory heap — alert if > 300MB
//       () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),

//       // Disk — alert if > 90% used
//       () =>
//         this.disk.checkStorage('disk', { path: '/', thresholdPercent: 0.9 }),
//     ]);
//   }

//   // GET /health/live — liveness probe (just "am I alive")
//   @Get('live')
//   live() {
//     return { status: 'ok', timestamp: new Date().toISOString() };
//   }

//   // GET /health/ready — readiness probe (can I serve traffic?)
//   @Get('ready')
//   @HealthCheck()
//   ready() {
//     return this.health.check([
//       () => this.db.pingCheck('postgres', { connection: this.dataSource }),
//     ]);
//   }
// }
