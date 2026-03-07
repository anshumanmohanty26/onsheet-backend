import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { WorkbooksService } from "../workbooks/workbooks.service";
import { CreateSheetDto } from "./dto/create-sheet.dto";
import { CreateSnapshotDto } from "./dto/create-snapshot.dto";
import { UpdateSheetDto } from "./dto/update-sheet.dto";

@Injectable()
export class SheetsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly workbooksService: WorkbooksService,
	) {}

	async findAll(workbookId: string, userId: string) {
		// access check via workbooksService
		await this.workbooksService.findOne(workbookId, userId);
		return this.prisma.sheet.findMany({ where: { workbookId }, orderBy: { index: "asc" } });
	}

	async findOne(id: string, userId: string) {
		const sheet = await this.prisma.sheet.findUnique({ where: { id } });
		if (!sheet) throw new NotFoundException("Sheet not found");
		await this.workbooksService.findOne(sheet.workbookId, userId);
		return sheet;
	}

	/**
	 * Asserts the user has at least EDITOR access on the workbook that owns this sheet.
	 * Throws NotFoundException if the sheet doesn't exist, ForbiddenException otherwise.
	 */
	async assertEditorAccess(sheetId: string, userId: string): Promise<void> {
		const sheet = await this.prisma.sheet.findUnique({
			where: { id: sheetId },
			select: { workbookId: true },
		});
		if (!sheet) throw new NotFoundException("Sheet not found");
		await this.workbooksService.assertEditor(sheet.workbookId, userId);
	}

	async create(workbookId: string, userId: string, dto: CreateSheetDto) {
		await this.workbooksService.assertEditor(workbookId, userId);
		const count = await this.prisma.sheet.count({ where: { workbookId } });
		return this.prisma.sheet.create({
			data: { workbookId, name: dto.name ?? `Sheet${count + 1}`, index: count },
		});
	}

	async update(id: string, userId: string, dto: UpdateSheetDto) {
		await this.assertEditorAccess(id, userId);
		return this.prisma.sheet.update({ where: { id }, data: dto });
	}

	async remove(id: string, userId: string) {
		await this.assertEditorAccess(id, userId);
		return this.prisma.sheet.delete({ where: { id } });
	}

	// ── Snapshots ──────────────────────────────────────────────────────────────

	async createSnapshot(sheetId: string, userId: string, dto: CreateSnapshotDto) {
		await this.assertEditorAccess(sheetId, userId);
		const cells = await this.prisma.cell.findMany({ where: { sheetId } });
		return this.prisma.sheetSnapshot.create({
			data: {
				sheetId,
				createdBy: userId,
				name: dto.name ?? "Autosave",
				cells,
			},
		});
	}

	async listSnapshots(sheetId: string, userId: string) {
		const sheet = await this.prisma.sheet.findUnique({ where: { id: sheetId } });
		if (!sheet) throw new NotFoundException("Sheet not found");
		await this.workbooksService.findOne(sheet.workbookId, userId);
		return this.prisma.sheetSnapshot.findMany({
			where: { sheetId },
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				name: true,
				createdAt: true,
				user: { select: { id: true, displayName: true, avatarUrl: true } },
			},
		});
	}

	async restoreSnapshot(sheetId: string, snapshotId: string, userId: string) {
		await this.assertEditorAccess(sheetId, userId);
		const snapshot = await this.prisma.sheetSnapshot.findFirst({
			where: { id: snapshotId, sheetId },
		});
		if (!snapshot) throw new NotFoundException("Snapshot not found");

		const savedCells = snapshot.cells as Array<{
			row: number;
			col: number;
			rawValue: string | null;
			computed: string | null;
			formatted: string | null;
			style: object;
		}>;

		// Wipe current cells and restore from snapshot in a transaction
		await this.prisma.$transaction([
			this.prisma.cell.deleteMany({ where: { sheetId } }),
			this.prisma.cell.createMany({
				data: savedCells.map((c) => ({
					sheetId,
					row: c.row,
					col: c.col,
					rawValue: c.rawValue,
					computed: c.computed,
					formatted: c.formatted,
					style: c.style ?? {},
					version: 1,
				})),
			}),
		]);

		return { restored: true, snapshotId };
	}
}
