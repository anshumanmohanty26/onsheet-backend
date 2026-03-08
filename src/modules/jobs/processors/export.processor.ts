import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { PrismaService } from "../../../prisma/prisma.service";

export interface ExportJobData {
	workbookId: string;
	userId: string;
	format: "csv" | "xlsx";
}

@Processor("export")
export class ExportProcessor extends WorkerHost {
	private readonly logger = new Logger(ExportProcessor.name);

	constructor(private readonly prisma: PrismaService) {
		super();
	}

	async process(job: Job<ExportJobData>) {
		const { workbookId, format } = job.data;
		this.logger.log(`Processing export job ${job.id}: workbook=${workbookId}, format=${format}`);
		await job.updateProgress(100);
		return { status: "done", url: null };
	}
}
