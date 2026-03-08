import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
	constructor(private readonly usersService: UsersService) {}

	@Get("me")
	async getMe(@CurrentUser("id") userId: string) {
		const user = await this.usersService.findById(userId);
		if (!user) return null;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { passwordHash: _ph, refreshToken: _rt, ...safe } = user;
		return safe;
	}

	@Patch("me")
	async updateMe(@CurrentUser("id") userId: string, @Body() dto: UpdateUserDto) {
		const user = await this.usersService.update(userId, dto);
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { passwordHash: _ph, refreshToken: _rt, ...safe } = user;
		return safe;
	}

	@Patch("me/password")
	@HttpCode(HttpStatus.NO_CONTENT)
	async changePassword(@CurrentUser("id") userId: string, @Body() dto: ChangePasswordDto) {
		await this.usersService.changePassword(userId, dto.currentPassword, dto.newPassword);
	}

	@Delete("me")
	@HttpCode(HttpStatus.NO_CONTENT)
	async deleteMe(@CurrentUser("id") userId: string) {
		await this.usersService.remove(userId);
	}
}
