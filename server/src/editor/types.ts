export interface EditorCatalog {
  readonly workspaceRoot: string | null;
}

export type EditorNodeKind = 'file' | 'directory';

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

export interface WriteEditorFileParams {
  readonly path: string;
  readonly content: string;
  readonly expectedVersion: string;
}
