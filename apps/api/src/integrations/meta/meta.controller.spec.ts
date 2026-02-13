import { Test, TestingModule } from '@nestjs/testing';
import { MetaOAuthController } from './controllers/meta.oauth.controller';
import { MetaOAuthService } from './services/meta.oauth.service';

describe('MetaController', () => {
  let controller: MetaOAuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetaOAuthController],
      providers: [MetaOAuthService],
    }).compile();

    controller = module.get<MetaOAuthController>(MetaOAuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
