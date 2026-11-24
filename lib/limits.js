/**
 * 限额抬升补丁 #100–#140。
 *
 * 这一批和前面 99 条的分工不同：前面的补丁改「行为」（审批、身份、拒绝重试、
 * 请求体形状），这一批改「容量」——宿主出厂把各种输出/检索/并发/超时的预算
 * 压得很小，模型一旦真干活就频繁撞顶。每条只动一个常量或一个默认值，
 * 逻辑代码一行不改，所以既不改变宿主控制流，也不影响已有补丁。
 *
 * 重要：#127 补的是 #19 的一个真实失效点。`dsh-compaction-tool-result-pruner`
 * 的 Config 是 `thresholdChars: z.number().default(DEFAULTS.thresholdChars)`，
 * 而 `dsh-base/cordis.patch.yml` 里显式写了 `thresholdChars: 8192`。
 * 显式 config 优先于 schema default —— #19 把 DEFAULTS 抬到 16384 之后，
 * 运行时实际用的仍然是 yml 的 8192，#19 在真机上等于没生效。必须同时改 yml。
 *
 * 全部 optional：宿主换版本后某个锚点消失时降级成「跳过」，
 * 不会把整次 Apply 判成失败。
 */

export const LIMIT_PATCHES = [
  // ─────────────────────────── 输出体积 ───────────────────────────
  {
    id: 100, name: "PERSISTENT_BASH_OUTPUT_RAISED", layer: "代码", layer_en: "Code",
    desc: "持久 shell 输出 16KB → 256KB / persistent bash output cap",
    file: "tool-bash-persistent",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\tmaxOutputChars: z.number().default(16e3),",
        replace:
          "\t// [dsh-purge] persistent bash output cap: 16KB -> 256KB\n" +
          "\tmaxOutputChars: z.number().default(262144),",
      },
      {
        pattern: "\t\tmaxOutputChars: config.maxOutputChars ?? 16e3,",
        replace: "\t\tmaxOutputChars: config.maxOutputChars ?? 262144,",
      },
    ],
    markers: ["maxOutputChars: z.number().default(262144)", "config.maxOutputChars ?? 262144"],
  },
  {
    id: 101, name: "BASH_OUTPUT_BYTES_RAISED", layer: "代码", layer_en: "Code",
    desc: "shell 单次输出 64KB → 4MB / one-shot bash output cap",
    file: "bash-local",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\t\tmaxOutputBytes: z.number().default(64e3).volatile(),",
        replace:
          "\t\t// [dsh-purge] one-shot bash output cap: 64KB -> 4MB\n" +
          "\t\tmaxOutputBytes: z.number().default(4194304).volatile(),",
      },
    ],
    markers: ["maxOutputBytes: z.number().default(4194304)"],
  },
  {
    id: 102, name: "TERMINAL_RESULT_BYTES_RAISED", layer: "代码", layer_en: "Code",
    desc: "terminal 结果 256KB → 4MB / terminal result cap",
    file: "tool-terminal",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "const DEFAULT_MAX_RESULT_BYTES = 256 * 1024;",
        replace:
          "// [dsh-purge] terminal result cap: 256KB -> 4MB\n" +
          "const DEFAULT_MAX_RESULT_BYTES = 4 * 1024 * 1024;",
      },
    ],
    markers: ["const DEFAULT_MAX_RESULT_BYTES = 4 * 1024 * 1024;"],
  },
  {
    id: 103, name: "JOB_INLINE_BYTES_RAISED", layer: "代码", layer_en: "Code",
    desc: "后台任务内联 2KB → 256KB / job inline output",
    file: "tool-jobs",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\tinlineOutputBytes: z.natural().default(2048)",
        replace:
          "\t// [dsh-purge] job inline output: 2KB -> 256KB\n" +
          "\tinlineOutputBytes: z.natural().default(262144)",
      },
      {
        pattern: "\tconst inlineBytes = config.inlineOutputBytes ?? 2048;",
        replace: "\tconst inlineBytes = config.inlineOutputBytes ?? 262144;",
      },
    ],
    markers: ["inlineOutputBytes: z.natural().default(262144)", "config.inlineOutputBytes ?? 262144"],
  },
  {
    id: 104, name: "WORKFLOW_RESULT_CHARS_RAISED", layer: "代码", layer_en: "Code",
    desc: "workflow 结果 50k → 1M 字符 / workflow result chars",
    file: ["tool-workflow", "tool-workflow-types"],
    optional: true,
    markersAny: true,
    replacements: [
      {
        pattern: "\tmaxResultChars: z.natural().min(1).default(5e4),",
        replace:
          "\t// [dsh-purge] workflow result chars: 50k -> 1M\n" +
          "\tmaxResultChars: z.natural().min(1).default(1e6),",
      },
      {
        pattern: "    maxResultChars: z.natural().min(1).default(50_000),",
        replace: "    maxResultChars: z.natural().min(1).default(1_000_000),",
      },
    ],
    markers: [
      "maxResultChars: z.natural().min(1).default(1e6)",
      "maxResultChars: z.natural().min(1).default(1_000_000)",
    ],
  },
  {
    id: 105, name: "SPILL_INLINE_TOKENS_RAISED", layer: "代码", layer_en: "Code",
    desc: "spill 阈值 12500 → 100000 token / spill inline token budget",
    file: "base",
    rel: ["cordis.patch.yml"],
    optional: true,
    replacements: [
      {
        pattern: "        maxInlineTokens: 12500",
        replace: "        maxInlineTokens: 100000",
      },
    ],
    markers: ["        maxInlineTokens: 100000"],
  },
  {
    id: 106, name: "GLOB_GREP_CAPS_RAISED", layer: "代码", layer_en: "Code",
    desc: "glob 100→1万条、grep 250→1万行 / glob and grep caps",
    file: "tool-fs-search",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\tglobMaxResults: z.number().default(100),",
        replace:
          "\t// [dsh-purge] glob cap: 100 -> 10000\n" +
          "\tglobMaxResults: z.number().default(10000),",
      },
      {
        pattern: "\tgrepMaxMatches: z.number().default(250),",
        replace:
          "\t// [dsh-purge] grep cap: 250 -> 10000\n" +
          "\tgrepMaxMatches: z.number().default(10000),",
      },
    ],
    markers: ["globMaxResults: z.number().default(10000)", "grepMaxMatches: z.number().default(10000)"],
  },

  // ─────────────────────────── 并发与轮次 ───────────────────────────
  {
    id: 107, name: "SUBAGENT_CONCURRENCY_RAISED", layer: "代码", layer_en: "Code",
    desc: "同时活跃子代理 8 → 32 / active subagent concurrency",
    file: ["subagent", "subagent-types-index"],
    optional: true,
    markersAny: true,
    replacements: [
      {
        pattern:
          "\t\t\tmaxActiveSubagents: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8).volatile()",
        replace:
          "\t\t\t// [dsh-purge] active subagents: 8 -> 32\n" +
          "\t\t\tmaxActiveSubagents: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(32).volatile()",
      },
      {
        pattern:
          "            maxActiveSubagents: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8).volatile(),",
        replace:
          "            maxActiveSubagents: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(32).volatile(),",
      },
    ],
    markers: [
      "maxActiveSubagents: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(32).volatile()",
    ],
  },
  {
    id: 108, name: "PARALLEL_TOOL_CALLS_RAISED", layer: "代码", layer_en: "Code",
    desc: "并行工具调用 10 → 24 / parallel tool calls",
    file: "agent-loop",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\t\tmaxParallelToolCalls: z.number().step(1).min(1).default(10).volatile(),",
        replace:
          "\t\t// [dsh-purge] parallel tool calls: 10 -> 24\n" +
          "\t\tmaxParallelToolCalls: z.number().step(1).min(1).default(24).volatile(),",
      },
    ],
    markers: ["maxParallelToolCalls: z.number().step(1).min(1).default(24).volatile()"],
  },
  {
    id: 109, name: "GOAL_ROUNDS_RAISED", layer: "代码", layer_en: "Code",
    desc: "目标续跑 256 → 4096 轮 / goal continuation rounds",
    file: "goal",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\t\tstatic Config = z.object({ defaultMaxGoalRounds: z.number().default(256) });",
        replace:
          "\t\t// [dsh-purge] goal rounds: 256 -> 4096\n" +
          "\t\tstatic Config = z.object({ defaultMaxGoalRounds: z.number().default(4096) });",
      },
    ],
    markers: ["defaultMaxGoalRounds: z.number().default(4096)"],
  },
  {
    id: 110, name: "AGENT_TEAM_TASKS_RAISED", layer: "代码", layer_en: "Code",
    desc: "agent-team 任务上限 256 → 4096 / team task cap",
    file: ["agent-team", "base"],
    rel: ["lib", "index.js"],
    optional: true,
    markersAny: true,
    replacements: [
      {
        pattern: "const DEFAULT_MAX_TASKS = 256;",
        replace:
          "// [dsh-purge] team task cap: 256 -> 4096\n" +
          "const DEFAULT_MAX_TASKS = 4096;",
      },
      {
        pattern: "        maxTasks: 256",
        replace: "        maxTasks: 4096",
      },
    ],
    markers: ["const DEFAULT_MAX_TASKS = 4096;", "        maxTasks: 4096"],
  },
  {
    id: 111, name: "CUA_TREE_DEPTH_RAISED", layer: "代码", layer_en: "Code",
    desc: "CUA 树深度 100 → 1000 / accessibility tree depth",
    file: ["cua", "cua-api", "cua-bridge"],
    rel: ["lib", "config.js"],
    optional: true,
    markersAny: true,
    replacements: [
      {
        pattern: "\tmaxDepth: Schema.number().step(1).min(1).max(100).default(25)",
        replace:
          "\t// [dsh-purge] CUA tree depth: 25 (max 100) -> 200 (max 1000)\n" +
          "\tmaxDepth: Schema.number().step(1).min(1).max(1000).default(200)",
      },
      {
        pattern: "\tmaxDepth: z.number().int().min(1).max(100)",
        replace: "\tmaxDepth: z.number().int().min(1).max(1000)",
      },
    ],
    markers: [
      "maxDepth: Schema.number().step(1).min(1).max(1000).default(200)",
      "maxDepth: z.number().int().min(1).max(1000)",
    ],
  },

  // ─────────────────────────── 出网与检索 ───────────────────────────
  {
    id: 112, name: "WEB_FETCH_BUDGET_RAISED", layer: "代码", layer_en: "Code",
    desc: "fetch 响应 5MB→50MB、超时 30s→120s / web fetch budget",
    file: "web-fetch-http",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\tmaxResponseBytes: z.number().default(5e6),",
        replace:
          "\t// [dsh-purge] fetch response cap: 5MB -> 50MB\n" +
          "\tmaxResponseBytes: z.number().default(5e7),",
      },
      {
        pattern: "\ttimeoutMs: z.number().default(3e4),",
        replace: "\ttimeoutMs: z.number().default(12e4),",
      },
    ],
    markers: ["maxResponseBytes: z.number().default(5e7)", "timeoutMs: z.number().default(12e4)"],
  },
  {
    id: 113, name: "WEB_SEARCH_CAPS_RAISED", layer: "代码", layer_en: "Code",
    desc: "web_search 结果 10→50、查询 10→20 / web search caps",
    file: "tool-web",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "const WEB_SEARCH_MAX_RESULTS = 10;",
        replace:
          "// [dsh-purge] web search results: 10 -> 50\n" +
          "const WEB_SEARCH_MAX_RESULTS = 50;",
      },
      {
        pattern: "const WEB_SEARCH_MAX_QUERIES = 10;",
        replace:
          "// [dsh-purge] web search queries per call: 10 -> 20\n" +
          "const WEB_SEARCH_MAX_QUERIES = 20;",
      },
      {
        pattern: "\tsearchMaxResults: z.number().default(10),",
        replace: "\tsearchMaxResults: z.number().default(50),",
      },
      {
        pattern: "\tsearchMaxQueries: z.number().default(10),",
        replace: "\tsearchMaxQueries: z.number().default(20),",
      },
    ],
    markers: [
      "const WEB_SEARCH_MAX_RESULTS = 50;",
      "const WEB_SEARCH_MAX_QUERIES = 20;",
      "searchMaxResults: z.number().default(50)",
      "searchMaxQueries: z.number().default(20)",
    ],
  },
  {
    id: 114, name: "MCP_BUDGET_RAISED", layer: "代码", layer_en: "Code",
    desc: "MCP 超时 60s→600s、指令 →256KB / MCP call budget",
    file: ["mcp-client-index", "mcp-client-types"],
    optional: true,
    markersAny: true,
    replacements: [
      {
        pattern: "const DEFAULT_MAX_INSTRUCTION_BYTES = 32768;",
        replace:
          "// [dsh-purge] MCP server instructions: 32KB -> 256KB\n" +
          "const DEFAULT_MAX_INSTRUCTION_BYTES = 262144;",
      },
      {
        pattern: "const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;",
        replace:
          "// [dsh-purge] MCP tool call timeout: 60s -> 600s\n" +
          "const DEFAULT_TOOL_CALL_TIMEOUT_MS = 600_000;",
      },
    ],
    markers: [
      "const DEFAULT_MAX_INSTRUCTION_BYTES = 262144;",
      "const DEFAULT_TOOL_CALL_TIMEOUT_MS = 600_000;",
    ],
  },
  {
    id: 115, name: "SESSION_SEARCH_PAGE_RAISED", layer: "代码", layer_en: "Code",
    desc: "会话搜索页 20 → 100 条 / session search page size",
    file: "session-query-sqlite",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\t\tdefaultLimit: z.number().step(1).min(1).max(SQLITE_MAX_PAGE_LIMIT).default(20),",
        replace:
          "\t\t// [dsh-purge] session search page size: 20 -> 100\n" +
          "\t\tdefaultLimit: z.number().step(1).min(1).max(SQLITE_MAX_PAGE_LIMIT).default(100),",
      },
    ],
    markers: ["defaultLimit: z.number().step(1).min(1).max(SQLITE_MAX_PAGE_LIMIT).default(100)"],
  },
  {
    id: 116, name: "SESSION_SEARCH_RESULTS_RAISED", layer: "代码", layer_en: "Code",
    desc: "会话搜索工具单次 100 → 1000 条 / session search result cap",
    file: "tool-session-query",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "const DEFAULT_MAX_SEARCH_RESULTS = 100;",
        replace:
          "// [dsh-purge] session search results: 100 -> 1000\n" +
          "const DEFAULT_MAX_SEARCH_RESULTS = 1000;",
      },
      {
        pattern: "\tmaxSearchResults: z.number().step(1).min(1).default(100),",
        replace: "\tmaxSearchResults: z.number().step(1).min(1).default(1000),",
      },
    ],
    markers: [
      "const DEFAULT_MAX_SEARCH_RESULTS = 1000;",
      "maxSearchResults: z.number().step(1).min(1).default(1000)",
    ],
  },
  {
    id: 117, name: "SKILL_DESCRIPTION_RAISED", layer: "代码", layer_en: "Code",
    desc: "技能描述 500 → 2000 字符 / skill catalog description cap",
    file: "tool-skill",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "const DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500;",
        replace:
          "// [dsh-purge] skill description length: 500 -> 2000\n" +
          "const DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 2000;",
      },
    ],
    markers: ["const DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 2000;"],
  },
  {
    id: 118, name: "SESSION_REFERENCE_BYTES_RAISED", layer: "代码", layer_en: "Code",
    desc: "会话引用 64KB → 1MB / session reference byte budget",
    file: "session-reference-index",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "const DEFAULT_MAX_REFERENCE_BYTES = 65536;",
        replace:
          "// [dsh-purge] session reference budget: 64KB -> 1MB\n" +
          "const DEFAULT_MAX_REFERENCE_BYTES = 1048576;",
      },
    ],
    markers: ["const DEFAULT_MAX_REFERENCE_BYTES = 1048576;"],
  },

  // ─────────────────────────── 素材与文件 ───────────────────────────
  {
    id: 119, name: "IMAGE_NORMALIZE_EDGE_RAISED", layer: "代码", layer_en: "Code",
    desc: "图片归一化边长 8192 → 16384 / normalized image edge",
    file: "attachment-local",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "const DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION = 8192;",
        replace:
          "// [dsh-purge] normalized image edge: 8192 -> 16384\n" +
          "const DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION = 16384;",
      },
      {
        pattern: "\t\t\tmaxDimension: config.normalizedImageMaxDimension ?? 8192,",
        replace: "\t\t\tmaxDimension: config.normalizedImageMaxDimension ?? 16384,",
      },
    ],
    markers: [
      "const DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION = 16384;",
      "config.normalizedImageMaxDimension ?? 16384",
    ],
  },
  {
    id: 120, name: "PRESENT_FILE_COUNT_RAISED", layer: "代码", layer_en: "Code",
    desc: "present 文件数 8 → 32 / present file count",
    file: "tool-present",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "const Config = z.object({ maxFiles: z.number().default(8) });",
        replace:
          "// [dsh-purge] present file count: 8 -> 32\n" +
          "const Config = z.object({ maxFiles: z.number().default(32) });",
      },
    ],
    markers: ["const Config = z.object({ maxFiles: z.number().default(32) });"],
  },
  {
    id: 121, name: "SCHEDULE_GRANULARITY_RAISED", layer: "代码", layer_en: "Code",
    desc: "定时任务间隔 60→30 秒、列表 →5000 / schedule granularity",
    file: ["schedule", "schedule-types"],
    rel: ["lib", "index.js"],
    optional: true,
    markersAny: true,
    replacements: [
      {
        pattern: "export const MIN_EVERY_INTERVAL_SECONDS = 60;",
        replace:
          "// [dsh-purge] schedule minimum interval: 60s -> 30s\n" +
          "export const MIN_EVERY_INTERVAL_SECONDS = 30;",
      },
      {
        pattern: "const MIN_EVERY_INTERVAL_SECONDS = 60;",
        replace:
          "// [dsh-purge] schedule minimum interval: 60s -> 30s\n" +
          "const MIN_EVERY_INTERVAL_SECONDS = 30;",
      },
      {
        pattern: "export const MAX_LIST_LIMIT = 500;",
        replace:
          "// [dsh-purge] schedule list page cap: 500 -> 5000\n" +
          "export const MAX_LIST_LIMIT = 5000;",
      },
      {
        pattern: "const MAX_LIST_LIMIT = 500;",
        replace:
          "// [dsh-purge] schedule list page cap: 500 -> 5000\n" +
          "const MAX_LIST_LIMIT = 5000;",
      },
    ],
    markers: ["MIN_EVERY_INTERVAL_SECONDS = 30;", "MAX_LIST_LIMIT = 5000;"],
  },
  {
    id: 122, name: "OFFICE_IMAGE_LIMITS_RAISED", layer: "代码", layer_en: "Code",
    desc: "office 像素 8M→32M、边长 →16384 / office image limits",
    file: "tool-office",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\tmaxImagePixels: z.natural().min(1).max(16777216).default(8388608),",
        replace:
          "\t// [dsh-purge] office image pixels: 8M -> 32M\n" +
          "\tmaxImagePixels: z.natural().min(1).max(67108864).default(33554432),",
      },
      {
        pattern: "\tmaxImageDimension: z.natural().min(1).max(16777216).default(8192),",
        replace:
          "\t// [dsh-purge] office image edge: 8192 -> 16384\n" +
          "\tmaxImageDimension: z.natural().min(1).max(16777216).default(16384),",
      },
    ],
    markers: [
      "maxImagePixels: z.natural().min(1).max(67108864).default(33554432)",
      "maxImageDimension: z.natural().min(1).max(16777216).default(16384)",
    ],
  },
  {
    id: 123, name: "AGENTS_MD_BYTES_RAISED", layer: "代码", layer_en: "Code",
    desc: "AGENTS.md 源文件 1MB → 16MB / instruction source cap",
    file: "agent-instructions",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "const DEFAULT_MAX_SOURCE_BYTES = 1048576;",
        replace:
          "// [dsh-purge] instruction source cap: 1MB -> 16MB\n" +
          "const DEFAULT_MAX_SOURCE_BYTES = 16777216;",
      },
    ],
    markers: ["const DEFAULT_MAX_SOURCE_BYTES = 16777216;"],
  },
  {
    id: 124, name: "BINARY_READ_ALLOWED", layer: "代码", layer_en: "Code",
    desc: "二进制文件允许 read / allow reading binary files",
    file: "fs-local",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern:
          "\tif (raw.subarray(0, BINARY_SAMPLE_BYTES).includes(0)) throw new FsError(`cannot read \"${target.displayPath}\": binary file`, \"FS_NOT_TEXT\");\n" +
          "\treturn decodeUtf8(raw, \"read\", target.displayPath);",
        replace:
          "\t// [dsh-purge] binary read allowed: the NUL sample no longer rejects the read,\n" +
          "\t// and the decode is lossy so invalid UTF-8 becomes U+FFFD instead of an error.\n" +
          "\treturn new TextDecoder(\"utf-8\", { fatal: false }).decode(raw);",
      },
      {
        pattern:
          "\t\tif (sample.includes(0)) throw new FsError(`cannot read \"${target.displayPath}\": binary file`, \"FS_NOT_TEXT\");",
        replace: "\t\t// [dsh-purge] binary read allowed: the streaming NUL sample is advisory only.",
      },
      {
        pattern: "\tconst decoder = new TextDecoder(\"utf-8\", { fatal: true });",
        replace: "\tconst decoder = new TextDecoder(\"utf-8\", { fatal: false });",
      },
      {
        pattern: "\t\treturn new TextDecoder(\"utf-8\", { fatal: true }).decode(buffer);",
        replace: "\t\treturn new TextDecoder(\"utf-8\", { fatal: false }).decode(buffer);",
      },
    ],
    markers: [
      "[dsh-purge] binary read allowed: the NUL sample no longer rejects the read",
      "[dsh-purge] binary read allowed: the streaming NUL sample is advisory only",
    ],
  },
  {
    id: 125, name: "BINARY_EDIT_ALLOWED", layer: "代码", layer_en: "Code",
    desc: "二进制文件允许 edit / allow patching binary files",
    file: "tool-fs",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern:
          "\t\t\tif (text.includes(\"\\0\")) throw new FsError(`cannot patch \"${target.displayPath}\": binary file`, \"FS_NOT_TEXT\");",
        replace: "\t\t\t// [dsh-purge] binary edit allowed: the NUL-byte gate is gone.",
      },
      {
        pattern: "\tconst raw = decodeUtf8(buffer, \"edit\", displayPath);",
        replace: "\tconst raw = new TextDecoder(\"utf-8\", { fatal: false }).decode(buffer);",
      },
    ],
    markers: ["[dsh-purge] binary edit allowed: the NUL-byte gate is gone."],
  },
  {
    id: 126, name: "COMPACTION_PRESSURE_RAISED", layer: "代码", layer_en: "Code",
    desc: "压缩触发 80%→95%、保留 16%→50% / compaction trigger and retention",
    file: "compaction-basic",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "const DEFAULT_THRESHOLD_RATIO = .8;",
        replace:
          "// [dsh-purge] compaction trigger: 80% -> 95% of the window\n" +
          "const DEFAULT_THRESHOLD_RATIO = .95;",
      },
      {
        pattern: "const DEFAULT_RETAIN_RATIO = .16;",
        replace:
          "// [dsh-purge] verbatim tail kept: 16% -> 50%\n" +
          "const DEFAULT_RETAIN_RATIO = .5;",
      },
    ],
    markers: ["const DEFAULT_THRESHOLD_RATIO = .95;", "const DEFAULT_RETAIN_RATIO = .5;"],
  },

  // ═══════════════ 自行加强（#127–#140）：截图里没有的 ═══════════════
  {
    id: 127, name: "PRUNER_CONFIG_OVERRIDE_SYNCED", layer: "代码", layer_en: "Code",
    desc: "修剪预算改到 yml（#19 原本被显式 config 顶掉）/ sync pruner yml override",
    /* #19 只改 DEFAULTS（16384/8192/2048），但 yml 显式写了 8192/4096/1024。
       显式 config 优先于 schema default → #19 在真机上等于没生效。
       这条把 yml 抬到 50000/32768/8192：既修掉「yml 顶掉 DEFAULTS」，
       又给到比 #19 更大的预算。两者都不再是 8192 那个出厂值。 */
    file: "base",
    rel: ["cordis.patch.yml"],
    optional: true,
    replacements: [
      {
        pattern:
          "        thresholdChars: 8192\n" +
          "        headChars: 4096\n" +
          "        tailChars: 1024",
        replace:
          "        thresholdChars: 50000\n" +
          "        headChars: 32768\n" +
          "        tailChars: 8192",
      },
    ],
    markers: ["        thresholdChars: 50000"],
  },
  {
    id: 128, name: "BASH_TIMEOUT_RAISED", layer: "代码", layer_en: "Code",
    desc: "shell 超时 120s→600s、上限 600s→2400s / bash timeouts",
    file: "bash-local",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\t\ttimeoutMs: z.number().default(12e4).volatile(),",
        replace:
          "\t\t// [dsh-purge] bash default timeout: 120s -> 600s\n" +
          "\t\ttimeoutMs: z.number().default(6e5).volatile(),",
      },
      {
        pattern: "\t\tmaxTimeoutMs: z.number().default(6e5).volatile(),",
        replace:
          "\t\t// [dsh-purge] bash timeout ceiling: 600s -> 2400s\n" +
          "\t\tmaxTimeoutMs: z.number().default(24e5).volatile(),",
      },
    ],
    markers: [
      "timeoutMs: z.number().default(6e5).volatile()",
      "maxTimeoutMs: z.number().default(24e5).volatile()",
    ],
  },
  {
    id: 129, name: "PERSISTENT_BASH_TIMEOUT_AND_SCROLLBACK", layer: "代码", layer_en: "Code",
    desc: "持久 shell 超时 300s→1800s、回滚 1000→1万行 / persistent bash budget",
    file: "tool-bash-persistent",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\ttimeoutMs: z.number().default(3e5),",
        replace:
          "\t// [dsh-purge] persistent bash timeout: 300s -> 1800s\n" +
          "\ttimeoutMs: z.number().default(18e5),",
      },
      {
        pattern: "const SCROLLBACK_PAGE_LINES = 1e3;",
        replace:
          "// [dsh-purge] scrollback page: 1000 -> 10000 lines\n" +
          "const SCROLLBACK_PAGE_LINES = 1e4;",
      },
    ],
    markers: ["timeoutMs: z.number().default(18e5)", "const SCROLLBACK_PAGE_LINES = 1e4;"],
  },
  {
    id: 130, name: "JOB_WAIT_TIMEOUT_RAISED", layer: "代码", layer_en: "Code",
    desc: "后台任务等待 600s → 1800s / job wait timeout",
    file: "tool-jobs",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\tmaxWaitTimeoutMs: z.number().min(1).default(6e5),",
        replace:
          "\t// [dsh-purge] job wait ceiling: 600s -> 1800s\n" +
          "\tmaxWaitTimeoutMs: z.number().min(1).default(18e5),",
      },
    ],
    markers: ["maxWaitTimeoutMs: z.number().min(1).default(18e5)"],
  },
  {
    id: 131, name: "SEARCH_IO_BUDGET_RAISED", layer: "代码", layer_en: "Code",
    desc: "检索原始输出 20MB→200MB、超时 30s→180s、grep 行宽 2KB→16KB / search IO budget",
    file: "tool-fs-search",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "const RAW_OUTPUT_MAX_BYTES = 2e7;",
        replace:
          "// [dsh-purge] raw search output: 20MB -> 200MB\n" +
          "const RAW_OUTPUT_MAX_BYTES = 2e8;",
      },
      {
        pattern: "const SEARCH_TIMEOUT_MS = 3e4;",
        replace:
          "// [dsh-purge] search timeout: 30s -> 180s\n" +
          "const SEARCH_TIMEOUT_MS = 18e4;",
      },
      {
        pattern: "const SEARCH_GRACE_MS = 3e3;",
        replace:
          "// [dsh-purge] search grace: 3s -> 10s\n" +
          "const SEARCH_GRACE_MS = 1e4;",
      },
      {
        pattern: "const GREP_MAX_LINE_BYTES = 2e3;",
        replace:
          "// [dsh-purge] grep line width: 2KB -> 16KB\n" +
          "const GREP_MAX_LINE_BYTES = 16e3;",
      },
    ],
    markers: [
      "const RAW_OUTPUT_MAX_BYTES = 2e8;",
      "const SEARCH_TIMEOUT_MS = 18e4;",
      "const SEARCH_GRACE_MS = 1e4;",
      "const GREP_MAX_LINE_BYTES = 16e3;",
    ],
  },
  {
    id: 132, name: "SESSION_REFERENCE_COUNT_RAISED", layer: "代码", layer_en: "Code",
    desc: "单条消息引用 3→32 个、候选 50→500 / reference counts",
    file: "session-reference-index",
    optional: true,
    replacements: [
      {
        pattern: "const MAX_REFERENCES = 3;",
        replace:
          "// [dsh-purge] references per message: 3 -> 32\n" +
          "const MAX_REFERENCES = 32;",
      },
      {
        pattern: "const DEFAULT_CANDIDATE_LIMIT = 50;",
        replace:
          "// [dsh-purge] reference discovery candidates: 50 -> 500\n" +
          "const DEFAULT_CANDIDATE_LIMIT = 500;",
      },
    ],
    markers: ["const MAX_REFERENCES = 32;", "const DEFAULT_CANDIDATE_LIMIT = 500;"],
  },
  {
    id: 133, name: "IMAGES_PER_MESSAGE_RAISED", layer: "代码", layer_en: "Code",
    desc: "单条消息图片 20 → 100 / images per message",
    file: "attachment-local",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\t\tmaxImagesPerMessage: z.number().step(1).min(1).default(20),",
        replace:
          "\t\t// [dsh-purge] images per message: 20 -> 100\n" +
          "\t\tmaxImagesPerMessage: z.number().step(1).min(1).default(100),",
      },
    ],
    markers: ["maxImagesPerMessage: z.number().step(1).min(1).default(100)"],
  },
  {
    id: 134, name: "OFFICE_IMAGE_COUNT_RAISED", layer: "代码", layer_en: "Code",
    desc: "office 内嵌图片 20 → 200 / office image count",
    file: "tool-office",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\tmaxImages: z.natural().min(1).max(1e4).default(20),",
        replace:
          "\t// [dsh-purge] office embedded images: 20 -> 200\n" +
          "\tmaxImages: z.natural().min(1).max(1e4).default(200),",
      },
    ],
    markers: ["maxImages: z.natural().min(1).max(1e4).default(200)"],
  },
  {
    id: 135, name: "DIFF_BASIS_BYTES_RAISED", layer: "代码", layer_en: "Code",
    desc: "编辑 diff 基准 10MB → 100MB / diff basis cap",
    file: "fs-local",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "const DEFAULT_DIFF_BASIS_MAX_BYTES = 10 * 1024 * 1024;",
        replace:
          "// [dsh-purge] diff basis: 10MB -> 100MB\n" +
          "const DEFAULT_DIFF_BASIS_MAX_BYTES = 100 * 1024 * 1024;",
      },
    ],
    markers: ["const DEFAULT_DIFF_BASIS_MAX_BYTES = 100 * 1024 * 1024;"],
  },
  {
    id: 136, name: "WEB_TOOL_TIMEOUT_RAISED", layer: "代码", layer_en: "Code",
    desc: "web 工具超时 30s → 180s / web tool timeout",
    file: "tool-web",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "DEFAULT_WEB_TOOL_TIMEOUT_MS = 3e4;",
        replace:
          "// [dsh-purge] web tool timeout: 30s -> 180s\n" +
          "DEFAULT_WEB_TOOL_TIMEOUT_MS = 18e4;",
      },
    ],
    markers: ["DEFAULT_WEB_TOOL_TIMEOUT_MS = 18e4;"],
  },
  {
    id: 137, name: "WEB_FETCH_OUTPUT_CHARS_RAISED", layer: "代码", layer_en: "Code",
    desc: "fetch 渲染输出 200k→2M 字符、检索摘要 800→8000 / rendered web output",
    file: "tool-web",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "const DEFAULT_FETCH_MAX_OUTPUT_CHARS = 2e5;",
        replace:
          "// [dsh-purge] rendered fetch output: 200k -> 2M chars\n" +
          "const DEFAULT_FETCH_MAX_OUTPUT_CHARS = 2e6;",
      },
      {
        pattern: "\tsearchSummaryMaxChars: z.number().default(800),",
        replace: "\tsearchSummaryMaxChars: z.number().default(8000),",
      },
    ],
    markers: [
      "const DEFAULT_FETCH_MAX_OUTPUT_CHARS = 2e6;",
      "searchSummaryMaxChars: z.number().default(8000)",
    ],
  },
  {
    id: 138, name: "WEB_FETCH_BODY_AND_REDIRECTS_RAISED", layer: "代码", layer_en: "Code",
    desc: "fetch 正文 100k→2M 字符、重定向 5→20 / fetch body and redirects",
    file: "web-fetch-http",
    rel: ["lib", "index.js"],
    optional: true,
    replacements: [
      {
        pattern: "\tmaxBodyChars: z.number().default(1e5),",
        replace:
          "\t// [dsh-purge] fetch body chars: 100k -> 2M\n" +
          "\tmaxBodyChars: z.number().default(2e6),",
      },
      {
        pattern: "\tmaxRedirects: z.number().default(5),",
        replace:
          "\t// [dsh-purge] fetch redirects: 5 -> 20\n" +
          "\tmaxRedirects: z.number().default(20),",
      },
    ],
    markers: ["maxBodyChars: z.number().default(2e6)", "maxRedirects: z.number().default(20)"],
  },
  {
    id: 139, name: "MCP_RECONNECT_RAISED", layer: "代码", layer_en: "Code",
    desc: "MCP 重连 10 次→100 次、退避上限 30s→300s / MCP reconnect policy",
    file: "mcp-client-index",
    optional: true,
    replacements: [
      {
        pattern: "\tmaxDelayMs: 3e4,\n\tmaxAttempts: 10",
        replace:
          "\t// [dsh-purge] MCP reconnect: 10 attempts / 30s backoff -> 100 / 300s\n" +
          "\tmaxDelayMs: 3e5,\n\tmaxAttempts: 100",
      },
    ],
    markers: ["\tmaxAttempts: 100"],
  },
  {
    id: 140, name: "CUA_ELEMENTS_AND_DRAG_RAISED", layer: "代码", layer_en: "Code",
    desc: "CUA 元素 2000→2万、拖拽步数 20→240 / CUA element and drag caps",
    file: "cua",
    rel: ["lib", "config.js"],
    optional: true,
    replacements: [
      {
        pattern: "\tmaxElements: Schema.number().step(1).min(1).max(1e4).default(2e3),",
        replace:
          "\t// [dsh-purge] CUA elements per read: 2000 -> 20000\n" +
          "\tmaxElements: Schema.number().step(1).min(1).max(1e6).default(2e4),",
      },
      {
        pattern: "\tdragSteps: Schema.number().step(1).min(1).max(240).default(20),",
        replace:
          "\t// [dsh-purge] CUA drag steps: 20 -> 240\n" +
          "\tdragSteps: Schema.number().step(1).min(1).max(2400).default(240),",
      },
    ],
    markers: [
      "maxElements: Schema.number().step(1).min(1).max(1e6).default(2e4)",
      "dragSteps: Schema.number().step(1).min(1).max(2400).default(240)",
    ],
  },
];
