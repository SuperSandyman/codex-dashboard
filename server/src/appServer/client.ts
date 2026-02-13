import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

interface AppServerClientOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | null;
  readonly requestTimeoutMs: number;
}

interface RpcPendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

interface RpcErrorShape {
  readonly code: number;
  readonly message: string;
}

interface RpcNotification {
  readonly method: string;
  readonly params?: unknown;
}

type NotificationListener = (notification: RpcNotification) => void;

interface RpcServerRequest {
  readonly id: string | number;
  readonly method: string;
  readonly params?: unknown;
}

interface PendingServerRequest {
  readonly id: string | number;
  readonly method: string;
}

type ServerRequestListener = (request: RpcServerRequest) => boolean;

const DEFAULT_CLIENT_NAME = 'codex-dashboard';
const DEFAULT_CLIENT_VERSION = '0.1.0';
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const isRequestId = (value: unknown): value is string | number => {
  return typeof value === 'string' || typeof value === 'number';
};

const parseRpcError = (value: unknown): RpcErrorShape | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.code !== 'number' || typeof value.message !== 'string') {
    return null;
  }
  return {
    code: value.code,
    message: value.message,
  };
};

/**
 * app-server のリクエスト失敗を表す。
 */
export class AppServerRequestError extends Error {
  readonly code: number;
  readonly method: string;

  constructor(method: string, code: number, message: string) {
    super(message);
    this.method = method;
    this.code = code;
  }
}

/**
 * app-server クライアント自体の障害を表す。
 */
export class AppServerClientError extends Error {}

/**
 * codex app-server と JSON-RPC 互換の行指向プロトコルで通信する。
 */
export class AppServerClient {
  readonly #command: string;
  readonly #args: readonly string[];
  readonly #cwd: string | null;
  readonly #requestTimeoutMs: number;

  #process: ChildProcessWithoutNullStreams | null = null;
  #stdoutBuffer = '';
  #isReady = false;
  #startupPromise: Promise<void> | null = null;
  #requestCounter = 0;
  readonly #pending = new Map<string, RpcPendingRequest>();
  readonly #notificationListeners = new Set<NotificationListener>();
  readonly #serverRequestListeners = new Set<ServerRequestListener>();
  readonly #pendingServerRequests = new Map<string, PendingServerRequest>();

