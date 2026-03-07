import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ShareDto } from "./dto/share.dto";
import { PermissionsService } from "./permissions.service";

@Controller("workbooks/:workbookId/permissions")
export class PermissionsController {
	constructor(private readonly permissionsService: PermissionsService) {}

	@Get()
	findAll(@Param("workbookId") workbookId: string, @CurrentUser("id") userId: string) {
		return this.permissionsService.findAll(workbookId, userId);
	}

	@Post()
	share(
		@Param("workbookId") workbookId: string,
		@CurrentUser("id") userId: string,
		@Body() dto: ShareDto,
	) {
		return this.permissionsService.share(workbookId, userId, dto);
	}

	@Delete(":targetUserId")
	revoke(
		@Param("workbookId") workbookId: string,
		@Param("targetUserId") targetUserId: string,
		@CurrentUser("id") userId: string,
	) {
		return this.permissionsService.revoke(workbookId, targetUserId, userId);
	}
}
