import { Test, TestingModule } from '@nestjs/testing';
import { INestApplicationContext } from '@nestjs/common';
import { WorkerModule } from './../src/worker.module';

describe('Worker (e2e)', () => {
  let app: INestApplicationContext;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [WorkerModule],
    })
      .overrideProvider('DataSource')
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should initialize', () => {
    expect(app).toBeDefined();
  });
});
