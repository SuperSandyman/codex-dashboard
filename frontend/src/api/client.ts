export interface ApiError {
  readonly code: string;
  readonly message: string;
}

export interface ApiResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: ApiError;
  readonly status: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const isApiError = (value: unknown): value is ApiError => {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.code === 'string' && typeof value.message === 'string';
};

const buildError = (status: number, fallbackMessage: string): ApiResult<never> => {
  return {
    ok: false,
    error: {
      code: status >= 500 ? 'server_error' : 'request_error',
      message: fallbackMessage,
    },
    status,
  };
};

/**
 * API から JSON を取得し、型検証したうえで返す。
 * @param input API のパス
 * @param init fetch オプション
 * @param parser レスポンスの検証/変換関数
 */
export const requestJson = async <T>(
  input: string,
  init: RequestInit,
  parser: (payload: unknown) => T | null,
): Promise<ApiResult<T>> => {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'network error';
    return buildError(0, message);
  }

  let payload: unknown = null;
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (payload && isRecord(payload) && isApiError(payload.error)) {
      return {
        ok: false,
        error: payload.error,
        status: response.status,
      };
    }
    return buildError(response.status, 'API request failed');
  }

  const parsed = parser(payload);
  if (!parsed) {
    return {
      ok: false,
      error: {
        code: 'invalid_response',
        message: 'API レスポンス形式が不正です。',
      },
      status: response.status,
    };
  }

  return {
    ok: true,
    data: parsed,
    status: response.status,
  };
};
