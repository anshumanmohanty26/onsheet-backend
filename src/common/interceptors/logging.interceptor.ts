import {
	type CallHandler,
	type ExecutionContext,
	Injectable,
	Logger,
	type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
	private readonly logger = new Logger("HTTP");

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const req = context.switchToHttp().getRequest();
		const { method, url } = req as { method: string; url: string };
		const now = Date.now();

		return next
			.handle()
			.pipe(tap(() => this.logger.log(`${method} ${url} — ${Date.now() - now}ms`)));
	}
}
