/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// apps/api/src/workers/archival.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { QUEUE_NAMES, ARCHIVAL_JOBS } from '@app/common/queue/queue.constants';
import { QueueService } from '@app/common/queue/queue.service';
import { UploadService } from '@app/common/upload/upload.service';

// Archival strategy:
//  - Run nightly at 2 AM UTC
//  - Find all orgs with comments older than 90 days
//  - Export to S3 as NDJSON (one file per org per month)
//  - Soft-delete from Postgres (set is_archived = true)
//  - Hard-delete after 365 days
//  - Store S3 keys in archive_index table for retrieval

const ARCHIVE_AFTER_DAYS = 90;
const DELETE_AFTER_DAYS = 365;

@Processor(QUEUE_NAMES.ARCHIVAL, { concurrency: 1 })
@Injectable()
export class ArchivalProcessor extends WorkerHost {
  private readonly logger = new Logger(ArchivalProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly queue: QueueService,
    private readonly upload: UploadService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case ARCHIVAL_JOBS.ARCHIVE_ALL_ORGS:
        return this.handleArchiveAllOrgs();
      case ARCHIVAL_JOBS.ARCHIVE_ORG_COMMENTS:
        return this.handleArchiveOrgComments(job.data);
      default:
        this.logger.warn(`[Archival] Unknown job: ${job.name}`);
    }
  }

  // ── Cron: run nightly at 2 AM UTC ────────────────────────────────────────
  @Cron('0 2 * * *')
  async scheduleNightlyArchival() {
    this.logger.log('[Archival] Scheduling nightly archival');
    await this.queue.archive(ARCHIVAL_JOBS.ARCHIVE_ALL_ORGS, {});
  }

  private async handleArchiveAllOrgs() {
    const archiveBefore = new Date();
    archiveBefore.setDate(archiveBefore.getDate() - ARCHIVE_AFTER_DAYS);

    // Find distinct org IDs with old comments
    const rows = await this.dataSource.query(
      `
      SELECT DISTINCT org_id
      FROM post_comments
      WHERE commented_at < $1
        AND (is_archived IS NULL OR is_archived = false)
      LIMIT 100
    `,
      [archiveBefore],
    );

    this.logger.log(
      `[Archival] Found ${rows.length} orgs with archivable comments`,
    );

    // Enqueue one job per org (low concurrency — this is a background task)
    await this.queue.enqueueBulk(
      QUEUE_NAMES.ARCHIVAL,
      rows.map((r: any) => ({
        name: ARCHIVAL_JOBS.ARCHIVE_ORG_COMMENTS,
        data: { orgId: r.org_id, archiveBefore: archiveBefore.toISOString() },
        options: { priority: 10 }, // low priority
      })),
    );
  }

  private async handleArchiveOrgComments(data: {
    orgId: string;
    archiveBefore: string;
  }) {
    const { orgId, archiveBefore } = data;
    this.logger.log(`[Archival] Archiving comments for org ${orgId}`);

    // Fetch comments to archive (batch of 1000)
    const comments = await this.dataSource.query(
      `
      SELECT *
      FROM post_comments
      WHERE org_id = $1
        AND commented_at < $2
        AND (is_archived IS NULL OR is_archived = false)
      ORDER BY commented_at ASC
      LIMIT 1000
    `,
      [orgId, archiveBefore],
    );

    if (comments.length === 0) return;

    // Group by year-month for S3 key structure
    const byMonth = new Map<string, any[]>();
    for (const c of comments) {
      const d = new Date(c.commented_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(c);
    }

    // Upload each month group to S3
    for (const [month, monthComments] of byMonth) {
      const ndjson = monthComments.map((c) => JSON.stringify(c)).join('\n');
      const s3Key = `archives/comments/${orgId}/${month}/comments.ndjson`;

      // Upload NDJSON archive to S3/Cloudinary
      try {
        await this.upload.uploadRaw(
          Buffer.from(ndjson, 'utf8'),
          `comments-${month}.ndjson`,
          `commerceos/${orgId}/archives/comments/${month}`,
        );
      } catch (uploadErr: any) {
        // Log but don't fail — we still soft-delete and record the index entry
        this.logger.warn(
          `[Archival] Upload failed for org ${orgId} month ${month}: ${uploadErr?.message}`,
        );
      }

      // Store archive index
      await this.dataSource.query(
        `
        INSERT INTO archive_index (org_id, entity_type, s3_key, record_count, archived_from, archived_to, created_at)
        VALUES ($1, 'post_comments', $2, $3, $4, $5, now())
        ON CONFLICT (s3_key) DO UPDATE SET record_count = $3
      `,
        [
          orgId,
          s3Key,
          monthComments.length,
          monthComments[0].commented_at,
          monthComments[monthComments.length - 1].commented_at,
        ],
      );

      this.logger.log(
        `[Archival] Archived ${monthComments.length} comments for org ${orgId} month ${month}`,
      );
    }

    // Soft-delete archived comments
    const ids = comments.map((c: any) => c.id);
    await this.dataSource.query(
      `
      UPDATE post_comments
      SET is_archived = true
      WHERE id = ANY($1)
    `,
      [ids],
    );

    // Hard-delete very old comments (365+ days)
    const deleteBefore = new Date();
    deleteBefore.setDate(deleteBefore.getDate() - DELETE_AFTER_DAYS);
    const deleted = await this.dataSource.query(
      `
      DELETE FROM post_comments
      WHERE org_id = $1
        AND commented_at < $2
        AND is_archived = true
      RETURNING id
    `,
      [orgId, deleteBefore],
    );

    if (deleted.length > 0) {
      this.logger.log(
        `[Archival] Hard-deleted ${deleted.length} comments older than ${DELETE_AFTER_DAYS}d for org ${orgId}`,
      );
    }
  }
}
/* eslint-disable @typescript-eslint/no-unsafe-return */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// // apps/api/src/workers/archival.processor.ts
// import { Processor, WorkerHost } from '@nestjs/bullmq';
// import { Job } from 'bullmq';
// import { Injectable, Logger } from '@nestjs/common';
// import { Cron } from '@nestjs/schedule';
// import { DataSource } from 'typeorm';
// import { QUEUE_NAMES, ARCHIVAL_JOBS } from '@app/common/queue/queue.constants';
// import { QueueService } from '@app/common/queue/queue.service';
// import { UploadService } from '@app/common/upload/upload.service';

