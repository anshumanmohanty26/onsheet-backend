import type { ConnectionOptions } from "node:tls";
import { Logger } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import type { ServerOptions } from "socket.io";

/**
 * Custom Socket.io adapter backed by Redis pub/sub.
 *
 * Enables horizontal scaling — multiple backend instances share WebSocket
 * events through Redis pub/sub channels. Redis is required; the application
 * will throw on startup if the connection cannot be established.
 */
export class RedisIoAdapter extends IoAdapter {
	private readonly logger = new Logger(RedisIoAdapter.name);
	private adapterConstructor!: ReturnType<typeof createAdapter>;

	constructor(
		app: INestApplication,
		private readonly config: ConfigService,
	) {
		super(app);
	}

	/**
	 * Connects pub/sub Redis clients and wires the Socket.io Redis adapter.
	 * Throws if Redis is unreachable — Redis is a hard runtime requirement.
	 */
	async connectToRedis(): Promise<void> {
		const host = this.config.get<string>("redis.host") ?? "localhost";
		const port = this.config.get<number>("redis.port") ?? 6379;
		const password = this.config.get<string | undefined>("redis.password");
		const tls = this.config.get<ConnectionOptions | undefined>("redis.tls");

		const pubClient = new Redis({ host, port, password, tls, lazyConnect: true });
		const subClient = pubClient.duplicate();

		pubClient.on("error", (err) => this.logger.error(`Redis pub error: ${err.message}`));
		subClient.on("error", (err) => this.logger.error(`Redis sub error: ${err.message}`));

		await Promise.all([pubClient.connect(), subClient.connect()]);
		this.adapterConstructor = createAdapter(pubClient, subClient);
		this.logger.log(`Socket.io Redis adapter connected → ${host}:${port}`);
	}

	/** @inheritdoc */
	override createIOServer(port: number, options?: ServerOptions) {
		const server = super.createIOServer(port, options);
		server.adapter(this.adapterConstructor);
		return server;
	}
}
