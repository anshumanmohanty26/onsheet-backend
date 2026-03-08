import type { BaseMessage, ToolMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { Annotation, END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { z } from "zod";
import { PrismaService } from "../../prisma/prisma.service";
import type { AgentQueryDto } from "./dto/agent-query.dto";
import type { AiQueryDto } from "./dto/ai-query.dto";
import { AI_REDIS } from "./ai.constants";

// ── Agent result ──────────────────────────────────────────────────────────────

/** A single structured action the frontend should apply after the agent completes. */
export interface AgentAction {
	type: "SET_CELLS" | "ADD_COMMENT" | "DELETE_CELLS";
	/** Cells written / cleared, keyed by A1 ref (e.g. "A1"). */
	cells?: Record<string, { raw: string; computed?: string; style?: Record<string, unknown> }>;
	/** Comment content (for ADD_COMMENT). */
	comment?: { row: number; col: number; content: string };
}

/** Shape returned by the `POST /ai/agent` endpoint. */
export interface AgentResult {
	/** Final answer composed by the synthesizer node. */
	answer: string;
	/** Names of every tool the planner node invoked during this run. */
	toolsUsed: string[];
	/** Structured actions that were executed on the sheet (frontend should apply these to local state). */
	actions: AgentAction[];
}

// ── Graph state ───────────────────────────────────────────────────────────────

/**
 * LangGraph state for the OnSheet sheet-analysis agent.
 *
 * Extends {@link MessagesAnnotation} (standard message accumulator) with a
 * `toolsUsed` field that collects tool names across all planner iterations.
 */
const SheetAgentAnnotation = Annotation.Root({
	...MessagesAnnotation.spec,
	toolsUsed: Annotation<string[]>({
		reducer: (existing, incoming) => [...existing, ...incoming],
		default: () => [],
	}),
});

type SheetAgentState = typeof SheetAgentAnnotation.State;

// ── System prompts ────────────────────────────────────────────────────────────

const PLANNER_SYSTEM = [
	"You are OnSheet AI, an expert spreadsheet assistant embedded in OnSheet — a",
	"collaborative spreadsheet application.",
	"",
	"You can READ data and WRITE data to the sheet. Analyse the user query and call",
	"the appropriate tools. NEVER guess or fabricate cell values — use tools.",
	"",
	"READ tools:",
	"  • get_sheet_cells       — fetch raw cell values and formulas (optional range filter)",
	"  • get_sheet_statistics  — aggregate counts and grid dimensions",
	"  • find_formula_errors   — detect #VALUE!, #REF!, #DIV/0! and other error tokens",
	"  • get_cell_history      — retrieve the full edit log for a specific cell",
	"  • find_data_anomalies   — detect duplicate values and mixed-type columns",
	"",
	"WRITE tools:",
	"  • set_cells             — write values/formulas to one or more cells (bulk)",
	"  • delete_cells          — clear cell contents in a range",
	"  • add_comment           — add a comment to a specific cell",
	"",
	"When the user asks you to create data, fill cells, generate tables, add formulas,",
	"or make any change to the sheet, use the WRITE tools to execute those changes.",
	"When filling data, use 0-indexed row/col for tools. Row 0 col 0 = A1.",
	"",
	"Call as many tools as needed. When you have gathered enough information or",
	"completed the requested changes, stop calling tools — the synthesizer will",
	"write the final answer.",
].join("\n");

const SYNTHESIZER_SYSTEM = [
	"You are OnSheet AI. Reply in 1–4 sentences — never longer.",
	"",
	"Hard rules:",
	"  • No preamble. Never start with 'Of course', 'Here is', 'Certainly',",
	"    'Sure', 'I have', 'Great' or any similar filler. Begin with the answer itself.",
	"  • Use A1 notation (row 0 col 0 = A1, row 1 col 1 = B2, etc.).",
	"  • If data was written: state the range and what was written in one sentence.",
	"  • If a formula is broken: show the broken cell, the formula, and the fix.",
	"  • If data was analysed: give the key finding only.",
	"  • Never mention tool names, steps, or internal process.",
].join("\n");

// ── Tool factory ──────────────────────────────────────────────────────────────

/**
 * Creates the LangChain tools (read + write) used by the planner node.
 *
 * Write tools include an `_action` field in their JSON result so that
 * `runAgent` can extract structured actions after the graph completes.
 *
 * @param prisma - Injected Prisma client for live DB access.
 */
function createSheetTools(prisma: PrismaService, userId: string) {
	/**
	 * Fetches raw cell data for a sheet with optional row/column range filtering.
	 * Capped at 500 cells to stay within the LLM context window.
	 */
	const sheetCellsTool = tool(
		async ({
			sheetId,
			rowStart,
			rowEnd,
			colStart,
			colEnd,
		}: {
			sheetId: string;
			rowStart?: number;
			rowEnd?: number;
			colStart?: number;
			colEnd?: number;
		}) => {
			const where: Record<string, unknown> = { sheetId };
			if (rowStart !== undefined) where.row = { gte: rowStart, lte: rowEnd ?? 9999 };
			if (colStart !== undefined) where.col = { gte: colStart, lte: colEnd ?? 702 };

			const cells = await prisma.cell.findMany({
				where,
				select: {
					row: true,
					col: true,
					rawValue: true,
					computed: true,
					version: true,
				},
				orderBy: [{ row: "asc" }, { col: "asc" }],
				take: 500,
			});

			return JSON.stringify(cells);
		},
		{
			name: "get_sheet_cells",
			description:
				"Fetch cell data from a sheet. Returns row/col (0-indexed), rawValue (user input or formula), and computed (evaluated display value). Filter by row/column range. Max 500 cells returned.",
			schema: z.object({
				sheetId: z.string().describe("The sheet ID to fetch cells from"),
				rowStart: z.number().optional().describe("First row to include (0-indexed, inclusive)"),
				rowEnd: z.number().optional().describe("Last row to include (0-indexed, inclusive)"),
				colStart: z.number().optional().describe("First column to include (0-indexed, inclusive)"),
				colEnd: z.number().optional().describe("Last column to include (0-indexed, inclusive)"),
			}),
		},
	);

	/**
	 * Computes aggregate statistics for a sheet.
	 *
	 * Reports total cells, formula count, data cells, empty cells, and grid dimensions.
	 */
	const sheetStatsTool = tool(
		async ({ sheetId }: { sheetId: string }) => {
			const [total, formulaCount, emptyCount, dimensions] = await Promise.all([
				prisma.cell.count({ where: { sheetId } }),
				prisma.cell.count({
					where: { sheetId, rawValue: { startsWith: "=" } },
				}),
				prisma.cell.count({ where: { sheetId, rawValue: null } }),
				prisma.cell.aggregate({
					where: { sheetId },
					_max: { row: true, col: true },
				}),
			]);

			return JSON.stringify({
				totalCells: total,
				formulaCells: formulaCount,
				dataCells: total - emptyCount,
				emptyCells: emptyCount,
				gridRows: (dimensions._max.row ?? -1) + 1,
				gridCols: (dimensions._max.col ?? -1) + 1,
			});
		},
		{
			name: "get_sheet_statistics",
			description:
				"Get aggregate statistics: total populated cells, formula cells, data cells, empty cells, and overall grid dimensions (rows × cols).",
			schema: z.object({
				sheetId: z.string().describe("The sheet ID to get statistics for"),
			}),
		},
	);

	/**
	 * Scans all formula cells and reports those whose computed value contains an
	 * error token: `#VALUE!`, `#REF!`, `#NAME?`, `#DIV/0!`, `#NUM!`, `#N/A`, `#NULL!`.
	 */
	const formulaErrorTool = tool(
		async ({ sheetId }: { sheetId: string }) => {
			const formulas = await prisma.cell.findMany({
				where: { sheetId, rawValue: { startsWith: "=" } },
				select: { row: true, col: true, rawValue: true, computed: true },
			});

			const errorMarkers = ["#VALUE!", "#REF!", "#NAME?", "#DIV/0!", "#NUM!", "#N/A", "#NULL!"];
			const errors = formulas
				.filter((c) => c.computed && errorMarkers.some((m) => c.computed?.includes(m)))
				.map((c) => ({
					row: c.row,
					col: c.col,
					formula: c.rawValue,
					error: c.computed,
				}));

			return JSON.stringify({
				totalFormulas: formulas.length,
				errorCount: errors.length,
				errors,
			});
		},
		{
			name: "find_formula_errors",
			description:
				"Scan every formula in the sheet and report which ones evaluate to error values (#VALUE!, #REF!, #DIV/0!, #NAME?, #NUM!, #N/A, #NULL!). Returns row, col, raw formula, and the error string.",
			schema: z.object({
				sheetId: z.string().describe("The sheet ID to scan for formula errors"),
			}),
		},
	);

	/**
	 * Retrieves the append-only edit history for a single cell from the
	 * `CellOperation` log, ordered newest-first.
	 */
	const cellHistoryTool = tool(
		async ({
			sheetId,
			row,
			col,
			limit,
		}: {
			sheetId: string;
			row: number;
			col: number;
			limit?: number;
		}) => {
			const history = await prisma.cellOperation.findMany({
				where: { sheetId, row, col },
				orderBy: { createdAt: "desc" },
				take: limit ?? 20,
				select: {
					type: true,
					oldValue: true,
					newValue: true,
					userId: true,
					version: true,
					createdAt: true,
				},
			});

			return JSON.stringify(history);
		},
		{
			name: "get_cell_history",
			description:
				"Get the full edit history for a specific cell (row and col are 0-indexed). Returns each change: type, old/new values, who made it, and when.",
			schema: z.object({
				sheetId: z.string(),
				row: z.number().int().min(0).describe("Cell row (0-indexed)"),
				col: z.number().int().min(0).describe("Cell column (0-indexed)"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Max history entries (default 20)"),
			}),
		},
	);

	/**
	 * Performs a data-quality scan detecting duplicate non-formula values within
	 * columns and columns that mix numeric and text data types.
	 *
	 * Scans up to 2 000 cells and caps output at 20 anomaly entries.
	 */
	const dataAnomalyTool = tool(
		async ({ sheetId }: { sheetId: string }) => {
			const cells = await prisma.cell.findMany({
				where: { sheetId, rawValue: { not: null } },
				select: { row: true, col: true, rawValue: true },
				take: 2000,
			});

			const anomalies: Array<{ type: string; detail: string }> = [];
			const byCol = new Map<number, string[]>();

			for (const c of cells) {
				const vals = byCol.get(c.col) ?? [];
				vals.push(c.rawValue ?? "");
				byCol.set(c.col, vals);
			}

			for (const [col, vals] of byCol) {
				const counts = new Map<string, number>();
				for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
				for (const [val, count] of counts) {
					if (count > 1 && !val.startsWith("=")) {
						anomalies.push({
							type: "duplicate_value",
							detail: `Column ${col}: "${val}" appears ${count} times`,
						});
					}
				}

				const nonFormulas = vals.filter((v) => !v.startsWith("="));
				const hasNumeric = nonFormulas.some((v) => !Number.isNaN(Number(v)));
				const hasText = nonFormulas.some((v) => Number.isNaN(Number(v)));
				if (hasNumeric && hasText && nonFormulas.length > 2) {
					anomalies.push({
						type: "mixed_types",
						detail: `Column ${col} mixes numeric and text values`,
					});
				}
			}

			return JSON.stringify({
				anomaliesFound: anomalies.length,
				anomalies: anomalies.slice(0, 20),
			});
		},
		{
			name: "find_data_anomalies",
			description:
				"Scan the sheet for data quality issues: duplicate values within a column, and columns that mix numeric and text data types.",
			schema: z.object({
				sheetId: z.string().describe("The sheet ID to scan for data anomalies"),
			}),
		},
	);

	// ── Helper: convert col index to letter(s) ─────────────────────────────
	const colToLetter = (c: number): string => {
		let s = "";
		let n = c;
		while (n >= 0) {
			s = String.fromCharCode((n % 26) + 65) + s;
			n = Math.floor(n / 26) - 1;
		}
		return s;
	};

	const toA1 = (row: number, col: number) => `${colToLetter(col)}${row + 1}`;

	// ── Write tool: set_cells ──────────────────────────────────────────────
	const setCellsTool = tool(
		async ({
			sheetId,
			cells,
		}: {
			sheetId: string;
			cells: Array<{ row: number; col: number; value: string }>;
		}) => {
			const capped = cells.slice(0, 200);
			const actionCells: Record<string, { raw: string }> = {};

			for (const c of capped) {
				const existing = await prisma.cell.findUnique({
					where: { sheetId_row_col: { sheetId, row: c.row, col: c.col } },
				});
				const nextVersion = (existing?.version ?? 0) + 1;

				await prisma.cell.upsert({
					where: { sheetId_row_col: { sheetId, row: c.row, col: c.col } },
					create: {
						sheetId,
						row: c.row,
						col: c.col,
						rawValue: c.value,
						computed: c.value,
						version: nextVersion,
					},
					update: {
						rawValue: c.value,
						computed: c.value,
						version: nextVersion,
					},
				});

				actionCells[toA1(c.row, c.col)] = { raw: c.value };
			}

			return JSON.stringify({
				success: true,
				cellsWritten: capped.length,
				_action: { type: "SET_CELLS", cells: actionCells } satisfies AgentAction,
				summary: capped
					.slice(0, 5)
					.map((c) => `${toA1(c.row, c.col)}=${c.value}`)
					.join(", ") + (capped.length > 5 ? ` ... and ${capped.length - 5} more` : ""),
			});
		},
		{
			name: "set_cells",
			description:
				"Write values or formulas to one or more cells. Each cell needs row (0-indexed), col (0-indexed), and value (string — prefix with = for formulas). Max 200 cells per call.",
			schema: z.object({
				sheetId: z.string().describe("The sheet ID to write to"),
				cells: z
					.array(
						z.object({
							row: z.number().int().min(0).describe("Row index (0-indexed)"),
							col: z.number().int().min(0).describe("Column index (0-indexed)"),
							value: z.string().describe("Cell value or formula (prefix with = for formulas)"),
						}),
					)
					.min(1)
					.max(200)
					.describe("Array of cells to write"),
			}),
		},
	);

	// ── Write tool: delete_cells ───────────────────────────────────────────
	const deleteCellsTool = tool(
		async ({
			sheetId,
			rowStart,
			rowEnd,
			colStart,
			colEnd,
		}: {
			sheetId: string;
			rowStart: number;
			rowEnd: number;
			colStart: number;
			colEnd: number;
		}) => {
			const deleted = await prisma.cell.deleteMany({
				where: {
					sheetId,
					row: { gte: rowStart, lte: rowEnd },
					col: { gte: colStart, lte: colEnd },
				},
			});

			const actionCells: Record<string, { raw: string }> = {};
			for (let r = rowStart; r <= rowEnd; r++) {
				for (let c = colStart; c <= colEnd; c++) {
					actionCells[toA1(r, c)] = { raw: "" };
				}
			}
			return JSON.stringify({
				success: true,
				cellsDeleted: deleted.count,
				_action: { type: "DELETE_CELLS", cells: actionCells } satisfies AgentAction,
				range: `${toA1(rowStart, colStart)}:${toA1(rowEnd, colEnd)}`,
			});
		},
		{
			name: "delete_cells",
			description:
				"Clear/delete all cells within a rectangular range. All row/col values are 0-indexed and inclusive.",
			schema: z.object({
				sheetId: z.string().describe("The sheet ID"),
				rowStart: z.number().int().min(0).describe("First row (0-indexed, inclusive)"),
				rowEnd: z.number().int().min(0).describe("Last row (0-indexed, inclusive)"),
				colStart: z.number().int().min(0).describe("First column (0-indexed, inclusive)"),
				colEnd: z.number().int().min(0).describe("Last column (0-indexed, inclusive)"),
			}),
		},
	);

	// ── Write tool: add_comment ────────────────────────────────────────────
	const addCommentTool = tool(
		async ({
			sheetId,
			row,
			col,
			content,
		}: {
			sheetId: string;
			row: number;
			col: number;
			content: string;
		}) => {
			await prisma.cellComment.create({
				data: { sheetId, row, col, content, createdBy: userId },
			});

			return JSON.stringify({
				success: true,
				_action: { type: "ADD_COMMENT", comment: { row, col, content } } satisfies AgentAction,
				cell: toA1(row, col),
				content,
			});
		},
		{
			name: "add_comment",
			description:
				"Add a comment to a specific cell. Row and col are 0-indexed.",
			schema: z.object({
				sheetId: z.string().describe("The sheet ID"),
				row: z.number().int().min(0).describe("Cell row (0-indexed)"),
				col: z.number().int().min(0).describe("Cell column (0-indexed)"),
				content: z.string().min(1).max(2000).describe("Comment text"),
			}),
		},
	);

	return [
		sheetCellsTool,
		sheetStatsTool,
		formulaErrorTool,
		cellHistoryTool,
		dataAnomalyTool,
		setCellsTool,
		deleteCellsTool,
		addCommentTool,
	];
}

// ── Graph factory ─────────────────────────────────────────────────────────────

/**
 * Builds and compiles the OnSheet LangGraph agent.
 *
 * The graph contains three explicit nodes:
 *
 * ```
 * START → planner ──(has tool calls?)──► tools ──► planner
 *                 └──(no tool calls)──► synthesizer → END
 * ```
 *
 * - **`planner`** — LLM with all five tools bound. Autonomously decides which
 *   tools to call to gather the data needed to answer the user's query.
 * - **`tools`** — {@link ToolNode} from LangGraph prebuilt. Executes each
 *   tool call requested by the planner and appends {@link ToolMessage}s to state.
 * - **`synthesizer`** — LLM without tools. Receives the full conversation
 *   (including all tool results) and writes a clean, structured final answer.
 *
 * @param llm - Initialised Vertex AI LLM instance.
 * @param prisma - Prisma client for live DB access inside tools.
 */
/** Per-userId cache of bound tool sets. Avoids re-calling llm.bindTools on every request. */
const toolsCache = new Map<string, { llmWithTools: ReturnType<ChatVertexAI["bindTools"]>; toolsNode: ToolNode }>();

function buildSheetAgentGraph(
	llm: ChatVertexAI,
	synthLlm: ChatVertexAI,
	prisma: PrismaService,
	userId: string,
) {
	let cached = toolsCache.get(userId);
	if (!cached) {
		const tools = createSheetTools(prisma, userId);
		cached = { llmWithTools: llm.bindTools(tools), toolsNode: new ToolNode(tools) };
		toolsCache.set(userId, cached);
	}
	const { llmWithTools, toolsNode } = cached;

	/**
	 * Planner node — LLM with tools bound.
	 *
	 * If the LLM decides more data is needed it returns an {@link AIMessage}
	 * with `tool_calls`; the conditional edge then routes to the tools node.
	 * If no tool calls are present the edge routes to the synthesizer.
	 */
	const plannerNode = async (state: SheetAgentState): Promise<Partial<SheetAgentState>> => {
		const response = await llmWithTools.invoke([
			new SystemMessage(PLANNER_SYSTEM),
			...state.messages,
		]);
		return { messages: [response] };
	};

	/**
	 * Synthesizer node — LLM without tools.
	 *
	 * Receives the complete message history (user query + all tool results from
	 * previous planner iterations) and composes a final structured answer.
	 *
	 * A trailing HumanMessage is appended so that Vertex AI always has a user
	 * turn to respond to — without it, a conversation ending in an AIMessage
	 * causes Gemini to return an empty response.
	 */
	const synthesizerNode = async (state: SheetAgentState): Promise<Partial<SheetAgentState>> => {
		const response = await synthLlm.invoke([
			new SystemMessage(SYNTHESIZER_SYSTEM),
			...state.messages,
			new HumanMessage("Compose your final answer for the user now."),
		]);
		return { messages: [response] };
	};

	/**
	 * Conditional edge function after the planner node.
	 *
	 * Routes to `'tools'` when the last AI message contains tool calls,
	 * or to `'synthesizer'` when the planner has gathered enough information.
	 */
	const routeAfterPlanner = (state: SheetAgentState): "tools" | "synthesizer" => {
		const lastMsg = state.messages.at(-1);
		const toolCalls = (lastMsg as AIMessage | undefined)?.tool_calls;
		return toolCalls && toolCalls.length > 0 ? "tools" : "synthesizer";
	};

	return new StateGraph(SheetAgentAnnotation)
		.addNode("planner", plannerNode)
		.addNode("tools", toolsNode)
		.addNode("synthesizer", synthesizerNode)
		.addEdge(START, "planner")
		.addConditionalEdges("planner", routeAfterPlanner)
		.addEdge("tools", "planner")
		.addEdge("synthesizer", END)
		.compile();
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Core AI service powering the OnSheet sheet-analysis agent.
 *
 * Uses **Google Vertex AI Gemini 2.5 Pro** as the LLM and a **LangGraph**
 * `StateGraph` with three explicit nodes — `planner`, `tools`, `synthesizer` —
 * to separate tool orchestration from final answer synthesis.
 *
 * Authentication is resolved automatically by the Google Auth library in this order:
 *  1. `GOOGLE_VERTEX_AI_API_KEY` env var (GCP API key with Vertex AI enabled).
 *  2. `GOOGLE_APPLICATION_CREDENTIALS` env var pointing to a service-account JSON.
 *  3. Application Default Credentials (ADC) via `gcloud auth application-default login`.
 */
// ── Conversation context ─────────────────────────────────────────────────────

/** One stored turn in the per-user conversation history. */
interface StoredMessage {
	role: "human" | "ai";
	content: string;
}

/** TTL for Redis context keys: 2 hours. Resets on every message. */
const CONTEXT_TTL_SECONDS = 7200;

/** Maximum human+ai pairs to retain per conversation. Older turns are dropped. */
const MAX_HISTORY_PAIRS = 10;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class AiService {
	private readonly logger = new Logger(AiService.name);
	private readonly llm: ChatVertexAI;
	/** Dedicated fast LLM for the synthesizer node — always uses flash for low latency. */
	private readonly synthLlm: ChatVertexAI;

	constructor(
		private readonly config: ConfigService,
		private readonly prisma: PrismaService,
		@Inject(AI_REDIS) private readonly redis: Redis,
	) {
		const apiKey = config.get<string>("ai.apiKey");
		const location = config.get<string>("ai.location") ?? "us-central1";
		const model = config.get<string>("ai.model") ?? "gemini-2.5-flash";
		const project = config.get<string>("ai.project");

		const baseOpts = {
			location,
			temperature: 0,
			...(project ? { project } : {}),
			...(apiKey ? { authOptions: { apiKey } } : {}),
		};

		this.llm = new ChatVertexAI({ model, ...baseOpts });

		// Synthesizer always uses flash — it only needs to summarise, not reason.
		// maxOutputTokens caps token generation to keep responses brief and fast.
		this.synthLlm = new ChatVertexAI({
			model: "gemini-2.5-flash",
			maxOutputTokens: 400,
			...baseOpts,
		});

		this.logger.log(`OnSheet AI agent ready — planner: ${model}, synthesizer: gemini-2.5-flash @ ${location}`);
	}

	/**
	 * Loads the stored conversation history for a context key from Redis.
	 * Returns an empty array if the key does not exist or Redis is unavailable.
	 */
	private async loadContext(key: string): Promise<StoredMessage[]> {
		try {
			const raw = await this.redis.get(key);
			if (!raw) return [];
			return JSON.parse(raw) as StoredMessage[];
		} catch {
			return [];
		}
	}

	/**
	 * Appends the latest human+ai turn to the stored history and persists it.
	 * Silently drops the operation if Redis is unavailable.
	 * Trims the history to the last {@link MAX_HISTORY_PAIRS} pairs.
	 */
	private async saveContext(
		key: string,
		existing: StoredMessage[],
		userContent: string,
		aiAnswer: string,
	): Promise<void> {
		try {
			const updated: StoredMessage[] = [
				...existing,
				{ role: "human", content: userContent },
				{ role: "ai", content: aiAnswer },
			];
			const trimmed = updated.slice(-MAX_HISTORY_PAIRS * 2);
			await this.redis.set(key, JSON.stringify(trimmed), "EX", CONTEXT_TTL_SECONDS);
		} catch {
			// Context persistence is best-effort; never fail the AI response over Redis
		}
	}

	async runAgent(dto: AgentQueryDto, userId: string): Promise<AgentResult> {
		// Context key is always scoped to the calling user — never shared across users
		const contextKey = dto.sessionId
			? `ai:ctx:${userId}:${dto.sessionId}`
			: `ai:ctx:${userId}:${dto.sheetId}`;

		const history = await this.loadContext(contextKey);
		this.logger.log(
			`[agent] sheetId=${dto.sheetId} query="${dto.query.slice(0, 80)}" historyTurns=${history.length / 2}`,
		);

		// Reconstruct BaseMessage objects from the stored flat history
		const historyMessages: BaseMessage[] = history.map((m) =>
			m.role === "human" ? new HumanMessage(m.content) : new AIMessage(m.content),
		);

		const currentUserContent = `Sheet ID: ${dto.sheetId}\n\nQuery: ${dto.query}`;

		const graph = buildSheetAgentGraph(this.llm, this.synthLlm, this.prisma, userId);
		const result = await graph.invoke(
			{
				messages: [...historyMessages, new HumanMessage(currentUserContent)],
				toolsUsed: [],
			},
			{ recursionLimit: 15 },
		);

		const messages: BaseMessage[] = result.messages;
		const lastMsg = messages.at(-1);
		const answer =
			typeof lastMsg?.content === "string" ? lastMsg.content : JSON.stringify(lastMsg?.content);

		const toolsUsed = [
			...new Set(
				messages
					.filter((m): m is ToolMessage => m._getType() === "tool")
					.map((m) => m.name ?? "unknown"),
			),
		];

		// Extract structured actions from write-tool results
		const actions: AgentAction[] = [];
		for (const msg of messages) {
			if (msg._getType() !== "tool") continue;
			try {
				const parsed = JSON.parse(typeof msg.content === "string" ? msg.content : "{}");
				if (parsed._action) actions.push(parsed._action);
			} catch {
				// read-only tool or malformed — skip
			}
		}

		// Persist this turn — keyed per user so different users never share context
		await this.saveContext(contextKey, history, currentUserContent, answer);

		return { answer, toolsUsed, actions };
	}

	/**
	 * Suggests a spreadsheet formula matching the natural-language description.
	 *
	 * Uses a single direct LLM call — no tool loop. For formula suggestions that
	 * require inspecting live values, use {@link runAgent} instead.
	 *
	 * @param dto - Prompt describing the desired formula and optional cell context.
	 * @returns The raw formula string (e.g. `=SUMIF(A:A,"Q1",B:B)`).
	 */
	async suggestFormula(dto: AiQueryDto): Promise<{ formula: string }> {
		const userContent = dto.context
			? `Context:\n${dto.context}\n\nRequest: ${dto.prompt}`
			: dto.prompt;

		const response = await this.llm.invoke([
			new SystemMessage(
				"You are a spreadsheet formula expert. Return ONLY the formula string (e.g. =SUM(A1:A10)) with no explanation, no markdown, no punctuation.",
			),
			new HumanMessage(userContent),
		]);

		const formula = typeof response.content === "string" ? response.content.trim() : "";
		return { formula };
	}

	/**
	 * Provides a concise data-analysis answer for the given question and context.
	 *
	 * Uses a single direct LLM call — no tool loop. For questions that require
	 * reading live sheet data from the database, use {@link runAgent} instead.
	 *
	 * @param dto - Question and optional raw spreadsheet data pasted as context.
	 * @returns A concise analysis string.
	 */
	async analyzeData(dto: AiQueryDto): Promise<{ analysis: string }> {
		const userContent = dto.context
			? `Data:\n${dto.context}\n\nQuestion: ${dto.prompt}`
			: dto.prompt;

		const response = await this.llm.invoke([
			new SystemMessage(
				"You are a data analyst assistant. Given a user question and optional spreadsheet data context, provide a concise, actionable analysis.",
			),
			new HumanMessage(userContent),
		]);

		const analysis = typeof response.content === "string" ? response.content.trim() : "";
		return { analysis };
	}
}
