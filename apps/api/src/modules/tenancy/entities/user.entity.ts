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

  @Column({ type: 'varchar', length: 200, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 20, default: UserRole.AGENT })
  role: UserRole;

  @Column({ type: 'varchar', length: 20, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  // Temp password stored in plain text only for dev/testing
  // In production this gets sent via email/SMS and cleared
  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    name: 'temp_password',
  })
  tempPassword?: string;
}

// import { Column, Entity, Index, ManyToOne, Unique } from 'typeorm';
// import { AbstractEntity } from '@app/common/database/base.entity';
// import { OrganizationEntity } from './organization.entity';

// export enum UserRole {
//   OWNER = 'OWNER',
//   ADMIN = 'ADMIN',
//   AGENT = 'AGENT',
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

//   @Column({ type: 'varchar', length: 200, name: 'password_hash' })
//   passwordHash: string;

//   @Column({ type: 'varchar', length: 20, default: UserRole.OWNER })
//   role: UserRole;

//   @Column({ type: 'boolean', default: true, name: 'is_active' })
//   isActive: boolean;
// }
