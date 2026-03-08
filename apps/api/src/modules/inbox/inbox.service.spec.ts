import { Test, TestingModule } from '@nestjs/testing';
import { InboxService } from './inbox.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelEntity } from './entities/channel.entity';
import { ConversationEntity } from './entities/conversation.entity';
import { MessageEntity } from './entities/message.entity';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
});

describe('InboxService', () => {
  let service: InboxService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboxService,
        { provide: getRepositoryToken(ChannelEntity), useFactory: mockRepo },
        {
          provide: getRepositoryToken(ConversationEntity),
          useFactory: mockRepo,
        },
        { provide: getRepositoryToken(MessageEntity), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get<InboxService>(InboxService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
