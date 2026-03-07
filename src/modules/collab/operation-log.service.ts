import { Injectable } from '@nestjs/common';
import type { OpType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RecordOpInput {
  cellId: string | null;
  sheetId: string;
  row: number;
  col: number;
  userId: string;
  version: number;
  type: OpType;
  oldValue: string | null;
  newValue: string | null;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class OperationLogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Append a single operation to the log. */
  async record(input: RecordOpInput) {
    return this.prisma.cellOperation.create({
      data: {
        cellId: input.cellId,
        sheetId: input.sheetId,
        row: input.row,
        col: input.col,
        userId: input.userId,
        version: input.version,
        type: input.type,
        oldValue: input.oldValue,
        newValue: input.newValue,
        metadata: input.metadata ?? undefined,
      },
    });
  }

  /** Append multiple operations in a single transaction. */
  async recordBatch(inputs: RecordOpInput[]) {
    return this.prisma.$transaction(
      inputs.map((input) =>
        this.prisma.cellOperation.create({
          data: {
            cellId: input.cellId,
            sheetId: input.sheetId,
            row: input.row,
            col: input.col,
            userId: input.userId,
            version: input.version,
            type: input.type,
            oldValue: input.oldValue,
            newValue: input.newValue,
            metadata: input.metadata ?? undefined,
          },
        }),
      ),
    );
  }

  /** Get recent operations for a sheet (for late-joiners to catch up). */
  async getRecent(sheetId: string, limit = 100) {
    return this.prisma.cellOperation.findMany({
      where: { sheetId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Get full history for a specific cell. */
  async getCellHistory(sheetId: string, row: number, col: number, limit = 50) {
    return this.prisma.cellOperation.findMany({
      where: { sheetId, row, col },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
