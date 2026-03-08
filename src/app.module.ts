import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import aiConfig from "./config/ai.config";
import appConfig from "./config/app.config";
import databaseConfig from "./config/database.config";
import jwtConfig from "./config/jwt.config";
import redisConfig from "./config/redis.config";
import { AiModule } from "./modules/ai/ai.module";
import { AuthModule } from "./modules/auth/auth.module";
import { JwtAuthGuard } from "./modules/auth/guards/jwt-auth.guard";
import { CellsModule } from "./modules/cells/cells.module";
import { CollabModule } from "./modules/collab/collab.module";
import { HealthModule } from "./modules/health/health.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { PermissionsModule } from "./modules/permissions/permissions.module";
import { SheetsModule } from "./modules/sheets/sheets.module";
import { UsersModule } from "./modules/users/users.module";
import { WorkbooksModule } from "./modules/workbooks/workbooks.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			load: [appConfig, databaseConfig, redisConfig, jwtConfig, aiConfig],
		}),
		LoggerModule.forRoot({
			pinoHttp: {
				transport:
					process.env.NODE_ENV !== "production"
						? { target: "pino-pretty", options: { singleLine: true, colorize: true } }
						: undefined,
				level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
				genReqId: (req) => (req.headers["x-request-id"] as string) ?? randomUUID(),
				autoLogging: true,
				serializers: {
					req: (req) => ({ method: req.method, url: req.url, id: req.id }),
					res: (res) => ({ statusCode: res.statusCode }),
				},
			},
		}),
		ThrottlerModule.forRoot([
			{ name: "default", ttl: 60_000, limit: 300 },
			{ name: "auth", ttl: 60_000, limit: 10 },
			{ name: "ai", ttl: 60_000, limit: 20 },
		]),
		PrismaModule,
		AuthModule,
		UsersModule,
		WorkbooksModule,
		SheetsModule,
		CellsModule,
		PermissionsModule,
		CollabModule,
		AiModule,
		JobsModule,
		HealthModule,
	],
	providers: [
		{ provide: APP_GUARD, useClass: JwtAuthGuard },
		{ provide: APP_GUARD, useClass: ThrottlerGuard },
	],
})
export class AppModule {}
