import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WorkbooksController } from './workbooks.controller';
import { WorkbooksService } from './workbooks.service';

@Module({
  imports: [PrismaModule],
  providers: [WorkbooksService],
  controllers: [WorkbooksController],
  exports: [WorkbooksService],
})
export class WorkbooksModule {}
