import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationLogService } from '../collab/operation-log.service';
import { SheetsService } from '../sheets/sheets.service';
import { UpdateCellDto } from './dto/update-cell.dto';

export interface VersionedCellResult {
  id: string;
  sheetId: string;
  row: number;
  col: number;
  rawValue: string | null;
  computed: string | null;
  formatted: string | null;
  style: Prisma.JsonValue;
  version: number;
}

@Injectable()
export class CellsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetsService: SheetsService,
    private readonly opLog: OperationLogService,
  ) {}

  async findAll(sheetId: string, userId: string) {
    await this.sheetsService.findOne(sheetId, userId);
    return this.prisma.cell.findMany({ where: { sheetId } });
  }

  /**
   * Versioned upsert with optimistic concurrency.
   * If dto.baseVersion is provided and doesn't match the current cell version,
   * a ConflictException is thrown with the server cell state (client can re-merge).
   */
  async upsert(
    sheetId: string,
    userId: string,
    dto: UpdateCellDto,
    source: 'http' | 'ws' = 'http',
  ): Promise<VersionedCellResult> {
    await this.sheetsService.assertEditorAccess(sheetId, userId);

    // Fetch current cell (may not exist yet)
    const existing = await this.prisma.cell.findUnique({
      where: { sheetId_row_col: { sheetId, row: dto.row, col: dto.col } },
    });

    // Optimistic concurrency check
    if (dto.baseVersion !== undefined && existing && existing.version !== dto.baseVersion) {
      throw new ConflictException({
        message: 'Cell version conflict — cell was modified by another user',
        serverCell: existing,
      });
    }

    const nextVersion = (existing?.version ?? 0) + 1;
    const oldValue = existing?.rawValue ?? null;

    const cell = await this.prisma.cell.upsert({
      where: { sheetId_row_col: { sheetId, row: dto.row, col: dto.col } },
      create: {
        sheetId,
        row: dto.row,
        col: dto.col,
        rawValue: dto.rawValue,
        computed: dto.computed,
        formatted: dto.formatted,
        style: dto.style as Prisma.InputJsonValue,
        version: nextVersion,
      },
      update: {
        rawValue: dto.rawValue,
        computed: dto.computed,
        formatted: dto.formatted,
        style: dto.style as Prisma.InputJsonValue,
        version: nextVersion,
      },
    });

    // Append to operation log (fire-and-forget — don't block the response)
    this.opLog
      .record({
        cellId: cell.id,
        sheetId,
        row: dto.row,
        col: dto.col,
        userId,
        version: nextVersion,
        type: 'UPDATE',
        oldValue,
        newValue: dto.rawValue ?? null,
        metadata: { source },
      })
      .catch(() => {
        /* non-critical — log failure shouldn't fail the write */
      });

    return cell;
  }

  async bulkUpsert(sheetId: string, userId: string, cells: UpdateCellDto[]) {
    await this.sheetsService.assertEditorAccess(sheetId, userId);

    const results: VersionedCellResult[] = [];
    for (const dto of cells) {
      // Each cell goes through the versioned upsert path
      results.push(await this.upsert(sheetId, userId, dto, 'http'));
    }
    return results;
  }

  async clear(sheetId: string, row: number, col: number, userId: string) {
    await this.sheetsService.assertEditorAccess(sheetId, userId);

    const existing = await this.prisma.cell.findUnique({
      where: { sheetId_row_col: { sheetId, row, col } },
    });

    const result = await this.prisma.cell.deleteMany({ where: { sheetId, row, col } });

    if (existing) {
      this.opLog
        .record({
          cellId: existing.id,
          sheetId,
          row,
          col,
          userId,
          version: existing.version + 1,
          type: 'CLEAR',
          oldValue: existing.rawValue,
          newValue: null,
        })
        .catch(() => {});
    }

    return result;
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async listComments(sheetId: string, userId: string) {
    await this.sheetsService.findOne(sheetId, userId);
    return this.prisma.cellComment.findMany({
      where: { sheetId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        row: true,
        col: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });
  }

  async addComment(sheetId: string, userId: string, row: number, col: number, content: string) {
    await this.sheetsService.findOne(sheetId, userId);
    return this.prisma.cellComment.create({
      data: { sheetId, row, col, content, createdBy: userId },
      select: {
        id: true,
        row: true,
        col: true,
        content: true,
        createdAt: true,
        user: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    });
  }

  async deleteComment(sheetId: string, commentId: string, userId: string) {
    const comment = await this.prisma.cellComment.findFirst({
      where: { id: commentId, sheetId },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.createdBy !== userId) {
      await this.sheetsService.assertEditorAccess(sheetId, userId);
    }
    return this.prisma.cellComment.delete({ where: { id: commentId } });
  }

  // ── Public (anonymous) access ─────────────────────────────────────────────

  async findPublicCells(shareToken: string, sheetId: string) {
    const sheet = await this.prisma.sheet.findUnique({
      where: { id: sheetId },
      include: { workbook: { select: { shareToken: true, publicAccess: true } } },
    });
    if (
      !sheet ||
      sheet.workbook.shareToken !== shareToken ||
      !sheet.workbook.publicAccess
    ) {
      throw new NotFoundException('Sheet not found or not public');
    }
    return this.prisma.cell.findMany({ where: { sheetId } });
  }
}
