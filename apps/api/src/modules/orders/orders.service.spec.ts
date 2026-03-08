import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderEntity } from './entities/order.entity';
import { OrderEventEntity } from './entities/order-event.entity';
import { CustomerEntity } from '../inbox/entities/customer.entity';
import { CustomerIdentityEntity } from '../inbox/entities/customer-identity.entity';
import { ConversationEntity } from '../inbox/entities/conversation.entity';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
});

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(OrderEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(OrderEventEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(CustomerEntity), useFactory: mockRepo },
        {
          provide: getRepositoryToken(CustomerIdentityEntity),
          useFactory: mockRepo,
        },
        {
          provide: getRepositoryToken(ConversationEntity),
          useFactory: mockRepo,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
