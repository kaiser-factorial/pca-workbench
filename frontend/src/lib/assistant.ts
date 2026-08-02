import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

// The assistant runs entirely in the browser with the user's own API key,
// speaking the OpenAI-compatible protocol. Default endpoint is OpenRouter
// (one key, any model); any compatible endpoint works — including local
// runtimes like Ollama/LM Studio for a fully-offline assistant.
//
// Privacy contract: tools expose column METADATA and AGGREGATE summaries only —
// raw data rows are never placed in a request.

export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';

export type ColumnProfile = {
  name: string;
  kind: 'numeric' | 'categorical';
  min?: number;
  max?: number;
  missing: number;
  nUnique?: number;
  topCategories?: { value: string; count: number }[];
};

// The page implements this; the assistant drives the app through it.
export type AppBridge = {
  getState: () => {
    datasets: { name: string; nRows: number; active: boolean }[];
    columns: ColumnProfile[];
    axes: { x: string; y: string; z: string | null };
    colorBy: string;
    viewMode: '2D' | '3D';
    pinnedViews: number;
    clusterSettings: { method: string; eps: number; minSamples: number; k: number };
  };
  setPlot: (opts: { x?: string; y?: string; z?: string; color_by?: string; view_mode?: '2D' | '3D' }) => string;
  runClustering: (method: 'DBSCAN' | 'KMEANS', opts: { eps?: number; min_samples?: number; k?: number }) => string;
  getClusterBreakdown: (attribute: string) => string;
  pinView: () => string;
  loadDemoData: () => Promise<string>;
  // analysis (aggregates only)
  runPCA: (opts: { variables?: string[]; n_components?: number; standardize?: boolean }) => string;
  correlate: (colA: string, colB: string) => string;
  compareGroups: (numericCol: string, groupCol: string) => string;
  suggestK: (maxK: number) => string;
  suggestEps: (minSamples: number) => string;
  // app management
  switchDataset: (name: string) => string;
  setCategoryVisibility: (categories: string[], state: 'normal' | 'muted' | 'hidden') => string;
  transferColumn: (opts: { source_dataset: string; column: string; mode?: 'order' | 'match'; key_column?: string; new_name?: string }) => string;
  removePin: (index: number) => string;
  saveWorkspaceAs: (name: string) => Promise<string>;
  // undo support: snapshot/restore the whole view state
  snapshot: () => unknown;
  restore: (snap: unknown) => void;
};

// Tools that change what the user sees — a turn using any of these offers Undo
export const MUTATING_TOOLS = new Set([
  'set_plot', 'run_clustering', 'pin_view', 'load_demo_data',
  'switch_dataset', 'set_category_visibility', 'transfer_column', 'remove_pin',
  'run_pca',
]);

// Curated tutorial chunks — the single source of truth the assistant teaches
// from, so tour answers describe the UI as it actually is.
export const TUTORIAL: Record<string, string> = {
  overview:
    'Scatter Lab turns tabular data into interactive 2D/3D scatter plots, entirely in the browser — nothing is uploaded anywhere. Typical flow: add a dataset → assign variables to axes and color in the Variables panel → optionally cluster → pin views to compare → export.',
  load_data:
    'Add data via the dropzone in the sidebar ("1. Data") — drag a CSV, XLSX, or Parquet file in, or click to browse, then press "Add Dataset". Datasets with PC score columns plot immediately. Optionally, "+ Project through a PCA components file" reveals a second dropzone: supply a loadings file and the app median-imputes, standardizes, and computes PC1–PC3 itself. Several datasets can be loaded at once; click one in the list to make it active.',
  variables:
    'The Variables panel ("2. Variables") is both data profile and plot control. Every column shows its type, range or category count, missing values, and a mini-histogram. The small buttons on each row do the plotting: X, Y, Z put a numeric column on that axis; C colors the points by that column. If a components file was used, "Top PC contributors" shows which variables load on each PC.',
  plotting:
    'The View section ("3. View") switches 2D/3D, toggles axis grids, renames axis labels for exports, and starts an auto-rotation of the 3D camera. Drag the plot to rotate manually, scroll to zoom. The legend panel on the right can mute (click once) or hide (click twice) individual categories.',
  pca:
    'The PCA section ("3. PCA") runs a principal component analysis right in the browser: tick which numeric variables to include, choose how many components to keep, and press Run. Standardize (on by default) makes it a correlation-based PCA — the right choice when variables are on different scales. Scores are added as PC1…PCk columns and plotted immediately; the scree bars show variance explained per component, and "Top PC contributors" lists each component\'s strongest loadings. Alternatively, a precomputed components file can be supplied at upload time.',
  clustering:
    'In "4. Cluster", pick DBSCAN (density-based; eps = neighborhood radius, min samples = density threshold; points in no cluster become gray "Noise") or K-Means (choose k). Clustering runs on the currently plotted axes and adds a Cluster column, which also becomes the point coloring. Below the button, "Cluster info by" cross-tabulates clusters against any categorical variable — "% of cluster" shows composition, "% of group" normalizes away base rates.',
  compare_pin:
    '"Pin View" (section 5) freezes the current plot as a snapshot; the canvas tiles into a grid (up to 4 panes) so different axis choices, colorings, or cluster runs can be compared side by side. The live view keeps updating; pins do not.',
  transfer:
    'With two or more datasets loaded, "Transfer column from another dataset" (bottom of the Data section) copies a column — typically Cluster labels — into the active dataset, aligned by row order (with an automatic identity check) or by a shared key column. This lets you e.g. color one projection space by clusters found in another.',
  export:
    'Section 5 exports the active view: PNG (2x resolution), a rotating GIF of the 3D view, or a self-contained interactive HTML file that works offline — nice for sending a spinnable 3D plot to a collaborator. "Add title & legend to exports" controls the dressing.',
  workspaces:
    'The Workspace section saves the entire session — datasets, pins, notes, settings — locally in the browser (IndexedDB). "Export as file" downloads a workspace as a shareable file; "Import file" loads one. Nothing syncs to any server.',
  privacy:
    'All parsing, projection, and clustering run in the browser; data never leaves the machine. The assistant is the one opt-in exception: it sends column names and aggregate summaries (never raw rows) to the configured model API, using your own key.',
};

