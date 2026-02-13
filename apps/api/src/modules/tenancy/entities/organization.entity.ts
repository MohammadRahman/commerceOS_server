import { Column, Entity, Index, OneToMany } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { UserEntity } from './user.entity';

@Entity('organizations')
export class OrganizationEntity extends AbstractEntity<OrganizationEntity> {
  @Index()
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 50, default: 'FREE' })
  plan: string;

  @OneToMany(() => UserEntity, (u) => u.org)
  users: UserEntity[];
}
