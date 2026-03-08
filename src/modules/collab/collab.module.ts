import { Module, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "../../prisma/prisma.module";
import { CellsModule } from "../cells/cells.module";
import { UsersModule } from "../users/users.module";
import { CollabGateway } from "./collab.gateway";
import { CollabService } from "./collab.service";
import { OperationLogModule } from "./operation-log.module";
import { redisPresenceProvider } from "./redis-presence.provider";

@Module({
	imports: [
		PrismaModule,
		forwardRef(() => CellsModule),
		UsersModule,
		OperationLogModule,
		JwtModule.register({}), // secrets resolved at verify-time via ConfigService
	],
	providers: [CollabGateway, CollabService, redisPresenceProvider],
	exports: [CollabGateway],
})
export class CollabModule {}
