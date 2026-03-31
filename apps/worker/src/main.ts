import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupBullBoard } from './workers/bull-board.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.init();
  setupBullBoard(app);
  const port = process.env.WORKER_PORT ?? 3001;
  await app.listen(port);
  console.log(`⚙️  Worker running on :${port}`);
}
bootstrap();
