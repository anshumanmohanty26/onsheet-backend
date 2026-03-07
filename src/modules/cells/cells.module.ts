import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OperationLogModule } from '../collab/operation-log.module';
import { SheetsModule } from '../sheets/sheets.module';
import { CellsController } from './cells.controller';
import { CellsService } from './cells.service';
import { PublicCellsController } from './public-cells.controller';

@Module({
  imports: [PrismaModule, SheetsModule, OperationLogModule],
  providers: [CellsService],
  controllers: [CellsController, PublicCellsController],
  exports: [CellsService],
})
export class CellsModule {}
