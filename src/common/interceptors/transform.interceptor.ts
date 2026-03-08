import {
	type CallHandler,
	type ExecutionContext,
	Injectable,
	type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

// Wraps every successful response in { success: true, data: ... }
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, { success: boolean; data: T }> {
	intercept(
		_context: ExecutionContext,
		next: CallHandler,
	): Observable<{ success: boolean; data: T }> {
		return next.handle().pipe(map((data) => ({ success: true, data })));
	}
}
