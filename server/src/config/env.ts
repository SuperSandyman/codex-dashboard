import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

interface EnvConfig {
  readonly port: number;
  readonly bindHost: string;
  readonly workspaceRoot: string | null;
  readonly editorMaxFileSizeBytes: number;
  readonly editorMaxSaveBytes: number;
  readonly terminalIdleTimeoutMs: number;
  readonly appServerCommand: string;
  readonly appServerArgs: readonly string[];
  readonly appServerCwd: string | null;
  readonly appServerRequestTimeoutMs: number;
  readonly envPath: string | null;
}

const DEFAULT_PORT = 8787;
const DEFAULT_BIND_HOST = '127.0.0.1';
const DEFAULT_APP_SERVER_COMMAND = 'codex';
const DEFAULT_APP_SERVER_ARGS = ['app-server'];
const DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_TERMINAL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_EDITOR_MAX_FILE_SIZE_BYTES = 1024 * 1024;
const DEFAULT_EDITOR_MAX_SAVE_BYTES = 1024 * 1024;

const resolveEnvPath = (): string | null => {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const parsePort = (rawValue: string | undefined, errors: string[]): number => {
  if (rawValue === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(rawValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT は 1〜65535 の整数で指定してください。');
  }

  return port;
};

const parseBindHost = (rawValue: string | undefined, errors: string[]): string => {
  const bindHost = rawValue?.trim() ?? DEFAULT_BIND_HOST;
  if (bindHost.length === 0) {
    errors.push('BIND_HOST は空文字にできません。');
  }

  return bindHost;
};

const parsePositiveNumber = (
  key: string,
  rawValue: string | undefined,
  fallback: number,
  errors: string[],
): number => {
  if (rawValue === undefined) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${key} は 1 以上の数値で指定してください。`);
    return fallback;
  }

  return value;
};

const parsePositiveInteger = (
  key: string,
  rawValue: string | undefined,
  fallback: number,
  errors: string[],
): number => {
  if (rawValue === undefined) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${key} は 1 以上の整数で指定してください。`);
    return fallback;
  }

  return value;
};

const parseAbsolutePath = (
  key: string,
  rawValue: string | undefined,
  errors: string[],
): string | null => {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return null;
  }

  if (!path.isAbsolute(rawValue)) {
    errors.push(`${key} は絶対パスで指定してください。`);
  }

  return rawValue;
};

const parseAppServerCommand = (rawValue: string | undefined, errors: string[]): string => {
  const value = rawValue?.trim() ?? DEFAULT_APP_SERVER_COMMAND;
  if (value.length === 0) {
    errors.push('APP_SERVER_COMMAND は空文字にできません。');
  }
  return value;
};

const parseAppServerArgs = (rawValue: string | undefined, errors: string[]): string[] => {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return [...DEFAULT_APP_SERVER_ARGS];
  }
  const args = rawValue
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (args.length === 0) {
    errors.push('APP_SERVER_ARGS は 1 つ以上の引数を指定してください。');
    return [...DEFAULT_APP_SERVER_ARGS];
  }

  return args;
};

/**
 * サーバ起動に必要な環境変数を読み込み、検証済みの設定として返す。
 * - `.env` はカレントまたは親ディレクトリを探索して読み込む
 * - 不正値は詳細メッセージ付きで例外化する
 */
export const loadEnvConfig = (): EnvConfig => {
  const envPath = resolveEnvPath();
  if (envPath) {
    dotenv.config({ path: envPath });
  }

  const errors: string[] = [];
  const port = parsePort(process.env.PORT, errors);
  const bindHost = parseBindHost(process.env.BIND_HOST, errors);
  const workspaceRoot = parseAbsolutePath('WORKSPACE_ROOT', process.env.WORKSPACE_ROOT, errors);
  const appServerCommand = parseAppServerCommand(process.env.APP_SERVER_COMMAND, errors);
  const appServerArgs = parseAppServerArgs(process.env.APP_SERVER_ARGS, errors);
  const appServerCwd = parseAbsolutePath('APP_SERVER_CWD', process.env.APP_SERVER_CWD, errors);
  const editorMaxFileSizeBytes = parsePositiveInteger(
    'EDITOR_MAX_FILE_SIZE_BYTES',
    process.env.EDITOR_MAX_FILE_SIZE_BYTES,
    DEFAULT_EDITOR_MAX_FILE_SIZE_BYTES,
    errors,
  );
  const editorMaxSaveBytes = parsePositiveInteger(
    'EDITOR_MAX_SAVE_BYTES',
    process.env.EDITOR_MAX_SAVE_BYTES,
    DEFAULT_EDITOR_MAX_SAVE_BYTES,
    errors,
  );
  const terminalIdleTimeoutMs = parsePositiveNumber(
    'TERMINAL_IDLE_TIMEOUT_MS',
    process.env.TERMINAL_IDLE_TIMEOUT_MS,
    DEFAULT_TERMINAL_IDLE_TIMEOUT_MS,
    errors,
  );
  const appServerRequestTimeoutMs = parsePositiveNumber(
    'APP_SERVER_REQUEST_TIMEOUT_MS',
    process.env.APP_SERVER_REQUEST_TIMEOUT_MS,
    DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS,
    errors,
  );

  if (errors.length > 0) {
    throw new Error([
      '環境変数の検証に失敗しました。',
      ...errors.map((error) => `- ${error}`),
    ].join('\n'));
  }

  return {
    port,
    bindHost,
    workspaceRoot,
    editorMaxFileSizeBytes,
    editorMaxSaveBytes,
    terminalIdleTimeoutMs,
    appServerCommand,
    appServerArgs,
    appServerCwd,
    appServerRequestTimeoutMs,
    envPath,
  };
};
