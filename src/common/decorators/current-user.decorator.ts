import { type ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { Request } from "express";

// Usage: @CurrentUser() user  OR  @CurrentUser('id') userId: string
export const CurrentUser = createParamDecorator(
	(data: string | undefined, ctx: ExecutionContext) => {
		const request = ctx.switchToHttp().getRequest<Request>();
		const user = request.user as Record<string, unknown> | undefined;
		return data ? user?.[data] : user;
	},
);
