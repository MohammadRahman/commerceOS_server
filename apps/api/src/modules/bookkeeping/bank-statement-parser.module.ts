import { Module } from '@nestjs/common';
import { BankStatementParserService } from './services/bank-statement-parser.service';

@Module({
  providers: [BankStatementParserService],
  exports: [BankStatementParserService],
})
export class BankStatementParserModule {}
