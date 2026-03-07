import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OperationLogService } from './operation-log.service';

@Module({
  imports: [PrismaModule],
  providers: [OperationLogService],
  exports: [OperationLogService],
})
export class OperationLogModule {}
