import type { IPty } from 'node-pty';
import { spawn } from 'node-pty';

import type { SessionTool } from './types.js';

interface ToolCommand {
  readonly command: string;
  readonly args: readonly string[];
}

const TOOL_COMMANDS: Record<SessionTool, ToolCommand> = {
  codex: {
    command: 'codex',
    args: [],
  },
  opencode: {
    command: 'opencode',
    args: [],
  },
};

interface SpawnPtyOptions {
  readonly tool: SessionTool;
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
}

export interface SpawnedPty {
  readonly pty: IPty;
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * 許可された tool から PTY プロセスを起動する。
 * @param options 起動オプション
 */
export const spawnPty = (options: SpawnPtyOptions): SpawnedPty => {
  const toolCommand = TOOL_COMMANDS[options.tool];
  if (!toolCommand) {
    throw new Error(`Unsupported tool: ${options.tool}`);
  }

  const ptyProcess = spawn(toolCommand.command, [...toolCommand.args], {
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: process.env,
    name: 'xterm-256color',
  });

  return {
    pty: ptyProcess,
    command: toolCommand.command,
    args: toolCommand.args,
  };
};
