import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class UpdateSheetDto {
	@IsOptional()
	@IsString()
	@MaxLength(100)
	name?: string;

	@IsOptional()
	@IsInt()
	@Min(0)
	index?: number;
}