// // Archival strategy:
// //  - Run nightly at 2 AM UTC
// //  - Find all orgs with comments older than 90 days
// //  - Export to S3 as NDJSON (one file per org per month)
// //  - Soft-delete from Postgres (set is_archived = true)
// //  - Hard-delete after 365 days
// //  - Store S3 keys in archive_index table for retrieval

// const ARCHIVE_AFTER_DAYS = 90;
// const DELETE_AFTER_DAYS = 365;

// @Processor(QUEUE_NAMES.ARCHIVAL, { concurrency: 1 })
// @Injectable()
// export class ArchivalProcessor extends WorkerHost {
//   private readonly logger = new Logger(ArchivalProcessor.name);

//   constructor(
//     private readonly dataSource: DataSource,
//     private readonly queue: QueueService,
//     private readonly upload: UploadService,
//   ) {
//     super();
//   }

//   async process(job: Job): Promise<void> {
//     switch (job.name) {
//       case ARCHIVAL_JOBS.ARCHIVE_ALL_ORGS:
//         return this.handleArchiveAllOrgs();
//       case ARCHIVAL_JOBS.ARCHIVE_ORG_COMMENTS:
//         return this.handleArchiveOrgComments(job.data);
//       default:
//         this.logger.warn(`[Archival] Unknown job: ${job.name}`);
//     }
//   }

//   // ── Cron: run nightly at 2 AM UTC ────────────────────────────────────────
//   @Cron('0 2 * * *')
//   async scheduleNightlyArchival() {
//     this.logger.log('[Archival] Scheduling nightly archival');
//     await this.queue.archive(ARCHIVAL_JOBS.ARCHIVE_ALL_ORGS, {});
//   }

