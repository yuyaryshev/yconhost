export type ConsoleMode = "managed" | "manual";
export type ConsoleStatus = "starting" | "running" | "ready" | "exited" | "detached";

export interface ConsoleCreateRequest {
  name?: string;
  project?: string;
  cwd?: string;
  command?: string;
  shell?: string;
  args?: string[];
  ansiParserEnabled?: boolean;
  projectPath?: never;
}

export interface ConsoleRecord {
  id: string;
  name: string;
  project: string;
  cwd: string;
  command: string;
  shell: string;
  args: string[];
  pid?: number;
  status: ConsoleStatus;
  mode: ConsoleMode;
  vanillaVisible: boolean;
  ansiParserEnabled: boolean;
  errorCount: number;
  unseenErrorCount: number;
  createdAt: string;
  updatedAt: string;
  exitCode?: number;
  attached: boolean;
}

export interface ConsoleSnapshot extends ConsoleRecord {
  outputTail: string;
}

export interface ProjectSummary {
  name: string;
  consoleCount: number;
  runningCount: number;
  readyCount: number;
  detachedCount: number;
  unseenErrorCount: number;
}

export interface TrackerResult {
  status: ConsoleStatus;
  errorCount: number;
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
