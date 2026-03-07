import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * Payload for the `/ai/agent` endpoint.
 *
 * The agent will autonomously call sheet-inspection tools (cell data, formula errors,
 * statistics, history, anomaly detection) before composing its answer.
 */
export class AgentQueryDto {
	/** Natural-language question or instruction for the agent. */
	@IsString()
	@MinLength(1)
	@MaxLength(2000)
	query: string;

	/** ID of the sheet the agent should inspect. */
	@IsString()
	sheetId: string;

	/**
	 * Optional caller-supplied session identifier.
	 * Reserved for future stateful (multi-turn) agent sessions.
	 */
	@IsOptional()
	@IsString()
	@MaxLength(128)
	sessionId?: string;
}
