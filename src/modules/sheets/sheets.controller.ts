import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CollabGateway } from "../collab/collab.gateway";
import { CreateSheetDto } from "./dto/create-sheet.dto";
import { CreateSnapshotDto } from "./dto/create-snapshot.dto";
import { UpdateSheetDto } from "./dto/update-sheet.dto";
import { SheetsService } from "./sheets.service";

@Controller("workbooks/:workbookId/sheets")
export class SheetsController {
	constructor(
		private readonly sheetsService: SheetsService,
		private readonly collab: CollabGateway,
	) {}

	@Get()
	findAll(@Param("workbookId") workbookId: string, @CurrentUser("id") userId: string) {
		return this.sheetsService.findAll(workbookId, userId);
	}

	@Get(":id")
	findOne(@Param("id") id: string, @CurrentUser("id") userId: string) {
		return this.sheetsService.findOne(id, userId);
	}

	@Post()
	async create(
		@Param("workbookId") workbookId: string,
		@CurrentUser("id") userId: string,
		@Body() dto: CreateSheetDto,
	) {
		const sheet = await this.sheetsService.create(workbookId, userId, dto);
		this.collab.server.to(`workbook:${workbookId}`).emit("sheet:created", {
			sheet: { id: sheet.id, name: sheet.name, index: sheet.index, workbookId },
		});
		return sheet;
	}

	@Patch(":id")
	update(@Param("id") id: string, @CurrentUser("id") userId: string, @Body() dto: UpdateSheetDto) {
		return this.sheetsService.update(id, userId, dto);
	}

	@Delete(":id")
	async remove(@Param("id") id: string, @CurrentUser("id") userId: string) {
		const result = await this.sheetsService.remove(id, userId);
		if (result.workbookId) {
			this.collab.server
				.to(`workbook:${result.workbookId}`)
				.emit("sheet:deleted", { sheetId: result.sheetId });
		}
		return result;
	}

	// ── Snapshots ──────────────────────────────────────────────────────────────

	@Get(":id/snapshots")
	listSnapshots(@Param("id") id: string, @CurrentUser("id") userId: string) {
		return this.sheetsService.listSnapshots(id, userId);
	}

	@Post(":id/snapshots")
	createSnapshot(
		@Param("id") id: string,
		@CurrentUser("id") userId: string,
		@Body() dto: CreateSnapshotDto,
	) {
		return this.sheetsService.createSnapshot(id, userId, dto);
	}

	@Post(":id/snapshots/:snapshotId/restore")
	restoreSnapshot(
		@Param("id") id: string,
		@Param("snapshotId") snapshotId: string,
		@CurrentUser("id") userId: string,
	) {
		return this.sheetsService.restoreSnapshot(id, snapshotId, userId);
	}
}