export const TUTORIAL_TOPICS = Object.keys(TUTORIAL);

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_app_state',
      description:
        'Read the current state of the workbench: loaded datasets, all column profiles (name, type, range, missing count, top categories), current plot axes, coloring, view mode, pinned view count, and clustering settings. Call this before answering questions about the data or changing the plot.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_plot',
      description:
        'Change what the scatter plot shows. Any combination of: assign a numeric column to the x, y, or z axis; color points by any column; switch between 2D and 3D. Omitted fields are left unchanged.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'string', description: 'Numeric column for the X axis' },
          y: { type: 'string', description: 'Numeric column for the Y axis' },
          z: { type: 'string', description: 'Numeric column for the Z axis (3D only)' },
          color_by: { type: 'string', description: 'Column to color points by' },
          view_mode: { type: 'string', enum: ['2D', '3D'] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_clustering',
      description:
        'Run clustering on the currently plotted axes and color the points by the result. DBSCAN takes eps and min_samples; KMEANS takes k. Returns the cluster sizes.',
      parameters: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['DBSCAN', 'KMEANS'] },
          eps: { type: 'number', description: 'DBSCAN neighborhood radius (default 0.5)' },
          min_samples: { type: 'integer', description: 'DBSCAN min points per core (default 5)' },
          k: { type: 'integer', description: 'KMEANS cluster count (default 3)' },
        },
        required: ['method'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_cluster_breakdown',
      description:
        'After clustering, get the composition of each cluster by a categorical attribute (percentages and counts). Useful for interpreting what the clusters mean.',
      parameters: {
        type: 'object',
        properties: {
          attribute: { type: 'string', description: 'Categorical column to break clusters down by' },
        },
        required: ['attribute'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pin_view',
      description:
        'Pin the current plot as a snapshot so the user can compare it side-by-side with new views (max 3 pins).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_tutorial',
      description:
        `Fetch curated tutorial sections describing how Scatter Lab works. Use this whenever the user asks for a tour, asks how the app or a feature works, or seems lost — then teach from the returned text (do not invent UI details). Available topics: ${TUTORIAL_TOPICS.join(', ')}. Omit topics to get all sections.`,
      parameters: {
        type: 'object',
        properties: {
          topics: {
            type: 'array',
            items: { type: 'string', enum: TUTORIAL_TOPICS },
            description: 'Which sections to fetch; omit for all',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'load_demo_data',
      description:
        'Load the built-in demo dataset (synthetic survey, 300 rows, with PCA components). Useful during a tour or when the user has no data loaded and wants to see the app in action.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_pca',
      description:
        'Run a principal component analysis on numeric variables of the active dataset, entirely in the browser. Adds PC1..PCk score columns, reports variance explained and top loadings, and plots the first components. Defaults: all numeric non-PC variables, 3 components, standardized (correlation PCA).',
      parameters: {
        type: 'object',
        properties: {
          variables: { type: 'array', items: { type: 'string' }, description: 'Numeric columns to include (default: all numeric non-PC columns)' },
          n_components: { type: 'integer', description: '2-10, default 3' },
          standardize: { type: 'boolean', description: 'Default true (correlation-based PCA)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'correlate',
      description:
        'Correlation between two numeric columns: Pearson r, Spearman rho, and n (pairwise-complete). Use for "is X related to Y" questions.',
      parameters: {
        type: 'object',
        properties: {
          col_a: { type: 'string' },
          col_b: { type: 'string' },
        },
        required: ['col_a', 'col_b'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_groups',
      description:
        'Compare a numeric column across the levels of a categorical column: per-group n/mean/sd, overall stats, and eta-squared (share of variance explained by group). Use for "does X differ by Y" questions.',
      parameters: {
        type: 'object',
        properties: {
          numeric_col: { type: 'string' },
          group_col: { type: 'string', description: 'Categorical column defining the groups' },
        },
        required: ['numeric_col', 'group_col'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_k',
      description:
        'K-Means diagnostics on the currently plotted axes: mean silhouette score for each k from 2 upward (higher = better-separated clusters). Use before run_clustering to recommend k.',
      parameters: {
        type: 'object',
        properties: {
          max_k: { type: 'integer', description: 'Highest k to evaluate (default 8, max 12)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_eps',
      description:
        'DBSCAN diagnostics on the currently plotted axes: percentiles of the k-distance curve (distance to each point\'s min_samples-th neighbor). A good eps usually sits near the curve\'s knee, around the 90th-95th percentile. Use before run_clustering with DBSCAN.',
      parameters: {
        type: 'object',
        properties: {
          min_samples: { type: 'integer', description: 'min_samples the user intends to use (default: current setting)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'switch_dataset',
      description: 'Make a different loaded dataset the active one (the one being plotted).',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Dataset name as shown in the sidebar list' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_category_visibility',
      description:
        'Mute (fade), hide, or restore categories of the current color-by column in the plot and legend.',
      parameters: {
        type: 'object',
        properties: {
          categories: { type: 'array', items: { type: 'string' }, description: 'Category values to change' },
          state: { type: 'string', enum: ['normal', 'muted', 'hidden'] },
        },
        required: ['categories', 'state'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transfer_column',
      description:
        'Copy a column (typically Cluster labels) from another loaded dataset into the active one, aligned by row order or by a shared key column. Reports how many rows matched — warn the user if alignment looks wrong.',
      parameters: {
        type: 'object',
        properties: {
          source_dataset: { type: 'string' },
          column: { type: 'string' },
          mode: { type: 'string', enum: ['order', 'match'], description: 'order = align by row position (default); match = join on key_column' },
          key_column: { type: 'string', description: 'Shared key column, required for mode=match' },
          new_name: { type: 'string', description: 'Name for the new column (default: column·source)' },
        },
        required: ['source_dataset', 'column'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_pin',
      description: 'Remove a pinned view by its position (1 = oldest pin).',
      parameters: {
        type: 'object',
        properties: { index: { type: 'integer', description: '1-based pin position' } },
        required: ['index'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_workspace',
      description:
        'Save the whole session (datasets, pins, settings, notes) as a named workspace in the browser. This persists outside the view state and is NOT covered by undo.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
];

const fmtNum = (v: number | undefined) =>
  v === undefined ? '?' : Math.abs(v) >= 100 ? v.toFixed(0) : String(Math.round(v * 100) / 100);

export const buildSystemPrompt = (bridge: AppBridge): string => {
  const s = bridge.getState();
  const cols = s.columns
    .map(c =>
      c.kind === 'numeric'
        ? `- ${c.name}: numeric, ${fmtNum(c.min)}–${fmtNum(c.max)}${c.missing ? `, ${c.missing} missing` : ''}`
        : `- ${c.name}: categorical (${c.nUnique} values: ${(c.topCategories ?? [])
            .slice(0, 6)
            .map(t => `${t.value} n=${t.count}`)
            .join(', ')})${c.missing ? `, ${c.missing} missing` : ''}`
    )
    .join('\n');

  return `You are the built-in assistant of Scatter Lab, a browser-based workbench where researchers explore tabular data as interactive 2D/3D scatter plots, project data through PCA components, run DBSCAN/K-Means clustering, and compare pinned views. The user is typically a survey researcher.

You can drive the app with your tools: change plot axes and coloring, switch 2D/3D or the active dataset, run clustering, read cluster compositions, mute/hide legend categories, transfer columns between datasets, pin/remove views, and save workspaces. You also have aggregate analysis tools: run_pca (in-browser principal component analysis — use it when the user wants to reduce dimensions or "see the structure" of a set of scale items), correlate (Pearson/Spearman), compare_groups (means by category + eta-squared), and clustering diagnostics (suggest_k silhouette scores, suggest_eps k-distance percentiles) — prefer running these over guessing parameters or relationships. Use tools to act, then summarize what you did in one or two sentences. When the user asks a question about their data, answer from the column profiles and aggregate tool results — never invent numbers you have not seen in this conversation.

You see column metadata and aggregate statistics only; you never see raw data rows. If asked about individual rows or participants, explain that you only have access to summaries.

Statistical guidance is welcome: help interpret PC loadings, choose sensible eps/min_samples or k, and reason about what cluster compositions suggest — while being clear about the limits of exploratory clustering (results depend on parameters; clusters are descriptive, not proof of latent groups).

Tours: when the user asks for a tour, asks how the app works, or seems new, call get_tutorial and teach from it — never invent UI details. Go step by step, not all at once: pick the sections that match their situation (no data yet → start with load_data), and demonstrate live where it helps — load_demo_data, then set_plot or run_clustering, narrating briefly. End each step by offering the next one.

Keep responses short and concrete. This is a side panel, not a report.

Current session:
${s.datasets.length === 0 ? 'No dataset loaded yet — suggest loading one (there is a demo dataset button on the empty canvas).' : `Datasets: ${s.datasets.map(d => `${d.name} (${d.nRows} rows${d.active ? ', active' : ''})`).join('; ')}
Plot: ${s.viewMode}, x=${s.axes.x}, y=${s.axes.y}${s.axes.z ? `, z=${s.axes.z}` : ''}, colored by ${s.colorBy}. Pinned views: ${s.pinnedViews}/3.
Columns of the active dataset:
${cols}`}`;
};

export type StreamHandlers = {
  onText: (delta: string) => void;
  onToolUse: (name: string, argsSummary?: string) => void;
};

// Compact "k=v" rendering of tool arguments for the chat's tool chips
export const summarizeArgs = (argsJson: string): string => {
  try {
    const o = JSON.parse(argsJson || '{}');
    const s = Object.entries(o)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : String(v)}`)
      .join(' ');
    return s.length > 70 ? s.slice(0, 67) + '…' : s;
  } catch {
    return '';
  }
};

const makeClient = (apiKey: string, baseURL: string) =>
  new OpenAI({
    apiKey,
    baseURL,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    defaultHeaders: {
      'HTTP-Referer': 'https://scatter-lab.vercel.app',
      'X-Title': 'Scatter Lab',
    },
  });

// One user turn: stream the response, execute any tool calls, loop until the
// model stops asking for tools. Returns the updated history.
export const runAssistantTurn = async (
  apiKey: string,
  baseURL: string,
  model: string,
  history: ChatCompletionMessageParam[],
  userText: string,
  bridge: AppBridge,
  handlers: StreamHandlers,
): Promise<ChatCompletionMessageParam[]> => {
  const client = makeClient(apiKey, baseURL);
  const messages: ChatCompletionMessageParam[] = [...history, { role: 'user', content: userText }];

  const executeTool = async (name: string, argsJson: string): Promise<string> => {
    let input: any = {};
    try {
      input = argsJson ? JSON.parse(argsJson) : {};
    } catch {
      return 'Tool error: arguments were not valid JSON.';
    }
    try {
      switch (name) {
        case 'get_app_state':
          return JSON.stringify(bridge.getState());
        case 'set_plot':
          return bridge.setPlot(input ?? {});
        case 'run_clustering':
          return bridge.runClustering(input.method, input);
        case 'get_cluster_breakdown':
          return bridge.getClusterBreakdown(input.attribute);
        case 'pin_view':
          return bridge.pinView();
        case 'get_tutorial': {
          const topics: string[] = Array.isArray(input?.topics) && input.topics.length ? input.topics : TUTORIAL_TOPICS;
          return topics
            .filter(t => TUTORIAL[t])
            .map(t => `## ${t}\n${TUTORIAL[t]}`)
            .join('\n\n') || `Unknown topics. Available: ${TUTORIAL_TOPICS.join(', ')}.`;
        }
        case 'load_demo_data':
          return await bridge.loadDemoData();
        case 'run_pca':
          return bridge.runPCA(input ?? {});
        case 'correlate':
          return bridge.correlate(input.col_a, input.col_b);
        case 'compare_groups':
          return bridge.compareGroups(input.numeric_col, input.group_col);
        case 'suggest_k':
          return bridge.suggestK(Math.min(input?.max_k ?? 8, 12));
        case 'suggest_eps':
          return bridge.suggestEps(input?.min_samples);
        case 'switch_dataset':
          return bridge.switchDataset(input.name);
        case 'set_category_visibility':
          return bridge.setCategoryVisibility(input.categories ?? [], input.state);
        case 'transfer_column':
          return bridge.transferColumn(input);
        case 'remove_pin':
          return bridge.removePin(input.index);
        case 'save_workspace':
          return await bridge.saveWorkspaceAs(input.name);
        default:
          return `Unknown tool: ${name}`;
      }
    } catch (err: any) {
      return `Tool error: ${err?.message ?? err}`;
    }
  };

  const MAX_LOOPS = 8;
  for (let i = 0; i < MAX_LOOPS; i++) {
    const stream = client.chat.completions.stream({
      model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: buildSystemPrompt(bridge) },
        ...messages,
      ],
      tools: TOOLS,
    });

    stream.on('content', delta => handlers.onText(delta));
    const completion = await stream.finalChatCompletion();
    const choice = completion.choices[0];
    if (!choice) throw new Error('Empty response from the model.');
    const msg = choice.message;

    // Keep the assistant turn (content and/or tool_calls) in history
    messages.push({
      role: 'assistant',
      content: msg.content ?? '',
      ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
    } as ChatCompletionMessageParam);

    if (!msg.tool_calls?.length) return messages;

    for (const call of msg.tool_calls) {
      if (call.type !== 'function') continue;
      handlers.onToolUse(call.function.name, summarizeArgs(call.function.arguments));
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: await executeTool(call.function.name, call.function.arguments),
      });
      // Yield a macrotask so React commits state between sequential tool calls —
      // otherwise a later call in the same response reads the pre-update bridge
      await new Promise(r => setTimeout(r, 30));
    }
  }
  handlers.onText('\n[Stopped: too many tool calls in one turn.]');
  return messages;
};

export type ModelInfo = { id: string; created: number };

// Fetch the model catalog from the endpoint (OpenRouter serves this publicly).
// Returns [] on failure — the panel falls back to a free-text model field.
export const fetchModels = async (baseURL: string, apiKey: string): Promise<ModelInfo[]> => {
  try {
    const res = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list: any[] = data?.data ?? [];
    // OpenRouter reports supported_parameters per model; only models that
    // support tool calling can drive the app. Endpoints without capability
    // info (e.g. local runtimes) are left unfiltered.
    const hasCaps = list.some(m => Array.isArray(m?.supported_parameters));
    return list
      .filter(m => !hasCaps || (Array.isArray(m?.supported_parameters) && m.supported_parameters.includes('tools')))
      .filter(m => typeof m?.id === 'string')
      .map(m => ({ id: m.id as string, created: typeof m?.created === 'number' ? m.created : 0 }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
};

// Curated suggestions: the newest tool-capable model from each major family
// actually present in the live catalog — so we never suggest a stale ID.
const SUGGESTED_FAMILIES = [
  'anthropic/claude', 'openai/gpt', 'google/gemini',
  'x-ai/grok', 'deepseek/deepseek', 'qwen/qwen',
];
export const suggestModels = (models: ModelInfo[]): string[] => {
  const out: string[] = [];
  for (const fam of SUGGESTED_FAMILIES) {
    const candidates = models
      .filter(m => m.id.startsWith(fam) && !m.id.includes(':free') && !/preview|exp/.test(m.id))
      .sort((a, b) => b.created - a.created);
    // Prefer the newest full-strength model; speed tiers only as fallback
    const best = candidates.find(m => !/fast|flash|mini|lite|nano|tiny|air/.test(m.id)) ?? candidates[0];
    if (best) out.push(best.id);
  }
  return out;
};

// Friendly error strings for the panel
export const describeApiError = (err: unknown): string => {
  if (err instanceof OpenAI.AuthenticationError) return 'API key rejected — check it in settings.';
  if (err instanceof OpenAI.NotFoundError) return 'Model not found — check the model ID in settings.';
  if (err instanceof OpenAI.RateLimitError) return 'Rate limited — wait a moment and try again.';
  if (err instanceof OpenAI.APIConnectionError) return 'Could not reach the API — check your connection.';
  if (err instanceof OpenAI.APIError) return `API error: ${err.message}`;
  return `Error: ${(err as any)?.message ?? err}`;
};
