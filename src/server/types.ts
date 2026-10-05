export type ConsoleStatus = "idle" | "starting" | "running" | "ready" | "exited";

export interface ConsoleCreateRequest {
  id?: string;
  name?: string;
  project?: string;
  projectPath?: string;
  cwd?: string;
  command?: string;
  shell?: string;
  args?: string[];
  noRun?: boolean;
  autoStartOnOpen?: boolean;
  ansiParserEnabled?: boolean;
  readCardHashes?: string[];
  lastInputAt?: string;
  lastOutputAt?: string;
  lastAccessedAt?: string;
  persistent?: boolean;
  background?: string;
  backgroundColor?: ThemeColorPair;
}

export interface ConsoleRegisterRequest extends ConsoleCreateRequest {
  project: string;
  start?: boolean;
}

export interface ConsoleDefinition {
  id: string;
  name: string;
  project: string;
  projectPath?: string;
  cwd: string;
  command: string;
  shell: string;
  args: string[];
  noRun?: boolean;
  autoStartOnOpen?: boolean;
  status?: ConsoleStatus;
  lastInputAt?: string;
  lastOutputAt?: string;
  lastAccessedAt?: string;
  persistent?: boolean;
  background?: string;
  backgroundColor?: ThemeColorPair;
  ansiParserEnabled: boolean;
  readCardHashes?: string[];
}

export interface ConsoleRecord {
  id: string;
  name: string;
  project: string;
  projectPath?: string;
  cwd: string;
  command: string;
  shell: string;
  args: string[];
  noRun?: boolean;
  autoStartOnOpen?: boolean;
  pid?: number;
  status: ConsoleStatus;
  ansiParserEnabled: boolean;
  readCardHashes?: string[];
  errorCount: number;
  unseenErrorCount: number;
  createdAt: string;
  updatedAt: string;
  lastInputAt?: string;
  lastOutputAt?: string;
  lastAccessedAt?: string;
  persistent?: boolean;
  background?: string;
  backgroundColor?: ThemeColorPair;
  exitCode?: number;
  readonly?: boolean;
  source?: "managed" | "pm2";
}

export interface ConsoleSnapshot extends ConsoleRecord {
  outputTail: string;
  errorMatches: ErrorMatch[];
  cards: ExtractedCard[];
}

export interface ConsoleSessionState extends ConsoleRecord {
  tail: string;
  tailLines: string[];
}

export interface ProjectSummary {
  name: string;
  projectPath?: string;
  consoleCount: number;
  runningCount: number;
  readyCount: number;
  unseenErrorCount: number;
}

export interface ManagedProject {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorMatch {
  id: string;
  createdAt: string;
  line: string;
  reason: string;
}

export type ExtractedCardCategory = "error" | "warning" | "info" | "message";
export type ExtractedCardKind = "persistent" | "temporary";

export interface ExtractedCard {
  id: string;
  kind: ExtractedCardKind;
  category: ExtractedCardCategory;
  title: string;
  message: string;
  rawText: string;
  hash: string;
  createdAt: string;
  bufferY?: number;
}

export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
}

export interface ThemeColorPair {
  dark: string;
  light: string;
}

export interface AppSettings {
  host: string;
  port: number;
  dataDir: string;
  defaultShell: string;
  terminal: {
    cols: number;
    rows: number;
    scrollback: number;
  };
  log: {
    maxBytes: number;
    rotateFiles: number;
    scrollbackBytes: number;
  };
  cards: {
    maxPerConsole: number;
    scanTailBytes: number;
  };
  codexContexts: {
    projectName: string;
    contextsPath: string;
    weztermPresetsPath?: string;
  };
  temporaryConsoles: {
    ttlHours: number;
    cleanupIntervalMs: number;
  };
}

export interface BatchWinConfig {
  cmd?: string;
  command?: string;
  cwd?: string;
  no_run?: boolean;
  ansiParserEnabled?: boolean;
  background?: string;
  backgroung?: string;
}

export interface MywinsEntry {
  name: string;
  cmd?: string;
  command?: string;
  cwd?: string;
  no_run?: boolean;
  ansiParserEnabled?: boolean;
  background?: string;
}

export interface CodexContextsImportRequest {
  project?: string;
  contextsPath?: string;
  weztermPresetsPath?: string;
}

export interface CodexContextsImportResult {
  project: string;
  imported: number;
  consoles: ConsoleRecord[];
}
