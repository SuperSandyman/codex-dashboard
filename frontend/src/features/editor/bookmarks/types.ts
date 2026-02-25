/**
 * Editor ファイルブックマーク 1 件の表示・永続化モデル。
 */
export interface EditorFileBookmark {
  readonly path: string;
  readonly label: string;
  readonly updatedAt: string;
}
