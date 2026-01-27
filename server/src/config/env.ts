import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

interface EnvConfig {
  readonly port: number;
  readonly bindHost: string;
  readonly workspaceRoot: string | null;
  readonly skillsDir: string | null;
  readonly envPath: string | null;
}

const DEFAULT_PORT = 8787;
const DEFAULT_BIND_HOST = '127.0.0.1';

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

const parseAbsolutePath = (
  key: 'WORKSPACE_ROOT' | 'SKILLS_DIR',
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
  const skillsDir = parseAbsolutePath('SKILLS_DIR', process.env.SKILLS_DIR, errors);

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
    skillsDir,
    envPath,
  };
};
