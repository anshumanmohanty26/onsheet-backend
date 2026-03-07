import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { WorkbooksModule } from "../workbooks/workbooks.module";
import { PermissionsController } from "./permissions.controller";
import { PermissionsService } from "./permissions.service";

@Module({
	imports: [PrismaModule, WorkbooksModule],
	providers: [PermissionsService],
	controllers: [PermissionsController],
})
export class PermissionsModule {}
