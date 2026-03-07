import { PermissionRole } from "@prisma/client";
import { IsEmail, IsEnum } from "class-validator";

export class ShareDto {
	@IsEmail()
	email: string;

	@IsEnum(PermissionRole)
	role: PermissionRole;
}