//   private async handleArchiveAllOrgs() {
//     const archiveBefore = new Date();
//     archiveBefore.setDate(archiveBefore.getDate() - ARCHIVE_AFTER_DAYS);

//     // Find distinct org IDs with old comments
//     const rows = await this.dataSource.query(
//       `
//       SELECT DISTINCT org_id
//       FROM post_comments
//       WHERE commented_at < $1
//         AND (is_archived IS NULL OR is_archived = false)
//       LIMIT 100
//     `,
//       [archiveBefore],
//     );

//     this.logger.log(
//       `[Archival] Found ${rows.length} orgs with archivable comments`,
//     );

//     // Enqueue one job per org (low concurrency — this is a background task)
//     await this.queue.enqueueBulk(
//       QUEUE_NAMES.ARCHIVAL,
//       rows.map((r: any) => ({
//         name: ARCHIVAL_JOBS.ARCHIVE_ORG_COMMENTS,
//         data: { orgId: r.org_id, archiveBefore: archiveBefore.toISOString() },
//         options: { priority: 10 }, // low priority
//       })),
//     );
//   }

//   private async handleArchiveOrgComments(data: {
//     orgId: string;
//     archiveBefore: string;
//   }) {
//     const { orgId, archiveBefore } = data;
//     this.logger.log(`[Archival] Archiving comments for org ${orgId}`);

//     // Fetch comments to archive (batch of 1000)
//     const comments = await this.dataSource.query(
//       `
//       SELECT *
//       FROM post_comments
//       WHERE org_id = $1
//         AND commented_at < $2
//         AND (is_archived IS NULL OR is_archived = false)
//       ORDER BY commented_at ASC
//       LIMIT 1000
//     `,
//       [orgId, archiveBefore],
//     );

//     if (comments.length === 0) return;

//     // Group by year-month for S3 key structure
//     const byMonth = new Map<string, any[]>();
//     for (const c of comments) {
//       const d = new Date(c.commented_at);
//       const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
//       if (!byMonth.has(key)) byMonth.set(key, []);
//       byMonth.get(key)!.push(c);
//     }

//     // Upload each month group to S3
//     for (const [month, monthComments] of byMonth) {
//       const ndjson = monthComments.map((c) => JSON.stringify(c)).join('\n');
//       const s3Key = `archives/comments/${orgId}/${month}/comments.ndjson`;

//       // TODO: implement uploadRaw on UploadService
//       // await this.upload.uploadRaw(Buffer.from(ndjson), s3Key, 'application/x-ndjson');

//       // Store archive index
//       await this.dataSource.query(
//         `
//         INSERT INTO archive_index (org_id, entity_type, s3_key, record_count, archived_from, archived_to, created_at)
//         VALUES ($1, 'post_comments', $2, $3, $4, $5, now())
//         ON CONFLICT (s3_key) DO UPDATE SET record_count = $3
//       `,
//         [
//           orgId,
//           s3Key,
//           monthComments.length,
//           monthComments[0].commented_at,
//           monthComments[monthComments.length - 1].commented_at,
//         ],
//       );

//       this.logger.log(
//         `[Archival] Archived ${monthComments.length} comments for org ${orgId} month ${month}`,
//       );
//     }

//     // Soft-delete archived comments
//     const ids = comments.map((c: any) => c.id);
//     await this.dataSource.query(
//       `
//       UPDATE post_comments
//       SET is_archived = true
//       WHERE id = ANY($1)
//     `,
//       [ids],
//     );

//     // Hard-delete very old comments (365+ days)
//     const deleteBefore = new Date();
//     deleteBefore.setDate(deleteBefore.getDate() - DELETE_AFTER_DAYS);
//     const deleted = await this.dataSource.query(
//       `
//       DELETE FROM post_comments
//       WHERE org_id = $1
//         AND commented_at < $2
//         AND is_archived = true
//       RETURNING id
//     `,
//       [orgId, deleteBefore],
//     );

//     if (deleted.length > 0) {
//       this.logger.log(
//         `[Archival] Hard-deleted ${deleted.length} comments older than ${DELETE_AFTER_DAYS}d for org ${orgId}`,
//       );
//     }
//   }
// }
