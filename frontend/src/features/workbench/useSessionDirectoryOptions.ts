import { useCallback, useRef, useState } from 'react';

import { getEditorTree } from '../../api/editor';
import {
  countPathDepth,
  resolveDirectoryInputValue,
  SESSION_DIRECTORY_CACHE_TTL_MS,
  type SessionDirectoryCache,
  type SessionDirectoryRequest,
  toAbsoluteWorkspacePath,
  toRelativeWorkspacePath,
} from '../dashboard/dashboardUtils';

interface UseSessionDirectoryOptionsParams {
  readonly workspaceRoot: string | null;
  readonly chatCwdChoices: readonly string[];
  readonly terminalWorkspaceRoot: string | null;
  readonly terminalCwdChoices: readonly string[];
  readonly onError: (message: string) => void;
}

interface RefreshSessionDirectoryOptionsOptions {
  readonly notifyOnError: boolean;
  readonly forceReload?: boolean;
}

interface UseSessionDirectoryOptionsResult {
  readonly sessionDirectoryOptions: readonly string[];
  readonly isLoadingSessionDirectories: boolean;
  readonly sessionDirectoryError: string | null;
  readonly refreshSessionDirectoryOptions: (
    options: RefreshSessionDirectoryOptionsOptions,
  ) => Promise<void>;
}

/**
 * chat / terminal 作成ダイアログ向けのディレクトリ候補を管理する。
 * @param params ワークスペース情報とエラーハンドラ
 * @returns 候補一覧と再読込ハンドラ
 */
