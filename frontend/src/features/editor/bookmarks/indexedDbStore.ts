import type { EditorFileBookmark } from './types';

const BOOKMARK_DB_NAME = 'codex_dashboard_editor';
const BOOKMARK_DB_VERSION = 1;
const BOOKMARK_STORE_NAME = 'editor_bookmarks';
const WORKSPACE_INDEX_NAME = 'workspace_root';

interface BookmarkRecord extends EditorFileBookmark {
  readonly id: string;
  readonly workspaceRoot: string;
}

const toBookmarkId = (workspaceRoot: string, path: string): string => {
  return `${workspaceRoot}::${path}`;
};

const ensureIndexedDbAvailable = (): IDBFactory => {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    throw new Error('IndexedDB is not available in this environment.');
  }
  return window.indexedDB;
};

const openBookmarkDatabase = async (): Promise<IDBDatabase> => {
  const indexedDb = ensureIndexedDbAvailable();
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(BOOKMARK_DB_NAME, BOOKMARK_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(BOOKMARK_STORE_NAME)
        ? request.transaction?.objectStore(BOOKMARK_STORE_NAME) ?? null
        : database.createObjectStore(BOOKMARK_STORE_NAME, { keyPath: 'id' });
      if (!store) {
        return;
      }
      if (!store.indexNames.contains(WORKSPACE_INDEX_NAME)) {
        store.createIndex(WORKSPACE_INDEX_NAME, 'workspaceRoot', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open bookmarks database.'));
  });
};

const runWriteTransaction = async (
  database: IDBDatabase,
  runRequest: (store: IDBObjectStore) => void,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(BOOKMARK_STORE_NAME, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Bookmark write transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Bookmark write transaction aborted.'));

    const store = transaction.objectStore(BOOKMARK_STORE_NAME);
    runRequest(store);
  });
};

const toBookmarkRecord = (
  workspaceRoot: string,
  bookmark: EditorFileBookmark,
): BookmarkRecord => {
  return {
    id: toBookmarkId(workspaceRoot, bookmark.path),
    workspaceRoot,
    path: bookmark.path,
    label: bookmark.label,
    updatedAt: bookmark.updatedAt,
  };
};

/**
 * workspaceRoot ごとのブックマーク一覧を取得する。
 * @param workspaceRoot ワークスペースの絶対パス
 */
export const listEditorBookmarks = async (
  workspaceRoot: string,
): Promise<EditorFileBookmark[]> => {
  const database = await openBookmarkDatabase();
  try {
    const records = await new Promise<BookmarkRecord[]>((resolve, reject) => {
      const transaction = database.transaction(BOOKMARK_STORE_NAME, 'readonly');
      const store = transaction.objectStore(BOOKMARK_STORE_NAME);
      const index = store.index(WORKSPACE_INDEX_NAME);
      const request = index.getAll(workspaceRoot);
      request.onsuccess = () => {
        const result = Array.isArray(request.result) ? request.result : [];
        resolve(result as BookmarkRecord[]);
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to list bookmarks.'));
    });

    return records
      .map((record) => ({
        path: record.path,
        label: record.label,
        updatedAt: record.updatedAt,
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } finally {
    database.close();
  }
};

/**
 * ブックマークを追加または更新する。
 * @param workspaceRoot ワークスペースの絶対パス
 * @param bookmark 保存対象
 */
export const upsertEditorBookmark = async (
  workspaceRoot: string,
  bookmark: EditorFileBookmark,
): Promise<void> => {
  const database = await openBookmarkDatabase();
  try {
    await runWriteTransaction(database, (store) => {
      store.put(toBookmarkRecord(workspaceRoot, bookmark));
    });
  } finally {
    database.close();
  }
};

/**
 * 指定パスのブックマークを削除する。
 * @param workspaceRoot ワークスペースの絶対パス
 * @param path ファイル相対パス
 */
export const removeEditorBookmark = async (
  workspaceRoot: string,
  path: string,
): Promise<void> => {
  const database = await openBookmarkDatabase();
  try {
    await runWriteTransaction(database, (store) => {
      store.delete(toBookmarkId(workspaceRoot, path));
    });
  } finally {
    database.close();
  }
};

/**
 * 存在しないファイル群に対応するブックマークをまとめて削除する。
 * @param workspaceRoot ワークスペースの絶対パス
 * @param missingPaths 削除対象のファイル相対パス
 */
export const clearMissingEditorBookmarks = async (
  workspaceRoot: string,
  missingPaths: readonly string[],
): Promise<void> => {
  if (missingPaths.length === 0) {
    return;
  }
  const database = await openBookmarkDatabase();
  try {
    await runWriteTransaction(database, (store) => {
      missingPaths.forEach((path) => {
        store.delete(toBookmarkId(workspaceRoot, path));
      });
    });
  } finally {
    database.close();
  }
};
