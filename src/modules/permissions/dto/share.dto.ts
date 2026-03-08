import { PermissionRole } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEmail, IsEnum } from "class-validator";

export class ShareDto {
	@IsEmail()
	email: string;

	/** Accept both lowercase ("editor") and uppercase ("EDITOR") from the frontend. */
	@Transform(({ value }) => (typeof value === "string" ? value.toUpperCase() : value))
	@IsEnum(PermissionRole)
	role: PermissionRole;
}
