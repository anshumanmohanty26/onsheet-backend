import { IsOptional, IsString, MaxLength } from "class-validator";

export class CreateSheetDto {
	@IsOptional()
	@IsString()
	@MaxLength(100)
	name?: string;
}
