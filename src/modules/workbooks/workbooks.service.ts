import { randomUUID } from "node:crypto";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PermissionRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateWorkbookDto } from "./dto/create-workbook.dto";
import { UpdateWorkbookDto } from "./dto/update-workbook.dto";

@Injectable()
export class WorkbooksService {
	constructor(private readonly prisma: PrismaService) {}

	async findAllForUser(userId: string) {
		// Return only workbooks owned by the user.
		// Workbooks shared with the user are returned separately by sharedWithMe().
		return this.prisma.workbook.findMany({
			where: { ownerId: userId },
			include: { sheets: { select: { id: true, name: true, index: true } } },
			orderBy: { createdAt: "desc" },
		});
	}

	async findOne(id: string, userId: string) {
		const wb = await this.prisma.workbook.findUnique({
			where: { id },
			include: {
				sheets: { orderBy: { index: "asc" } },
				permissions: { where: { userId }, select: { role: true } },
			},
		});
		if (!wb) throw new NotFoundException("Workbook not found");
		if (wb.ownerId !== userId && wb.permissions.length === 0) {
			throw new ForbiddenException("Access denied");
		}
		const myRole: PermissionRole | "OWNER" =
			wb.ownerId === userId ? "OWNER" : wb.permissions[0].role;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { permissions: _p, ...rest } = wb;
		return { ...rest, myRole };
	}

	async create(userId: string, dto: CreateWorkbookDto) {
		return this.prisma.workbook.create({
			data: {
				name: dto.name,
				ownerId: userId,
				sheets: { create: { name: "Sheet1", index: 0 } },
			},
			include: { sheets: true },
		});
	}

	async update(id: string, userId: string, dto: UpdateWorkbookDto) {
		await this.assertOwner(id, userId);
		return this.prisma.workbook.update({ where: { id }, data: dto });
	}

	async remove(id: string, userId: string) {
		await this.assertOwner(id, userId);
		return this.prisma.workbook.delete({ where: { id } });
	}

	// ── Access helpers ───────────────────────────────────────────────────────────

	/** Allows any collaborator (VIEWER / COMMENTER / EDITOR) or the owner. */
	private async assertAccess(workbookId: string, userId: string) {
		const wb = await this.prisma.workbook.findUnique({
			where: { id: workbookId },
			select: { ownerId: true, permissions: { where: { userId }, select: { role: true } } },
		});
		if (!wb) throw new NotFoundException();
		if (wb.ownerId === userId || wb.permissions.length > 0) return;
		throw new ForbiddenException("Access denied");
	}

	/** Requires EDITOR role or ownership. Used by sheets/cells write operations. */
	async assertEditor(workbookId: string, userId: string): Promise<void> {
		const wb = await this.prisma.workbook.findUnique({
			where: { id: workbookId },
			select: { ownerId: true, permissions: { where: { userId }, select: { role: true } } },
		});
		if (!wb) throw new NotFoundException("Workbook not found");
		if (wb.ownerId === userId) return;
		const perm = wb.permissions[0];
		if (!perm || perm.role !== PermissionRole.EDITOR) {
			throw new ForbiddenException("Editor access required");
		}
	}

	async findByShareToken(shareToken: string) {
		const wb = await this.prisma.workbook.findUnique({
			where: { shareToken },
			include: { sheets: { orderBy: { index: "asc" } } },
		});
		if (!wb || !wb.publicAccess) throw new NotFoundException("Sheet not found or not public");
		return wb;
	}

	async setPublicAccess(id: string, userId: string, publicAccess: boolean) {
		await this.assertOwner(id, userId);
		// Ensure existing workbooks (created before the shareToken column was added)
		// always have a token when public access is enabled.
		const current = await this.prisma.workbook.findUnique({
			where: { id },
			select: { shareToken: true },
		});
		return this.prisma.workbook.update({
			where: { id },
			data: {
				publicAccess,
				...(publicAccess && !current?.shareToken ? { shareToken: randomUUID() } : {}),
			},
			select: { shareToken: true, publicAccess: true },
		});
	}

	async getShareInfo(id: string, userId: string) {
		await this.assertAccess(id, userId);
		const wb = await this.prisma.workbook.findUnique({
			where: { id },
			select: { shareToken: true, publicAccess: true },
		});
		if (!wb) throw new NotFoundException();
		return wb;
	}

	/** Returns workbooks explicitly shared with the user (not owned by them). */
	async sharedWithMe(userId: string) {
		const rows = await this.prisma.permission.findMany({
			where: { userId, workbook: { ownerId: { not: userId } } },
			include: {
				workbook: {
					include: {
						sheets: { select: { id: true, name: true, index: true } },
						owner: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
					},
				},
			},
			orderBy: { workbook: { createdAt: "desc" } },
		});
		return rows.map((p) => ({
			...p.workbook,
			myRole: p.role.toLowerCase() as "viewer" | "editor" | "commenter",
		}));
	}

	private async assertOwner(workbookId: string, userId: string) {
		const wb = await this.prisma.workbook.findUnique({
			where: { id: workbookId },
			select: { ownerId: true },
		});
		if (!wb) throw new NotFoundException();
		if (wb.ownerId !== userId)
			throw new ForbiddenException("Only the owner can perform this action");
	}
}
