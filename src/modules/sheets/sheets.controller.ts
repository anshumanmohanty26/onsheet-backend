import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CreateSheetDto } from "./dto/create-sheet.dto";
import { CreateSnapshotDto } from "./dto/create-snapshot.dto";
import { UpdateSheetDto } from "./dto/update-sheet.dto";
import { SheetsService } from "./sheets.service";

@Controller("workbooks/:workbookId/sheets")
export class SheetsController {
	constructor(private readonly sheetsService: SheetsService) {}

	@Get()
	findAll(@Param("workbookId") workbookId: string, @CurrentUser("id") userId: string) {
		return this.sheetsService.findAll(workbookId, userId);
	}

	@Get(":id")
	findOne(@Param("id") id: string, @CurrentUser("id") userId: string) {
		return this.sheetsService.findOne(id, userId);
	}

	@Post()
	create(
		@Param("workbookId") workbookId: string,
		@CurrentUser("id") userId: string,
		@Body() dto: CreateSheetDto,
	) {
		return this.sheetsService.create(workbookId, userId, dto);
	}

	@Patch(":id")
	update(@Param("id") id: string, @CurrentUser("id") userId: string, @Body() dto: UpdateSheetDto) {
		return this.sheetsService.update(id, userId, dto);
	}

	@Delete(":id")
	remove(@Param("id") id: string, @CurrentUser("id") userId: string) {
		return this.sheetsService.remove(id, userId);
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
