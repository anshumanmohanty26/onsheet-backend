import { Body, Controller, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AiService } from "./ai.service";
import { AgentQueryDto } from "./dto/agent-query.dto";
import { AiQueryDto } from "./dto/ai-query.dto";

/**
 * REST controller exposing the OnSheet AI agent and LLM-utility endpoints.
 *
 * All routes are rate-limited by the `ai` throttler (20 req / min by default).
 */
@Throttle({ ai: { limit: 20, ttl: 60_000 } })
@Controller("ai")
export class AiController {
	constructor(private readonly aiService: AiService) {}

	/**
	 * Runs the autonomous LangGraph ReAct agent against a live sheet.
	 *
	 * The agent inspects cell data, formulas, statistics, history, and anomalies
	 * before composing its answer. Suitable for open-ended sheet analysis.
	 *
	 * `POST /ai/agent`
	 */
	@Post("agent")
	runAgent(@Body() dto: AgentQueryDto) {
		return this.aiService.runAgent(dto);
	}

	/**
	 * Suggests a spreadsheet formula matching the natural-language description.
	 *
	 * `POST /ai/formula`
	 */
	@Post("formula")
	suggestFormula(@Body() dto: AiQueryDto) {
		return this.aiService.suggestFormula(dto);
	}

	/**
	 * Provides a concise analysis of the supplied spreadsheet data and question.
	 *
	 * For questions that require reading live sheet data from the database, use
	 * `POST /ai/agent` instead.
	 *
	 * `POST /ai/analyze`
	 */
	@Post("analyze")
	analyzeData(@Body() dto: AiQueryDto) {
		return this.aiService.analyzeData(dto);
	}
}