export const useSessionDirectoryOptions = (
  params: UseSessionDirectoryOptionsParams,
): UseSessionDirectoryOptionsResult => {
  const {
    workspaceRoot,
    chatCwdChoices,
    terminalWorkspaceRoot,
    terminalCwdChoices,
    onError,
  } = params;

  const [sessionDirectoryOptions, setSessionDirectoryOptions] = useState<string[]>([]);
  const [isLoadingSessionDirectories, setIsLoadingSessionDirectories] = useState(false);
  const [sessionDirectoryError, setSessionDirectoryError] = useState<string | null>(null);

  const sessionDirectoryInFlightRef = useRef<SessionDirectoryRequest | null>(null);
  const sessionDirectoryCacheRef = useRef<SessionDirectoryCache | null>(null);
  const sessionDirectoryRequestIdRef = useRef(0);

  const refreshSessionDirectoryOptions = useCallback(
    async ({ notifyOnError, forceReload = false }: RefreshSessionDirectoryOptionsOptions) => {
      const pickerWorkspaceRoot = workspaceRoot ?? terminalWorkspaceRoot;
      if (!pickerWorkspaceRoot) {
        sessionDirectoryInFlightRef.current = null;
        sessionDirectoryCacheRef.current = null;
        setSessionDirectoryOptions([]);
        setSessionDirectoryError(null);
        return;
      }

      const directorySet = new Set<string>();
      const appendSeedDirectory = (cwd: string) => {
        const candidate = resolveDirectoryInputValue(pickerWorkspaceRoot, cwd);
        if (!candidate || candidate === pickerWorkspaceRoot) {
          return;
        }
        const relativePath = toRelativeWorkspacePath(pickerWorkspaceRoot, candidate);
        if (relativePath === null) {
          return;
        }
        directorySet.add(toAbsoluteWorkspacePath(pickerWorkspaceRoot, relativePath));
      };

      chatCwdChoices.forEach((cwd) => appendSeedDirectory(cwd));
      terminalCwdChoices.forEach((cwd) => appendSeedDirectory(cwd));

      const mergeOptions = (directories: readonly string[]): string[] => {
        const merged = new Set(directorySet);
        directories.forEach((directory) => merged.add(directory));
        return [...merged].sort((a, b) => a.localeCompare(b));
      };

      const cached = sessionDirectoryCacheRef.current;
      const isCacheFresh =
        cached &&
        cached.workspaceRoot === pickerWorkspaceRoot &&
        Date.now() - cached.fetchedAt < SESSION_DIRECTORY_CACHE_TTL_MS;
      if (!forceReload && isCacheFresh) {
        setSessionDirectoryOptions(mergeOptions(cached.directories));
        setSessionDirectoryError(null);
        setIsLoadingSessionDirectories(false);
        return;
      }

      setIsLoadingSessionDirectories(true);
      setSessionDirectoryError(null);

      let fetchPromise: Promise<readonly string[]>;
      const inFlight = sessionDirectoryInFlightRef.current;
      if (inFlight && inFlight.workspaceRoot === pickerWorkspaceRoot) {
        fetchPromise = inFlight.promise;
      } else {
        fetchPromise = (async (): Promise<readonly string[]> => {
          const rootTreeResult = await getEditorTree('');
          if (!rootTreeResult.ok || !rootTreeResult.data) {
            throw new Error(rootTreeResult.error?.message ?? 'Failed to load directories');
          }

          const firstLevelDirectories = rootTreeResult.data.nodes
            .filter((node) => node.kind === 'directory' && countPathDepth(node.path) <= 1)
            .map((node) => node.path)
            .slice(0, 30);

          const treeDirectories = new Set<string>();
          firstLevelDirectories.forEach((relativePath) => {
            treeDirectories.add(toAbsoluteWorkspacePath(pickerWorkspaceRoot, relativePath));
          });

          const secondLevelResults = await Promise.all(
            firstLevelDirectories.map((relativePath) => getEditorTree(relativePath)),
          );
          secondLevelResults.forEach((result) => {
            if (!result.ok || !result.data) {
              return;
            }
            result.data.nodes.forEach((node) => {
              if (node.kind !== 'directory') {
                return;
              }
              if (countPathDepth(node.path) <= 2) {
                treeDirectories.add(toAbsoluteWorkspacePath(pickerWorkspaceRoot, node.path));
              }
            });
          });
          return [...treeDirectories].sort((a, b) => a.localeCompare(b));
        })();
        sessionDirectoryInFlightRef.current = {
          workspaceRoot: pickerWorkspaceRoot,
          promise: fetchPromise,
        };
      }

      const requestId = sessionDirectoryRequestIdRef.current + 1;
      sessionDirectoryRequestIdRef.current = requestId;
      try {
        const loadedDirectories = await fetchPromise;
        if (sessionDirectoryRequestIdRef.current !== requestId) {
          return;
        }

        sessionDirectoryCacheRef.current = {
          workspaceRoot: pickerWorkspaceRoot,
          fetchedAt: Date.now(),
          directories: loadedDirectories,
        };
        setSessionDirectoryOptions(mergeOptions(loadedDirectories));
        setSessionDirectoryError(null);
      } catch (error) {
        if (sessionDirectoryRequestIdRef.current !== requestId) {
          return;
        }
        setSessionDirectoryOptions(mergeOptions([]));
        const message = error instanceof Error ? error.message : 'Failed to load directories';
        setSessionDirectoryError(message);
        if (notifyOnError) {
          onError(message);
        }
      } finally {
        if (sessionDirectoryRequestIdRef.current === requestId) {
          setIsLoadingSessionDirectories(false);
        }
        const latestInFlight = sessionDirectoryInFlightRef.current;
        if (
          latestInFlight?.workspaceRoot === pickerWorkspaceRoot &&
          latestInFlight.promise === fetchPromise
        ) {
          sessionDirectoryInFlightRef.current = null;
        }
      }
    },
    [chatCwdChoices, onError, terminalCwdChoices, terminalWorkspaceRoot, workspaceRoot],
  );

  return {
    sessionDirectoryOptions,
    isLoadingSessionDirectories,
    sessionDirectoryError,
    refreshSessionDirectoryOptions,
  };
};
