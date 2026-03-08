import { randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { RedisIoAdapter } from "./modules/collab/redis-io-adapter.provider";

async function bootstrap() {
	const app = await NestFactory.create(AppModule, { bufferLogs: true });

	// Wire Pino as NestJS logger (flushes buffered bootstrap logs)
	app.useLogger(app.get(Logger));

	// ── Socket.io Redis Adapter (horizontal WS scaling) ───────────────────────
	const configService = app.get(ConfigService);
	const redisIoAdapter = new RedisIoAdapter(app, configService);
	await redisIoAdapter.connectToRedis();
	app.useWebSocketAdapter(redisIoAdapter);

	// HTTP security headers
	app.use(helmet());

	// Propagate / generate a request-id on every request
	app.use((req: Request, res: Response, next: NextFunction) => {
		const id = (req.headers["x-request-id"] as string) ?? randomUUID();
		req.headers["x-request-id"] = id;
		res.setHeader("X-Request-Id", id);
		next();
	});

	// Cookie parsing (must come before route handlers)
	app.use(cookieParser());

	// Raise body-parser limit so large spreadsheet imports go through
	app.use(express.json({ limit: "50mb" }));
	app.use(express.urlencoded({ extended: true, limit: "50mb" }));

	app.setGlobalPrefix("api/v1");

	const frontendUrl = process.env.FRONTEND_URL;
	// Allow both exact FRONTEND_URL and its www/non-www counterpart so that
	// naked-domain ↔ www redirects never cause CORS failures.
	const extraOrigins: string[] = [];
	if (frontendUrl) {
		const url = new URL(frontendUrl);
		if (url.hostname.startsWith("www.")) {
			extraOrigins.push(`${url.protocol}//${url.hostname.slice(4)}`);
		} else {
			extraOrigins.push(`${url.protocol}//www.${url.hostname}`);
		}
	}
	const allowedOrigins =
		process.env.NODE_ENV === "production"
			? frontendUrl
				? [frontendUrl, ...extraOrigins]
				: []
			: ["http://localhost:3000", ...(frontendUrl ? [frontendUrl, ...extraOrigins] : [])];

	app.enableCors({
		origin: allowedOrigins,
		credentials: true,
	});

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
		}),
	);

	app.useGlobalFilters(new HttpExceptionFilter());
	app.useGlobalInterceptors(new TransformInterceptor());

	const port = process.env.PORT ?? 4000;
	await app.listen(port);
	const pinoLogger = app.get(Logger);
	pinoLogger.log(`OnSheet API running → http://localhost:${port}/api/v1`);
	pinoLogger.log("Docs → see /docs folder in the repository");
}

bootstrap();
