import { Column, Entity, Index, OneToMany } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { CustomerIdentityEntity } from './customer-identity.entity';

@Entity('customers')
export class CustomerEntity extends AbstractEntity<CustomerEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  name?: string;

  @Index()
  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 320, nullable: true })
  email?: string;

  @Column({ type: 'text', name: 'address_text', nullable: true })
  addressText?: string;

  @Column({
    type: 'timestamp with time zone',
    name: 'last_seen_at',
    nullable: true,
  })
  lastSeenAt?: Date;

  @OneToMany(() => CustomerIdentityEntity, (ci) => ci.customer)
  identities: CustomerIdentityEntity[];
}
