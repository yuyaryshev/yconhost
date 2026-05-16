export type ConsoleStatus = "starting" | "running" | "ready" | "exited";

export interface ConsoleCreateRequest {
  id?: string;
  name?: string;
  project?: string;
  projectPath?: string;
  cwd?: string;
  command?: string;
  shell?: string;
  args?: string[];
  ansiParserEnabled?: boolean;
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
  ansiParserEnabled: boolean;
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
  pid?: number;
  status: ConsoleStatus;
  ansiParserEnabled: boolean;
  errorCount: number;
  unseenErrorCount: number;
  createdAt: string;
  updatedAt: string;
  exitCode?: number;
}

export interface ConsoleSnapshot extends ConsoleRecord {
  outputTail: string;
  errorMatches: ErrorMatch[];
}

export interface ProjectSummary {
  name: string;
  projectPath?: string;
  consoleCount: number;
  runningCount: number;
  readyCount: number;
  unseenErrorCount: number;
}

export interface TrackerResult {
  status: ConsoleStatus;
  errorCount: number;
  matches: ErrorMatch[];
}

export interface ErrorMatch {
  id: string;
  createdAt: string;
  line: string;
  reason: string;
}

export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
}

export interface AppSettings {
  host: string;
  port: number;
  dataDir: string;
  defaultShell: string;
  log: {
    maxBytes: number;
    rotateFiles: number;
    scrollbackBytes: number;
    trackerTailChars: number;
  };
}

export interface BatchWinConfig {
  cmd?: string;
  command?: string;
  cwd?: string;
  no_run?: boolean;
  ansiParserEnabled?: boolean;
}
