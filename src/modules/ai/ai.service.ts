import type { AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentQueryDto } from './dto/agent-query.dto';
import { AiQueryDto } from './dto/ai-query.dto';

// ── Agent result ──────────────────────────────────────────────────────────────

/** Shape returned by the `POST /ai/agent` endpoint. */
export interface AgentResult {
  /** Final answer composed by the synthesizer node. */
  answer: string;
  /** Names of every tool the planner node invoked during this run. */
  toolsUsed: string[];
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
  /**
   * Accumulates tool names invoked throughout the agent run.
   * Each call to a node that returns tool names is merged via the reducer.
   */
  toolsUsed: Annotation<string[]>({
    reducer: (existing, incoming) => [...existing, ...incoming],
    default: () => [],
  }),
});

type SheetAgentState = typeof SheetAgentAnnotation.State;

// ── System prompts ────────────────────────────────────────────────────────────

const PLANNER_SYSTEM = [
  'You are OnSheet AI, an expert spreadsheet analyst embedded in OnSheet — a',
  'collaborative spreadsheet application.',
  '',
  'Your role at this stage is to GATHER INFORMATION by calling the appropriate tools.',
  'Analyse the user query and call every tool needed to answer it accurately.',
  'NEVER guess or fabricate cell values, formulas, or statistics — use tools.',
  '',
  'Available tools:',
  '  • get_sheet_cells       — fetch raw cell values and formulas (optional range filter)',
  '  • get_sheet_statistics  — aggregate counts and grid dimensions',
  '  • find_formula_errors   — detect #VALUE!, #REF!, #DIV/0! and other error tokens',
  '  • get_cell_history      — retrieve the full edit log for a specific cell',
  '  • find_data_anomalies   — detect duplicate values and mixed-type columns',
  '',
  'Call as many tools as needed. When you have gathered enough information,',
  'stop calling tools — the synthesizer will write the final answer.',
].join('\n');

const SYNTHESIZER_SYSTEM = [
  'You are OnSheet AI, an expert spreadsheet analyst.',
  '',
  'Tool results from the previous steps are included in this conversation.',
  'Your task is to compose a final, clear, actionable answer for the user.',
  '',
  'Guidelines:',
  '  • Convert 0-indexed row/col to A1 notation where helpful (row 0, col 0 = A1).',
  '  • When a formula is broken, show the broken formula and a suggested fix.',
  '  • Use bullet points or numbered lists for multiple findings.',
  '  • Be specific and actionable — diagnose root causes, not just symptoms.',
  '  • Do not mention tool names or internal steps — speak directly to the user.',
].join('\n');

// ── Tool factory ──────────────────────────────────────────────────────────────

/**
 * Creates the five sheet-inspection LangChain tools used by the planner node.
 *
 * Tools are pure closures over `prisma` — no class state required.
 *
 * @param prisma - Injected Prisma client for live DB access.
 */
