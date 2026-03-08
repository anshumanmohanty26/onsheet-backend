import type { ConnectionOptions } from "node:tls";
import { Logger, type Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

/**
 * Injection token for the dedicated ioredis client used to store
 * real-time presence (active users per sheet) in Redis Hashes.
 *
 * Using a separate connection from the Socket.io pub/sub adapter ensures
 * presence reads/writes are never queued behind pub/sub traffic.
 */
export const REDIS_PRESENCE_CLIENT = Symbol("REDIS_PRESENCE_CLIENT");

export const redisPresenceProvider: Provider = {
	provide: REDIS_PRESENCE_CLIENT,
	inject: [ConfigService],
	useFactory: async (config: ConfigService): Promise<Redis> => {
		const logger = new Logger("RedisPresenceClient");

		const host = config.get<string>("redis.host") ?? "localhost";
		const port = config.get<number>("redis.port") ?? 6379;
		const password = config.get<string | undefined>("redis.password");
		const tls = config.get<ConnectionOptions | undefined>("redis.tls");

		const client = new Redis({ host, port, password, tls, lazyConnect: true });

		client.on("error", (err: Error) => logger.error(`Presence Redis error: ${err.message}`));

		await client.connect();
		logger.log(`Presence Redis connected → ${host}:${port}`);
		return client;
	},
};
