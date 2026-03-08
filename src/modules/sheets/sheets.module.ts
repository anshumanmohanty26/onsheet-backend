import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { CollabModule } from "../collab/collab.module";
import { WorkbooksModule } from "../workbooks/workbooks.module";
import { SheetsController } from "./sheets.controller";
import { SheetsService } from "./sheets.service";

@Module({
	imports: [PrismaModule, WorkbooksModule, CollabModule],
	providers: [SheetsService],
	controllers: [SheetsController],
	exports: [SheetsService],
})
export class SheetsModule {}