function createSheetTools(prisma: PrismaService) {
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
        select: { row: true, col: true, rawValue: true, computed: true, version: true },
        orderBy: [{ row: 'asc' }, { col: 'asc' }],
        take: 500,
      });

      return JSON.stringify(cells);
    },
    {
      name: 'get_sheet_cells',
      description:
        'Fetch cell data from a sheet. Returns row/col (0-indexed), rawValue (user input or formula), and computed (evaluated display value). Filter by row/column range. Max 500 cells returned.',
      schema: z.object({
        sheetId: z.string().describe('The sheet ID to fetch cells from'),
        rowStart: z.number().optional().describe('First row to include (0-indexed, inclusive)'),
        rowEnd: z.number().optional().describe('Last row to include (0-indexed, inclusive)'),
        colStart: z.number().optional().describe('First column to include (0-indexed, inclusive)'),
        colEnd: z.number().optional().describe('Last column to include (0-indexed, inclusive)'),
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
        prisma.cell.count({ where: { sheetId, rawValue: { startsWith: '=' } } }),
        prisma.cell.count({ where: { sheetId, rawValue: null } }),
        prisma.cell.aggregate({ where: { sheetId }, _max: { row: true, col: true } }),
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
      name: 'get_sheet_statistics',
      description:
        'Get aggregate statistics: total populated cells, formula cells, data cells, empty cells, and overall grid dimensions (rows × cols).',
      schema: z.object({
        sheetId: z.string().describe('The sheet ID to get statistics for'),
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
        where: { sheetId, rawValue: { startsWith: '=' } },
        select: { row: true, col: true, rawValue: true, computed: true },
      });

      const errorMarkers = ['#VALUE!', '#REF!', '#NAME?', '#DIV/0!', '#NUM!', '#N/A', '#NULL!'];
      const errors = formulas
        .filter((c) => c.computed && errorMarkers.some((m) => c.computed?.includes(m)))
        .map((c) => ({ row: c.row, col: c.col, formula: c.rawValue, error: c.computed }));

      return JSON.stringify({ totalFormulas: formulas.length, errorCount: errors.length, errors });
    },
    {
      name: 'find_formula_errors',
      description:
        'Scan every formula in the sheet and report which ones evaluate to error values (#VALUE!, #REF!, #DIV/0!, #NAME?, #NUM!, #N/A, #NULL!). Returns row, col, raw formula, and the error string.',
      schema: z.object({
        sheetId: z.string().describe('The sheet ID to scan for formula errors'),
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
        orderBy: { createdAt: 'desc' },
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
      name: 'get_cell_history',
      description:
        'Get the full edit history for a specific cell (row and col are 0-indexed). Returns each change: type, old/new values, who made it, and when.',
      schema: z.object({
        sheetId: z.string(),
        row: z.number().int().min(0).describe('Cell row (0-indexed)'),
        col: z.number().int().min(0).describe('Cell column (0-indexed)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Max history entries (default 20)'),
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
        vals.push(c.rawValue ?? '');
        byCol.set(c.col, vals);
      }

      for (const [col, vals] of byCol) {
        const counts = new Map<string, number>();
        for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
        for (const [val, count] of counts) {
          if (count > 1 && !val.startsWith('=')) {
            anomalies.push({
              type: 'duplicate_value',
              detail: `Column ${col}: "${val}" appears ${count} times`,
            });
          }
        }

        const nonFormulas = vals.filter((v) => !v.startsWith('='));
        const hasNumeric = nonFormulas.some((v) => !Number.isNaN(Number(v)));
        const hasText = nonFormulas.some((v) => Number.isNaN(Number(v)));
        if (hasNumeric && hasText && nonFormulas.length > 2) {
          anomalies.push({
            type: 'mixed_types',
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
      name: 'find_data_anomalies',
      description:
        'Scan the sheet for data quality issues: duplicate values within a column, and columns that mix numeric and text data types.',
      schema: z.object({
        sheetId: z.string().describe('The sheet ID to scan for data anomalies'),
      }),
    },
  );

  return [sheetCellsTool, sheetStatsTool, formulaErrorTool, cellHistoryTool, dataAnomalyTool];
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
function buildSheetAgentGraph(llm: ChatVertexAI, prisma: PrismaService) {
  const tools = createSheetTools(prisma);
  const llmWithTools = llm.bindTools(tools);
  const toolsNode = new ToolNode(tools);

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
   */
  const synthesizerNode = async (state: SheetAgentState): Promise<Partial<SheetAgentState>> => {
    const response = await llm.invoke([new SystemMessage(SYNTHESIZER_SYSTEM), ...state.messages]);
    return { messages: [response] };
  };

  /**
   * Conditional edge function after the planner node.
   *
   * Routes to `'tools'` when the last AI message contains tool calls,
   * or to `'synthesizer'` when the planner has gathered enough information.
   */
  const routeAfterPlanner = (state: SheetAgentState): 'tools' | 'synthesizer' => {
    const lastMsg = state.messages.at(-1);
    const toolCalls = (lastMsg as AIMessage | undefined)?.tool_calls;
    return toolCalls && toolCalls.length > 0 ? 'tools' : 'synthesizer';
  };

  return new StateGraph(SheetAgentAnnotation)
    .addNode('planner', plannerNode)
    .addNode('tools', toolsNode)
    .addNode('synthesizer', synthesizerNode)
    .addEdge(START, 'planner')
    .addConditionalEdges('planner', routeAfterPlanner)
    .addEdge('tools', 'planner')
    .addEdge('synthesizer', END)
    .compile();
}

/** TypeScript type of the compiled agent graph (inferred from the factory). */
type AgentGraph = ReturnType<typeof buildSheetAgentGraph>;

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
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly llm: ChatVertexAI;
  private readonly graph: AgentGraph;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = config.get<string>('ai.apiKey');
    const location = config.get<string>('ai.location') ?? 'us-central1';
    const model = config.get<string>('ai.model') ?? 'gemini-2.5-pro';
    const project = config.get<string>('ai.project');

    this.llm = new ChatVertexAI({
      model,
      location,
      temperature: 0,
      ...(project ? { project } : {}),
      ...(apiKey ? { authOptions: { apiKey } } : {}),
    });

    // Compile the graph once at startup — it is stateless and safe to reuse.
    this.graph = buildSheetAgentGraph(this.llm, prisma);
    this.logger.log(`OnSheet AI agent ready: ${model} @ ${location}`);
  }

  /**
   * Runs the full LangGraph agent for a natural-language spreadsheet query.
   *
   * Execution flow:
   *  1. `planner` calls tools until enough data is gathered.
   *  2. `tools` (`ToolNode`) executes each requested tool call.
   *  3. `synthesizer` composes the final structured answer.
   *
   * The recursion limit (15 steps) prevents infinite loops under adversarial
   * or ambiguous inputs.
   *
   * @param dto - Agent query payload: sheet ID and user question.
   * @returns Final answer string and a deduplicated list of tool names used.
   */
  async runAgent(dto: AgentQueryDto): Promise<AgentResult> {
    this.logger.log(`[agent] sheetId=${dto.sheetId} query="${dto.query.slice(0, 80)}"`);

    const result = await this.graph.invoke(
      {
        messages: [new HumanMessage(`Sheet ID: ${dto.sheetId}\n\nQuery: ${dto.query}`)],
        toolsUsed: [],
      },
      { recursionLimit: 15 },
    );

    const messages: BaseMessage[] = result.messages;
    const lastMsg = messages.at(-1);
    const answer =
      typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content);

    const toolsUsed = [
      ...new Set(
        messages
          .filter((m) => m._getType() === 'tool')
          .map((m) => (m as unknown as { name?: string }).name ?? 'unknown'),
      ),
    ];

    return { answer, toolsUsed };
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
        'You are a spreadsheet formula expert. Return ONLY the formula string (e.g. =SUM(A1:A10)) with no explanation, no markdown, no punctuation.',
      ),
      new HumanMessage(userContent),
    ]);

    const formula = typeof response.content === 'string' ? response.content.trim() : '';
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
        'You are a data analyst assistant. Given a user question and optional spreadsheet data context, provide a concise, actionable analysis.',
      ),
      new HumanMessage(userContent),
    ]);

    const analysis = typeof response.content === 'string' ? response.content.trim() : '';
    return { analysis };
  }
}
