import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CellsService } from './cells.service';
import { UpdateCellDto } from './dto/update-cell.dto';
import { IsNotEmpty, IsNumber, IsString, MaxLength, Min } from 'class-validator';

class AddCommentDto {
  @IsNumber() @Min(0) row!: number;
  @IsNumber() @Min(0) col!: number;
  @IsString() @IsNotEmpty() @MaxLength(2000) content!: string;
}

@Controller('sheets/:sheetId/cells')
export class CellsController {
  constructor(private readonly cellsService: CellsService) {}

  @Get()
  findAll(@Param('sheetId') sheetId: string, @CurrentUser('id') userId: string) {
    return this.cellsService.findAll(sheetId, userId);
  }

  @Put()
  upsert(
    @Param('sheetId') sheetId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCellDto,
  ) {
    return this.cellsService.upsert(sheetId, userId, dto);
  }

  @Put('bulk')
  bulkUpsert(
    @Param('sheetId') sheetId: string,
    @CurrentUser('id') userId: string,
    @Body() cells: UpdateCellDto[],
  ) {
    return this.cellsService.bulkUpsert(sheetId, userId, cells);
  }

  @Delete()
  clear(
    @Param('sheetId') sheetId: string,
    @CurrentUser('id') userId: string,
    @Query('row', ParseIntPipe) row: number,
    @Query('col', ParseIntPipe) col: number,
  ) {
    return this.cellsService.clear(sheetId, row, col, userId);
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  @Get('comments')
  listComments(@Param('sheetId') sheetId: string, @CurrentUser('id') userId: string) {
    return this.cellsService.listComments(sheetId, userId);
  }

  @Post('comments')
  addComment(
    @Param('sheetId') sheetId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AddCommentDto,
  ) {
    return this.cellsService.addComment(sheetId, userId, dto.row, dto.col, dto.content);
  }

  @Delete('comments/:commentId')
  deleteComment(
    @Param('sheetId') sheetId: string,
    @Param('commentId') commentId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.cellsService.deleteComment(sheetId, commentId, userId);
  }
}