  /**
   * app-server クライアントを作成する。
   * @param options 起動オプション
   */
  constructor(options: AppServerClientOptions) {
    this.#command = options.command;
    this.#args = options.args;
    this.#cwd = options.cwd;
    this.#requestTimeoutMs =
      options.requestTimeoutMs > 0 ? options.requestTimeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * app-server へリクエストを送信し、レスポンスを返す。
   * @param method RPC メソッド名
   * @param params リクエストパラメータ
   */
  async request(method: string, params: unknown): Promise<unknown> {
    await this.#ensureReady();
    return this.#requestInternal(method, params);
  }

  /**
   * app-server 通知の購読を登録する。
   * @param listener 通知リスナー
   */
  onNotification(listener: NotificationListener): () => void {
    this.#notificationListeners.add(listener);
    return () => {
      this.#notificationListeners.delete(listener);
    };
  }

  /**
   * app-server からの server-initiated request を購読する。
   * @param listener request リスナー（handled=true を返した場合は呼び出し側で応答する）
   */
  onServerRequest(listener: ServerRequestListener): () => void {
    this.#serverRequestListeners.add(listener);
    return () => {
      this.#serverRequestListeners.delete(listener);
    };
  }

  /**
   * server-initiated request に result を返す。
   * @param id request id
   * @param result response payload
   */
  respondServerRequest(id: string | number, result: unknown): void {
    const key = String(id);
    const pending = this.#pendingServerRequests.get(key);
    if (!pending) {
      throw new AppServerClientError(`server request not found: ${key}`);
    }
    this.#pendingServerRequests.delete(key);
    this.#writeJson({
      id: pending.id,
      result,
    });
  }

  /**
   * server-initiated request に error を返す。
   * @param id request id
   * @param code JSON-RPC error code
   * @param message error message
   */
  rejectServerRequest(id: string | number, code: number, message: string): void {
    const key = String(id);
    const pending = this.#pendingServerRequests.get(key);
    if (!pending) {
      throw new AppServerClientError(`server request not found: ${key}`);
    }
    this.#pendingServerRequests.delete(key);
    this.#writeJson({
      id: pending.id,
      error: {
        code,
        message,
      },
    });
  }

  /**
   * app-server プロセスを停止し、保留中リクエストを失敗させる。
   */
  dispose(): void {
    this.#rejectPending(new AppServerClientError('app-server client disposed'));
    this.#pendingServerRequests.clear();
    if (!this.#process) {
      return;
    }
    this.#process.kill('SIGTERM');
    this.#process = null;
    this.#isReady = false;
    this.#stdoutBuffer = '';
  }

  async #ensureReady(): Promise<void> {
    if (this.#isReady) {
      return;
    }
    if (this.#startupPromise) {
      await this.#startupPromise;
      return;
    }

    this.#startupPromise = this.#startAndInitialize();
    try {
      await this.#startupPromise;
    } finally {
      this.#startupPromise = null;
    }
  }

  async #startAndInitialize(): Promise<void> {
    if (!this.#process) {
      this.#startProcess();
    }

    const result = await this.#requestInternal('initialize', {
      clientInfo: {
        name: DEFAULT_CLIENT_NAME,
        title: null,
        version: DEFAULT_CLIENT_VERSION,
      },
    });
    if (!isRecord(result) || typeof result.userAgent !== 'string') {
      throw new AppServerClientError('initialize response is invalid');
    }
    this.#writeJson({
      method: 'initialized',
    });
    this.#isReady = true;
  }

  #startProcess(): void {
    const child = spawn(this.#command, [...this.#args], {
      cwd: this.#cwd ?? undefined,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#process = child;
    this.#stdoutBuffer = '';
    this.#isReady = false;

    child.stdout.on('data', (chunk: Buffer) => {
      this.#handleStdoutChunk(chunk.toString('utf-8'));
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const output = chunk.toString('utf-8').trim();
      if (output.length > 0) {
        console.warn('[app-server stderr]', output);
      }
    });

    child.on('error', (error) => {
      this.#handleProcessFailure(error instanceof Error ? error : new Error(String(error)));
    });

    child.on('exit', (code, signal) => {
      const reason = `app-server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
      this.#handleProcessFailure(new AppServerClientError(reason));
    });
  }

  #handleProcessFailure(error: Error): void {
    this.#isReady = false;
    this.#process = null;
    this.#stdoutBuffer = '';
    this.#rejectPending(error);
    this.#pendingServerRequests.clear();
  }

  #rejectPending(error: Error): void {
    const pendings = [...this.#pending.values()];
    this.#pending.clear();
    pendings.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(error);
    });
  }

  #handleStdoutChunk(chunk: string): void {
    this.#stdoutBuffer = `${this.#stdoutBuffer}${chunk}`;
    while (true) {
      const newlineIndex = this.#stdoutBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }
      const line = this.#stdoutBuffer.slice(0, newlineIndex).trim();
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newlineIndex + 1);
      if (line.length === 0) {
        continue;
      }
      this.#handleIncomingLine(line);
    }
  }

  #handleIncomingLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      console.error('failed to parse app-server line', { line, error });
      return;
    }

    if (!isRecord(parsed)) {
      return;
    }

    if (isRequestId(parsed.id)) {
      if (typeof parsed.method === 'string') {
        this.#handleServerRequest(parsed.id, parsed.method, parsed.params);
        return;
      }
      this.#handleResponse(parsed.id, parsed);
      return;
    }

    if (typeof parsed.method === 'string') {
      this.#emitNotification({
        method: parsed.method,
        params: parsed.params,
      });
    }
  }

  #handleServerRequest(id: string | number, method: string, params: unknown): void {
    const requestKey = String(id);
    this.#pendingServerRequests.set(requestKey, {
      id,
      method,
    });

    if (this.#serverRequestListeners.size === 0) {
      this.rejectServerRequest(id, -32601, `unsupported client request: ${method}`);
      return;
    }

    const request: RpcServerRequest = { id, method, params };
    let handled = false;
    this.#serverRequestListeners.forEach((listener) => {
      if (handled) {
        return;
      }
      try {
        handled = listener(request);
      } catch (error) {
        console.error('server request listener failed', error);
      }
    });

    if (!handled) {
      this.rejectServerRequest(id, -32601, `unsupported client request: ${method}`);
      return;
    }
  }

  #handleResponse(id: string | number, payload: Record<string, unknown>): void {
    const requestId = String(id);
    const pending = this.#pending.get(requestId);
    if (!pending) {
      return;
    }
    this.#pending.delete(requestId);
    clearTimeout(pending.timeout);

    const parsedError = parseRpcError(payload.error);
    if (parsedError) {
      pending.reject(new AppServerRequestError(pending.method, parsedError.code, parsedError.message));
      return;
    }

    if (!('result' in payload)) {
      pending.reject(new AppServerClientError(`response for ${pending.method} has no result`));
      return;
    }

    pending.resolve(payload.result);
  }

  #emitNotification(notification: RpcNotification): void {
    this.#notificationListeners.forEach((listener) => {
      try {
        listener(notification);
      } catch (error) {
        console.error('notification listener failed', error);
      }
    });
  }

  #requestInternal(method: string, params: unknown): Promise<unknown> {
    if (!this.#process || this.#process.stdin.destroyed || !this.#process.stdin.writable) {
      return Promise.reject(new AppServerClientError('app-server process is not writable'));
    }

    this.#requestCounter += 1;
    const id = String(this.#requestCounter);

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new AppServerClientError(`request timeout: ${method}`));
      }, this.#requestTimeoutMs);

      this.#pending.set(id, {
        method,
        resolve,
        reject,
        timeout,
      });

      this.#writeJson({
        method,
        id,
        params,
      });
    });
  }

  #writeJson(payload: Record<string, unknown>): void {
    if (!this.#process || this.#process.stdin.destroyed || !this.#process.stdin.writable) {
      throw new AppServerClientError('app-server stdin is unavailable');
    }
    this.#process.stdin.write(`${JSON.stringify(payload)}\n`);
  }
}
