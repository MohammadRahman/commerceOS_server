/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/modules/storefront/cloudflare-dns.service.ts
//
// Manages merchant subdomains via Cloudflare API.
// When a merchant's store is created, automatically provisions:
//   {slug}.xenlo.app → commerceos-ui.vercel.app (proxied via Cloudflare)
//
// Env vars required:
//   CLOUDFLARE_API_TOKEN  — Cloudflare API token with DNS:Edit permission
//   CLOUDFLARE_ZONE_ID    — Zone ID for xenlo.app (from Cloudflare dashboard)
//   VERCEL_APP_CNAME      — e.g. commerceos-ui.vercel.app

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface SubdomainStatus {
  subdomain: string; // e.g. ahmed-store
  fqdn: string; // ahmed-store.xenlo.app
  active: boolean;
  proxied: boolean; // true = Cloudflare protection active
  recordId?: string; // Cloudflare DNS record ID for future updates/deletes
}

@Injectable()
export class CloudflareDnsService {
  private readonly logger = new Logger(CloudflareDnsService.name);
  private readonly BASE = 'https://api.cloudflare.com/client/v4';

  constructor(
    private config: ConfigService,
    private http: HttpService,
  ) {}

  private get token(): string {
    return this.config.getOrThrow('CLOUDFLARE_API_TOKEN');
  }
  private get zoneId(): string {
    return this.config.getOrThrow('CLOUDFLARE_ZONE_ID');
  }
  private get cname(): string {
    return this.config.get('VERCEL_APP_CNAME') ?? 'commerceos-ui.vercel.app';
  }
  private get baseDomain(): string {
    return this.config.get('PLATFORM_DOMAIN') ?? 'xenlo.app';
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  // ── Create subdomain ───────────────────────────────────────────────────────

  /**
   * Creates {slug}.xenlo.app → commerceos-ui.vercel.app
   * Proxied through Cloudflare — merchant gets DDoS protection + CDN for free.
   * Takes ~30 seconds to propagate.
   */
  async createSubdomain(slug: string): Promise<SubdomainStatus> {
    if (!this.isValidSlug(slug)) {
      throw new BadRequestException(`Invalid slug: ${slug}`);
    }

    const fqdn = `${slug}.${this.baseDomain}`;

    // Check if already exists
    const existing = await this.findRecord(slug);
    if (existing) {
      this.logger.log(
        `Subdomain ${fqdn} already exists (record: ${existing.id})`,
      );
      return {
        subdomain: slug,
        fqdn,
        active: true,
        proxied: existing.proxied,
        recordId: existing.id,
      };
    }

    try {
      const res = await firstValueFrom(
        this.http.post(
          `${this.BASE}/zones/${this.zoneId}/dns_records`,
          {
            type: 'CNAME',
            name: slug, // Cloudflare adds .xenlo.app automatically
            content: this.cname, // → commerceos-ui.vercel.app
            proxied: true, // Enable Cloudflare proxy (DDoS + CDN)
            ttl: 1, // Auto TTL when proxied
            comment: `CommerceOS merchant store — ${slug}`,
          },
          { headers: this.headers() },
        ),
      );

      const record = res.data?.result;
      this.logger.log(
        `Created subdomain ${fqdn} → ${this.cname} (id: ${record?.id})`,
      );

      return {
        subdomain: slug,
        fqdn,
        active: true,
        proxied: true,
        recordId: record?.id,
      };
    } catch (err: any) {
      const cfError = err?.response?.data?.errors?.[0];
      this.logger.error(
        `Failed to create subdomain ${slug}:`,
        cfError ?? err?.message,
      );
      throw new BadRequestException(
        cfError?.message ?? 'Failed to create subdomain',
      );
    }
  }

  // ── Delete subdomain ───────────────────────────────────────────────────────

  /**
   * Removes {slug}.xenlo.app DNS record.
   * Called when a merchant deletes their store or changes their slug.
   */
  async deleteSubdomain(slug: string): Promise<void> {
    const record = await this.findRecord(slug);
    if (!record) {
      this.logger.warn(
        `Subdomain ${slug}.${this.baseDomain} not found — nothing to delete`,
      );
      return;
    }

    try {
      await firstValueFrom(
        this.http.delete(
          `${this.BASE}/zones/${this.zoneId}/dns_records/${record.id}`,
          { headers: this.headers() },
        ),
      );
      this.logger.log(`Deleted subdomain ${slug}.${this.baseDomain}`);
    } catch (err: any) {
      this.logger.warn(
        `Failed to delete subdomain ${slug}:`,
        err?.response?.data,
      );
    }
  }

  // ── Get status ─────────────────────────────────────────────────────────────

  async getSubdomainStatus(slug: string): Promise<SubdomainStatus> {
    const record = await this.findRecord(slug);
    const fqdn = `${slug}.${this.baseDomain}`;

    if (!record) {
      return { subdomain: slug, fqdn, active: false, proxied: false };
    }

    return {
      subdomain: slug,
      fqdn,
      active: true,
      proxied: record.proxied,
      recordId: record.id,
    };
  }

  // ── Rename subdomain ───────────────────────────────────────────────────────

  /**
   * Called when merchant changes their store slug.
   * Creates new record first, then deletes old one.
   */
  async renameSubdomain(
    oldSlug: string,
    newSlug: string,
  ): Promise<SubdomainStatus> {
    const newStatus = await this.createSubdomain(newSlug);
    await this.deleteSubdomain(oldSlug);
    return newStatus;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async findRecord(
    slug: string,
  ): Promise<{ id: string; proxied: boolean } | null> {
    try {
      const res = await firstValueFrom(
        this.http.get(`${this.BASE}/zones/${this.zoneId}/dns_records`, {
          headers: this.headers(),
          params: { type: 'CNAME', name: `${slug}.${this.baseDomain}` },
        }),
      );

      const records = res.data?.result ?? [];
      if (records.length === 0) return null;
      return { id: records[0].id, proxied: records[0].proxied };
    } catch {
      return null;
    }
  }

  private isValidSlug(slug: string): boolean {
    // Only lowercase letters, numbers, hyphens. No dots, no underscores.
    return /^[a-z0-9-]{2,80}$/.test(slug);
  }
}
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// // apps/api/src/modules/storefront/cloudflare-dns.service.ts
// //
// // Manages merchant subdomains via Cloudflare API.
// // When a merchant's store is created, automatically provisions:
// //   {slug}.xenlo.app → commerceos-ui.vercel.app (proxied via Cloudflare)
// //
// // Env vars required:
// //   CLOUDFLARE_API_TOKEN  — Cloudflare API token with DNS:Edit permission
// //   CLOUDFLARE_ZONE_ID    — Zone ID for xenlo.app (from Cloudflare dashboard)
// //   VERCEL_APP_CNAME      — e.g. commerceos-ui.vercel.app

// import { Injectable, Logger, BadRequestException } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { HttpService } from '@nestjs/axios';
// import { firstValueFrom } from 'rxjs';

// export interface SubdomainStatus {
//   subdomain: string; // e.g. ahmed-store
//   fqdn: string; // ahmed-store.xenlo.app
//   active: boolean;
//   proxied: boolean; // true = Cloudflare protection active
//   recordId?: string; // Cloudflare DNS record ID for future updates/deletes
// }

// @Injectable()
// export class CloudflareDnsService {
//   private readonly logger = new Logger(CloudflareDnsService.name);
//   private readonly BASE = 'https://api.cloudflare.com/client/v4';

//   constructor(
//     private config: ConfigService,
//     private http: HttpService,
//   ) {}

//   private get token(): string {
//     return this.config.getOrThrow('CLOUDFLARE_API_TOKEN');
//   }
//   private get zoneId(): string {
//     return this.config.getOrThrow('CLOUDFLARE_ZONE_ID');
//   }
//   private get cname(): string {
//     return this.config.get('VERCEL_APP_CNAME') ?? 'commerceos-ui.vercel.app';
//   }
//   private get baseDomain(): string {
//     return this.config.get('PLATFORM_DOMAIN') ?? 'xenlo.app';
//   }

//   private headers() {
//     return {
//       Authorization: `Bearer ${this.token}`,
//       'Content-Type': 'application/json',
//     };
//   }

//   // ── Create subdomain ───────────────────────────────────────────────────────

//   /**
//    * Creates {slug}.xenlo.app → commerceos-ui.vercel.app
//    * Proxied through Cloudflare — merchant gets DDoS protection + CDN for free.
//    * Takes ~30 seconds to propagate.
//    */
//   async createSubdomain(slug: string): Promise<SubdomainStatus> {
//     if (!this.isValidSlug(slug)) {
//       throw new BadRequestException(`Invalid slug: ${slug}`);
//     }

//     const fqdn = `${slug}.${this.baseDomain}`;

//     // Check if already exists
//     const existing = await this.findRecord(slug);
//     if (existing) {
//       this.logger.log(
//         `Subdomain ${fqdn} already exists (record: ${existing.id})`,
//       );
//       return {
//         subdomain: slug,
//         fqdn,
//         active: true,
//         proxied: existing.proxied,
//         recordId: existing.id,
//       };
//     }

//     try {
//       const res = await firstValueFrom(
//         this.http.post(
//           `${this.BASE}/zones/${this.zoneId}/dns_records`,
//           {
//             type: 'CNAME',
//             name: slug, // Cloudflare adds .xenlo.app automatically
//             content: this.cname, // → commerceos-ui.vercel.app
//             proxied: true, // Enable Cloudflare proxy (DDoS + CDN)
//             ttl: 1, // Auto TTL when proxied
//             comment: `CommerceOS merchant store — ${slug}`,
//           },
//           { headers: this.headers() },
//         ),
//       );

//       const record = res.data?.result;
//       this.logger.log(
//         `Created subdomain ${fqdn} → ${this.cname} (id: ${record?.id})`,
//       );

//       return {
//         subdomain: slug,
//         fqdn,
//         active: true,
//         proxied: true,
//         recordId: record?.id,
//       };
//     } catch (err: any) {
//       const cfError = err?.response?.data?.errors?.[0];
//       this.logger.error(
//         `Failed to create subdomain ${slug}:`,
//         cfError ?? err?.message,
//       );
//       throw new BadRequestException(
//         cfError?.message ?? 'Failed to create subdomain',
//       );
//     }
//   }

//   // ── Delete subdomain ───────────────────────────────────────────────────────

//   /**
//    * Removes {slug}.xenlo.app DNS record.
//    * Called when a merchant deletes their store or changes their slug.
//    */
//   async deleteSubdomain(slug: string): Promise<void> {
//     const record = await this.findRecord(slug);
//     if (!record) {
//       this.logger.warn(
//         `Subdomain ${slug}.${this.baseDomain} not found — nothing to delete`,
//       );
//       return;
//     }

//     try {
//       await firstValueFrom(
//         this.http.delete(
//           `${this.BASE}/zones/${this.zoneId}/dns_records/${record.id}`,
//           { headers: this.headers() },
//         ),
//       );
//       this.logger.log(`Deleted subdomain ${slug}.${this.baseDomain}`);
//     } catch (err: any) {
//       this.logger.warn(
//         `Failed to delete subdomain ${slug}:`,
//         err?.response?.data,
//       );
//     }
//   }

//   // ── Get status ─────────────────────────────────────────────────────────────

//   async getSubdomainStatus(slug: string): Promise<SubdomainStatus> {
//     const record = await this.findRecord(slug);
//     const fqdn = `${slug}.${this.baseDomain}`;

//     if (!record) {
//       return { subdomain: slug, fqdn, active: false, proxied: false };
//     }

//     return {
//       subdomain: slug,
//       fqdn,
//       active: true,
//       proxied: record.proxied,
//       recordId: record.id,
//     };
//   }

//   // ── Rename subdomain ───────────────────────────────────────────────────────

//   /**
//    * Called when merchant changes their store slug.
//    * Creates new record first, then deletes old one.
//    */
//   async renameSubdomain(
//     oldSlug: string,
//     newSlug: string,
//   ): Promise<SubdomainStatus> {
//     const newStatus = await this.createSubdomain(newSlug);
//     await this.deleteSubdomain(oldSlug);
//     return newStatus;
//   }

//   // ── Private helpers ────────────────────────────────────────────────────────

//   private async findRecord(
//     slug: string,
//   ): Promise<{ id: string; proxied: boolean } | null> {
//     try {
//       const res = await firstValueFrom(
//         this.http.get(`${this.BASE}/zones/${this.zoneId}/dns_records`, {
//           headers: this.headers(),
//           params: { type: 'CNAME', name: `${slug}.${this.baseDomain}` },
//         }),
//       );

//       const records = res.data?.result ?? [];
//       if (records.length === 0) return null;
//       return { id: records[0].id, proxied: records[0].proxied };
//     } catch {
//       return null;
//     }
//   }

//   private isValidSlug(slug: string): boolean {
//     // Only lowercase letters, numbers, hyphens. No dots, no underscores.
//     return /^[a-z0-9-]{2,80}$/.test(slug);
//   }
// }
