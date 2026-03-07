import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpdateCellDto {
	@IsInt()
	@Min(0)
	row: number;

	@IsInt()
	@Min(0)
	col: number;

	@IsOptional()
	@IsString()
	rawValue?: string;

	@IsOptional()
	@IsString()
	computed?: string;

	@IsOptional()
	@IsString()
	formatted?: string;

	@IsOptional()
	style?: Record<string, unknown>;

	/** Client-known cell version (for optimistic concurrency). Omit to skip conflict check. */
	@IsOptional()
	@IsInt()
	@Min(0)
	baseVersion?: number;
}
