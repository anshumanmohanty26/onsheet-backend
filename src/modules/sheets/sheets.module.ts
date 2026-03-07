import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WorkbooksModule } from '../workbooks/workbooks.module';
import { SheetsController } from './sheets.controller';
import { SheetsService } from './sheets.service';

@Module({
  imports: [PrismaModule, WorkbooksModule],
  providers: [SheetsService],
  controllers: [SheetsController],
  exports: [SheetsService],
})
export class SheetsModule {}
