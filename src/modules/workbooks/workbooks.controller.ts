import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateWorkbookDto } from './dto/create-workbook.dto';
import { UpdateWorkbookDto } from './dto/update-workbook.dto';
import { WorkbooksService } from './workbooks.service';

class SetPublicAccessDto {
  @IsBoolean()
  publicAccess!: boolean;
}

@Controller('workbooks')
export class WorkbooksController {
  constructor(private readonly workbooksService: WorkbooksService) {}

  // ── Specific / sub-path routes first (NestJS matches in declaration order) ──

  @Public()
  @Get('public/:shareToken')
  findPublic(@Param('shareToken') shareToken: string) {
    return this.workbooksService.findByShareToken(shareToken);
  }

  @Get(':id/share-info')
  getShareInfo(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.workbooksService.getShareInfo(id, userId);
  }

  @Patch(':id/public-access')
  setPublicAccess(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SetPublicAccessDto,
  ) {
    return this.workbooksService.setPublicAccess(id, userId, dto.publicAccess);
  }

  // ── Generic CRUD ──────────────────────────────────────────────────────────

  @Get()
  findAll(@CurrentUser('id') userId: string) {
    return this.workbooksService.findAllForUser(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.workbooksService.findOne(id, userId);
  }

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateWorkbookDto) {
    return this.workbooksService.create(userId, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateWorkbookDto,
  ) {
    return this.workbooksService.update(id, userId, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.workbooksService.remove(id, userId);
  }
}
