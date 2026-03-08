import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class AiQueryDto {
	@IsString()
	@MinLength(1)
	@MaxLength(2000)
	prompt: string;

	@IsOptional()
	@IsString()
	@MaxLength(10000)
	context?: string;
}
