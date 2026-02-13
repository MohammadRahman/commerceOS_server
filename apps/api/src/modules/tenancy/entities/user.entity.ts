import { Column, Entity, Index, ManyToOne, Unique } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { OrganizationEntity } from './organization.entity';

export enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  AGENT = 'AGENT',
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

  @Column({ type: 'varchar', length: 200, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 20, default: UserRole.OWNER })
  role: UserRole;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;
}
