import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkbooksService } from '../workbooks/workbooks.service';
import { ShareDto } from './dto/share.dto';

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workbooksService: WorkbooksService,
  ) {}

  async findAll(workbookId: string, userId: string) {
    await this.assertOwner(workbookId, userId);
    return this.prisma.permission.findMany({
      where: { workbookId },
      include: { user: { select: { id: true, email: true, displayName: true, avatarUrl: true } } },
    });
  }

  async share(workbookId: string, requesterId: string, dto: ShareDto) {
    await this.assertOwner(workbookId, requesterId);
    const target = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!target) throw new NotFoundException('User not found');
    return this.prisma.permission.upsert({
      where: { workbookId_userId: { workbookId, userId: target.id } },
      create: { workbookId, userId: target.id, role: dto.role },
      update: { role: dto.role },
    });
  }

  async revoke(workbookId: string, targetUserId: string, requesterId: string) {
    await this.assertOwner(workbookId, requesterId);
    return this.prisma.permission.delete({
      where: { workbookId_userId: { workbookId, userId: targetUserId } },
    });
  }

  private async assertOwner(workbookId: string, userId: string) {
    const wb = await this.prisma.workbook.findUnique({
      where: { id: workbookId },
      select: { ownerId: true },
    });
    if (!wb) throw new NotFoundException();
    if (wb.ownerId !== userId)
      throw new ForbiddenException('Only the owner can manage permissions');
  }
}
