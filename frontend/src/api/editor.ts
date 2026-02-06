import { requestJson } from './client';

export type EditorNodeKind = 'file' | 'directory';

export interface EditorCatalog {
  readonly workspaceRoot: string | null;
}

export interface EditorTreeNode {
  readonly name: string;
  readonly path: string;
  readonly kind: EditorNodeKind;
  readonly hasChildren: boolean;
}

export interface EditorTreeResponse {
  readonly path: string;
  readonly nodes: EditorTreeNode[];
}

export interface EditorFileResponse {
  readonly path: string;
  readonly content: string;
  readonly sizeBytes: number;
  readonly version: string;
  readonly updatedAt: string;
}

export interface SaveEditorFileRequest {
  readonly path: string;
  readonly content: string;
  readonly expectedVersion: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const parseEditorCatalog = (value: unknown): EditorCatalog | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (value.workspaceRoot !== null && typeof value.workspaceRoot !== 'string') {
    return null;
  }
  return { workspaceRoot: value.workspaceRoot };
};

const parseEditorTreeNode = (value: unknown): EditorTreeNode | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.name !== 'string' ||
    typeof value.path !== 'string' ||
    (value.kind !== 'file' && value.kind !== 'directory') ||
    typeof value.hasChildren !== 'boolean'
  ) {
    return null;
  }
  return {
    name: value.name,
    path: value.path,
    kind: value.kind,
    hasChildren: value.hasChildren,
  };
};

const parseEditorTreeResponse = (value: unknown): EditorTreeResponse | null => {
  if (!isRecord(value) || typeof value.path !== 'string' || !Array.isArray(value.nodes)) {
    return null;
  }
  const nodes: EditorTreeNode[] = [];
  for (const node of value.nodes) {
    const parsedNode = parseEditorTreeNode(node);
    if (!parsedNode) {
      return null;
    }
    nodes.push(parsedNode);
  }
  return {
    path: value.path,
    nodes,
  };
};

const parseEditorFileResponse = (value: unknown): EditorFileResponse | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.path !== 'string' ||
    typeof value.content !== 'string' ||
    typeof value.sizeBytes !== 'number' ||
    typeof value.version !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    path: value.path,
    content: value.content,
    sizeBytes: value.sizeBytes,
    version: value.version,
    updatedAt: value.updatedAt,
  };
};

/**
 * Editor の基本情報を取得する。
 */
export const getEditorCatalog = async () => {
  return requestJson('/api/editor/catalog', { method: 'GET' }, parseEditorCatalog);
};

/**
 * ディレクトリ配下のツリー一覧を取得する。
 * @param targetPath 相対ディレクトリパス
 */
export const getEditorTree = async (targetPath: string) => {
  const query = new URLSearchParams({ path: targetPath });
  return requestJson(`/api/editor/tree?${query.toString()}`, { method: 'GET' }, parseEditorTreeResponse);
};

/**
 * ファイル内容を取得する。
 * @param targetPath 相対ファイルパス
 */
export const getEditorFile = async (targetPath: string) => {
  const query = new URLSearchParams({ path: targetPath });
  return requestJson(`/api/editor/file?${query.toString()}`, { method: 'GET' }, parseEditorFileResponse);
};

/**
 * ファイル内容を保存する。
 * @param payload 保存内容
 */
export const saveEditorFile = async (payload: SaveEditorFileRequest) => {
  return requestJson(
    '/api/editor/file',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    parseEditorFileResponse,
  );
};
