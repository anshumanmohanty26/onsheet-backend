import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { PrismaModule } from "../../prisma/prisma.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AI_REDIS } from "./ai.constants";

export { AI_REDIS };

/**
 * Module that provides the OnSheet AI agent and LLM utilities.
 *
 * Depends on {@link PrismaModule} so the agent tools can query live sheet data.
 * Provides a dedicated Redis client (token: AI_REDIS) for per-user conversation context.
 */
@Module({
	imports: [PrismaModule],
	providers: [
		AiService,
		{
			provide: AI_REDIS,
			inject: [ConfigService],
			useFactory: (config: ConfigService) =>
				new Redis({
					host: config.get<string>("redis.host") ?? "localhost",
					port: config.get<number>("redis.port") ?? 6379,
					password: config.get<string | undefined>("redis.password"),
					tls: config.get<object | undefined>("redis.tls") as
						import("node:tls").ConnectionOptions | undefined,
					lazyConnect: true,
					enableOfflineQueue: false,
				}),
		},
	],
	controllers: [AiController],
})
export class AiModule {}
