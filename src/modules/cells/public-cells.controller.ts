import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CellsService } from './cells.service';

@Public()
@Controller('public/sheets')
export class PublicCellsController {
  constructor(private readonly cellsService: CellsService) {}

  @Get(':shareToken/:sheetId/cells')
  findPublicCells(
    @Param('shareToken') shareToken: string,
    @Param('sheetId') sheetId: string,
  ) {
    return this.cellsService.findPublicCells(shareToken, sheetId);
  }
}
