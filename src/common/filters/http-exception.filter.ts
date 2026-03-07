import {
	type ArgumentsHost,
	Catch,
	type ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger(HttpExceptionFilter.name);

	catch(exception: HttpException, host: ArgumentsHost) {
		const ctx = host.switchToHttp();
		const response = ctx.getResponse<Response>();
		const request = ctx.getRequest<Request>();
		const status = exception.getStatus ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
		const exceptionResponse = exception.getResponse();

		if (status >= 500) {
			this.logger.error(`${request.method} ${request.url} → ${status}: ${exception.message}`);
		}

		response.status(status).json({
			success: false,
			statusCode: status,
			timestamp: new Date().toISOString(),
			path: request.url,
			message:
				typeof exceptionResponse === "object" && "message" in exceptionResponse
					? (exceptionResponse as Record<string, unknown>).message
					: exception.message,
		});
	}
}
