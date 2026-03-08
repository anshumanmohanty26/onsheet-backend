import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class UsersService {
	constructor(private readonly prisma: PrismaService) {}

	findById(id: string) {
		return this.prisma.user.findUnique({ where: { id } });
	}

	findByEmail(email: string) {
		return this.prisma.user.findUnique({ where: { email } });
	}

	create(data: Prisma.UserCreateInput) {
		return this.prisma.user.create({ data });
	}

	update(id: string, data: Prisma.UserUpdateInput) {
		return this.prisma.user.update({ where: { id }, data });
	}

	async changePassword(id: string, currentPassword: string, newPassword: string) {
		const user = await this.prisma.user.findUnique({ where: { id } });
		if (!user) throw new BadRequestException("User not found");
		const valid = await bcrypt.compare(currentPassword, user.passwordHash);
		if (!valid) throw new BadRequestException("Current password is incorrect");
		const passwordHash = await bcrypt.hash(newPassword, 12);
		await this.prisma.user.update({ where: { id }, data: { passwordHash } });
	}

	updateRefreshToken(id: string, refreshToken: string | null) {
		return this.prisma.user.update({ where: { id }, data: { refreshToken } });
	}

	clearRefreshToken(id: string) {
		return this.updateRefreshToken(id, null);
	}

	remove(id: string) {
		return this.prisma.user.delete({ where: { id } });
	}
}
