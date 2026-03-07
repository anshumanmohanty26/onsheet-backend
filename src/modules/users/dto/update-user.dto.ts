import { IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

export class UpdateUserDto {
	@IsOptional()
	@IsString()
	@MaxLength(80)
	displayName?: string;

	@IsOptional()
	@IsUrl()
	avatarUrl?: string;
}
