import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type {
  ExternalTerminalLauncherInfo,
  ExternalTerminalLaunchResult,
  ExternalTerminalProfile,
} from "@shared/ipc";

interface LauncherSpec {
  profile: ExternalTerminalProfile;
  label: string;
  macApps?: string[];
  commands?: string[];
}

type SpawnResult = { unref?(): void };
type SpawnFn = (
  command: string,
  args: string[],
  opts: { cwd: string; detached: boolean; stdio: "ignore" },
) => SpawnResult;

export interface ExternalTerminalLauncherDeps {
  platform?: NodeJS.Platform;
  envPath?: string;
  exists?: (path: string) => boolean;
  spawn?: SpawnFn;
}

const SPECS: LauncherSpec[] = [
  {
    profile: "system",
    label: "System terminal",
    macApps: [
      "/System/Applications/Utilities/Terminal.app",
      "/Applications/Utilities/Terminal.app",
    ],
    commands: ["x-terminal-emulator", "cmd.exe", "powershell.exe"],
  },
  {
    profile: "ghostty",
    label: "Ghostty",
    macApps: ["/Applications/Ghostty.app"],
    commands: ["ghostty"],
  },
  {
    profile: "kitty",
    label: "Kitty",
    macApps: ["/Applications/kitty.app", "/Applications/Kitty.app"],
    commands: ["kitty"],
  },
  {
    profile: "iterm2",
    label: "iTerm2",
    macApps: ["/Applications/iTerm.app", "/Applications/iTerm2.app"],
    commands: ["iterm2"],
  },
  {
    profile: "alacritty",
    label: "Alacritty",
    macApps: ["/Applications/Alacritty.app"],
    commands: ["alacritty"],
  },
  {
    profile: "wezterm",
    label: "WezTerm",
    macApps: ["/Applications/WezTerm.app"],
    commands: ["wezterm"],
  },
];

function defaultExists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isExistingDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function commandArgs(profile: ExternalTerminalProfile, cwd: string): string[] {
  switch (profile) {
    case "ghostty":
      return [`--working-directory=${cwd}`];
    case "kitty":
      return ["--directory", cwd];
    case "alacritty":
      return ["--working-directory", cwd];
    case "wezterm":
      return ["start", "--cwd", cwd];
    case "system":
    case "iterm2":
      return [];
  }
}

export class ExternalTerminalLaunchers {
  private readonly platform: NodeJS.Platform;
  private readonly envPath: string;
  private readonly exists: (path: string) => boolean;
  private readonly spawnProcess: SpawnFn;

  constructor(deps: ExternalTerminalLauncherDeps = {}) {
    this.platform = deps.platform ?? process.platform;
    this.envPath = deps.envPath ?? process.env.PATH ?? "";
    this.exists = deps.exists ?? defaultExists;
    this.spawnProcess = deps.spawn ?? spawn;
  }

  list(): ExternalTerminalLauncherInfo[] {
    return SPECS.map((spec) => this.detect(spec));
  }

  open(opts: {
    cwd: string;
    profile?: ExternalTerminalProfile;
  }): ExternalTerminalLaunchResult {
    if (!isExistingDir(opts.cwd)) {
      throw new Error(
        `Cannot open external terminal: cwd is not a directory (${opts.cwd})`,
      );
    }

    const requested = opts.profile ?? "system";
    const launchers = this.list();
    const target =
      requested === "system"
        ? (launchers.find((l) => l.profile === "system" && l.available) ??
          launchers.find((l) => l.available))
        : launchers.find((l) => l.profile === requested);

    if (!target?.available) {
      throw new Error(`External terminal not available: ${requested}`);
    }

    const spec = SPECS.find((item) => item.profile === target.profile);
    if (!spec) throw new Error(`Unknown external terminal: ${target.profile}`);

    if (target.kind === "mac-app") {
      const appName = target.detectedPath
        ?.split("/")
        .at(-1)
        ?.replace(/\.app$/i, "");
      if (!appName)
        throw new Error(
          `External terminal app path is invalid: ${target.profile}`,
        );
      this.spawnProcess("open", ["-a", appName, opts.cwd], {
        cwd: opts.cwd,
        detached: true,
        stdio: "ignore",
      }).unref?.();
    } else {
      const command = target.detectedPath ?? spec.commands?.[0];
      if (!command)
        throw new Error(
          `External terminal command is invalid: ${target.profile}`,
        );
      this.spawnProcess(command, commandArgs(target.profile, opts.cwd), {
        cwd: opts.cwd,
        detached: true,
        stdio: "ignore",
      }).unref?.();
    }

    return {
      id: randomUUID(),
      profile: target.profile,
      label: target.label,
      cwd: opts.cwd,
      launchedAt: new Date().toISOString(),
    };
  }

  private detect(spec: LauncherSpec): ExternalTerminalLauncherInfo {
    if (this.platform === "darwin") {
      const app = spec.macApps?.find((path) => this.exists(path));
      if (app) {
        return {
          profile: spec.profile,
          label: spec.label,
          available: true,
          kind: "mac-app",
          detectedPath: app,
        };
      }
    }

    const command = spec.commands
      ?.map((cmd) => this.findCommand(cmd))
      .find(Boolean);
    if (command) {
      return {
        profile: spec.profile,
        label: spec.label,
        available: true,
        kind: "command",
        detectedPath: command,
      };
    }

    return {
      profile: spec.profile,
      label: spec.label,
      available: false,
      kind: "unavailable",
      reason: "Not found on PATH or in standard app locations",
    };
  }

  private findCommand(command: string): string | undefined {
    if (command.includes("/") || command.includes("\\")) {
      return this.exists(command) ? command : undefined;
    }
    for (const dir of this.envPath.split(delimiter)) {
      if (!dir) continue;
      const full = join(dir, command);
      if (this.exists(full)) return full;
    }
    return undefined;
  }
}
