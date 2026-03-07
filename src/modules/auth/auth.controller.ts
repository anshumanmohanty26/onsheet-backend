import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Post,
	Request,
	Res,
	UnauthorizedException,
	UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request as Req, Response } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { JwtRefreshGuard } from "./guards/jwt-refresh.guard";
import { LocalAuthGuard } from "./guards/local-auth.guard";

@Throttle({ auth: { limit: 10, ttl: 60_000 } })
@Controller("auth")
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Public()
	@Post("register")
	async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
		const { tokens, user } = await this.authService.register(dto);
		this.authService.attachCookies(res, tokens);
		return user;
	}

	@Public()
	@UseGuards(LocalAuthGuard)
	@HttpCode(HttpStatus.OK)
	@Post("login")
	async login(@Request() req: Req, @Res({ passthrough: true }) res: Response) {
		if (!req.user) throw new UnauthorizedException();
		const { tokens, user } = await this.authService.login(req.user);
		this.authService.attachCookies(res, tokens);
		return user;
	}

	@Public()
	@UseGuards(JwtRefreshGuard)
	@HttpCode(HttpStatus.OK)
	@Post("refresh")
	async refresh(@Request() req: Req, @Res({ passthrough: true }) res: Response) {
		if (!req.user) throw new UnauthorizedException();
		const tokens = await this.authService.refreshTokens(req.user);
		this.authService.attachCookies(res, tokens);
	}

	@HttpCode(HttpStatus.NO_CONTENT)
	@Post("logout")
	async logout(@CurrentUser("id") userId: string, @Res({ passthrough: true }) res: Response) {
		await this.authService.logout(userId);
		this.authService.clearCookies(res);
	}

	@Get("me")
	me(@CurrentUser() user: Express.User) {
		return user;
	}
}
