import { IsOptional, IsString, MaxLength } from "class-validator";

export class CreateSnapshotDto {
	@IsOptional()
	@IsString()
	@MaxLength(200)
	name?: string;
}
