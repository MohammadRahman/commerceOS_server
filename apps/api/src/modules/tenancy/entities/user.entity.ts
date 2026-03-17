import { Column, Entity, Index, ManyToOne, Unique } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { OrganizationEntity } from './organization.entity';

export enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  AGENT = 'AGENT',
}

export enum UserStatus {
  ACTIVE = 'active',
  INVITED = 'invited',
  INACTIVE = 'inactive',
}

@Entity('users')
@Unique('uq_users_org_email', ['orgId', 'email'])
export class UserEntity extends AbstractEntity<UserEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @ManyToOne(() => OrganizationEntity, (o) => o.users, { onDelete: 'CASCADE' })
  org: OrganizationEntity;

  @Column({ type: 'varchar', length: 320 })
  email: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  name?: string;

  // Phone — collected at registration, used for SMS notifications
  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 200, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 20, default: UserRole.AGENT })
  role: UserRole;

  @Column({ type: 'varchar', length: 20, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    name: 'temp_password',
  })
  tempPassword?: string;

  // ── Password reset ────────────────────────────────────────────────────────
  // Stores sha256(rawToken) — the raw token is sent to user via email/SMS,
  // never stored. On verify: sha256(incoming) === stored hash.
  @Index()
  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
    name: 'reset_password_token',
  })
  resetPasswordToken?: string;

  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'reset_password_expires_at',
  })
  resetPasswordExpiresAt?: Date;

  // Stores bcrypt hash of the 4-digit OTP — raw OTP is sent via SMS only
  @Column({ type: 'varchar', length: 200, nullable: true, name: 'otp_hash' })
  otpHash?: string;

  @Column({ type: 'timestamptz', nullable: true, name: 'otp_expires_at' })
  otpExpiresAt?: Date;
}
// import { Column, Entity, Index, ManyToOne, Unique } from 'typeorm';
// import { AbstractEntity } from '@app/common/database/base.entity';
// import { OrganizationEntity } from './organization.entity';

// export enum UserRole {
//   OWNER = 'OWNER',
//   ADMIN = 'ADMIN',
//   AGENT = 'AGENT',
// }

// export enum UserStatus {
//   ACTIVE = 'active',
//   INVITED = 'invited',
//   INACTIVE = 'inactive',
// }

// @Entity('users')
// @Unique('uq_users_org_email', ['orgId', 'email'])
// export class UserEntity extends AbstractEntity<UserEntity> {
//   @Index()
//   @Column({ type: 'uuid', name: 'org_id' })
//   orgId: string;

//   @ManyToOne(() => OrganizationEntity, (o) => o.users, { onDelete: 'CASCADE' })
//   org: OrganizationEntity;

//   @Column({ type: 'varchar', length: 320 })
//   email: string;

//   @Column({ type: 'varchar', length: 200, nullable: true })
//   name?: string;

//   @Column({ type: 'varchar', length: 200, name: 'password_hash' })
//   passwordHash: string;

//   @Column({ type: 'varchar', length: 20, default: UserRole.AGENT })
//   role: UserRole;

//   @Column({ type: 'varchar', length: 20, default: UserStatus.ACTIVE })
//   status: UserStatus;

//   @Column({ type: 'boolean', default: true, name: 'is_active' })
//   isActive: boolean;

//   // Temp password stored in plain text only for dev/testing
//   // In production this gets sent via email/SMS and cleared
//   @Column({
//     type: 'varchar',
//     length: 100,
//     nullable: true,
//     name: 'temp_password',
//   })
//   tempPassword?: string;
// }
