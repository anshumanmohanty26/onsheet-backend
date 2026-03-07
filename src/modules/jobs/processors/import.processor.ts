import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ImportJobData {
  workbookId: string;
  sheetId: string;
  userId: string;
  fileUrl: string;
  format: 'csv' | 'xlsx';
}

@Processor('import')
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<ImportJobData>) {
    const { sheetId, format } = job.data;
    this.logger.log(`Processing import job ${job.id}: sheet=${sheetId}, format=${format}`);

    // TODO: download fileUrl, parse CSV/XLSX rows, bulk-upsert cells
    await job.updateProgress(100);
    return { status: 'done', rowsImported: 0 };
  }
}
