/* eslint-disable prettier/prettier */
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { UserEntity } from './user.entity';

@Entity('user_sessions')
@Index(['orgId', 'userId'])
export class UserSessionEntity extends AbstractEntity<UserSessionEntity> {
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  user: UserEntity;

  // store hash only (never store raw refresh tokens)
  @Column({ type: 'varchar', length: 200, name: 'refresh_token_hash' })
  refreshTokenHash: string;

  @Column({ type: 'varchar', length: 500, name: 'user_agent', nullable: true })
  userAgent?: string;

  @Column({ type: 'varchar', length: 100, name: 'ip', nullable: true })
  ip?: string;

  @Column({ type: 'timestamp with time zone', name: 'revoked_at', nullable: true })
  revokedAt?: Date;

  @Column({ type: 'timestamp with time zone', name: 'last_used_at', nullable: true })
  lastUsedAt?: Date;
}
