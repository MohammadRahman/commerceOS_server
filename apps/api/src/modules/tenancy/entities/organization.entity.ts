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

  @Column({ type: 'varchar', length: 50, default: 'Asia/Dhaka' })
  timezone: string;

  @Column({ type: 'varchar', length: 10, default: 'BDT' })
  currency: string;

  @Column({ type: 'varchar', length: 300, default: '' })
  pickupAddress: string;

  @Column({ type: 'boolean', default: false })
  isOnboarded: boolean;

  @Index()
  @Column({ type: 'char', length: 2, name: 'country_code', default: 'BD' })
  countryCode: string;
}
