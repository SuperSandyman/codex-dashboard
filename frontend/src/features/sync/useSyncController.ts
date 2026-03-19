import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  executeSyncExport,
  executeSyncImport,
  getSyncJob,
  getSyncJobError,
  getSyncStatus,
  listSyncWorkspaces,
  previewSyncExport,
  previewSyncImport,
  type SyncJobErrorDetails,
  type SyncJobSnapshot,
  type SyncPreviewResult,
  type SyncStatus,
  type SyncWorkspaceSummary,
} from '../../api/sync';

interface UseSyncControllerParams {
  readonly onToast: (message: string) => void;
}

type SyncConfirmKind = 'import' | 'export' | null;

interface SyncConfirmState {
  readonly kind: SyncConfirmKind;
}

export interface UseSyncControllerResult {
  readonly status: SyncStatus | null;
  readonly workspaces: readonly SyncWorkspaceSummary[];
  readonly importSourcePath: string;
  readonly importWorkspaceName: string;
  readonly exportWorkspaceName: string;
  readonly exportDestinationPath: string;
  readonly importPreview: SyncPreviewResult | null;
  readonly exportPreview: SyncPreviewResult | null;
  readonly activeJob: SyncJobSnapshot | null;
  readonly activeJobError: SyncJobErrorDetails | null;
  readonly isLoadingStatus: boolean;
  readonly isLoadingWorkspaces: boolean;
  readonly isLoadingImportPreview: boolean;
  readonly isLoadingExportPreview: boolean;
  readonly confirmState: SyncConfirmState;
  readonly onChangeImportSourcePath: (value: string) => void;
  readonly onChangeImportWorkspaceName: (value: string) => void;
  readonly onChangeExportWorkspaceName: (value: string) => void;
  readonly onChangeExportDestinationPath: (value: string) => void;
  readonly onReloadStatus: () => void;
  readonly onReloadWorkspaces: () => void;
  readonly onPreviewImport: () => void;
  readonly onPreviewExport: () => void;
  readonly onRequestImport: () => void;
  readonly onRequestExport: () => void;
  readonly onCloseConfirm: () => void;
  readonly onConfirmExecute: () => void;
  readonly isActionLocked: boolean;
}

/**
 * Sync 画面の API 呼び出しとジョブ進行状態をまとめて管理する。
 * @param params toast 表示ハンドラ
 */
export const useSyncController = ({
  onToast,
}: UseSyncControllerParams): UseSyncControllerResult => {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [workspaces, setWorkspaces] = useState<SyncWorkspaceSummary[]>([]);
  const [importSourcePath, setImportSourcePath] = useState('');
  const [importWorkspaceName, setImportWorkspaceName] = useState('');
  const [exportWorkspaceName, setExportWorkspaceName] = useState('');
  const [exportDestinationPath, setExportDestinationPath] = useState('');
  const [importPreview, setImportPreview] = useState<SyncPreviewResult | null>(null);
  const [exportPreview, setExportPreview] = useState<SyncPreviewResult | null>(null);
  const [activeJob, setActiveJob] = useState<SyncJobSnapshot | null>(null);
  const [activeJobError, setActiveJobError] = useState<SyncJobErrorDetails | null>(null);
  const [confirmState, setConfirmState] = useState<SyncConfirmState>({ kind: null });

  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [isLoadingImportPreview, setIsLoadingImportPreview] = useState(false);
  const [isLoadingExportPreview, setIsLoadingExportPreview] = useState(false);

  const isActionLocked = activeJob?.status === 'running';

  const refreshStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    const result = await getSyncStatus();
    setIsLoadingStatus(false);
    if (!result.ok || !result.data) {
      onToast(result.error?.message ?? 'Failed to load sync status');
      return;
    }
    setStatus(result.data);
  }, [onToast]);

  const refreshWorkspaces = useCallback(async () => {
    setIsLoadingWorkspaces(true);
    const result = await listSyncWorkspaces();
    setIsLoadingWorkspaces(false);
    if (!result.ok || !result.data) {
      if (result.status !== 503) {
        onToast(result.error?.message ?? 'Failed to load sync workspaces');
      }
      setWorkspaces([]);
      return;
    }

    const nextWorkspaces = [...result.data.workspaces];
    setWorkspaces(nextWorkspaces);
    setExportWorkspaceName((prev) => {
      if (prev && nextWorkspaces.some((workspace) => workspace.name === prev)) {
        return prev;
      }
      return nextWorkspaces[0]?.name ?? '';
    });
  }, [onToast]);

  useEffect(() => {
    void Promise.all([refreshStatus(), refreshWorkspaces()]);
  }, [refreshStatus, refreshWorkspaces]);

  useEffect(() => {
    const selectedWorkspace = workspaces.find((workspace) => workspace.name === exportWorkspaceName) ?? null;
    if (!selectedWorkspace) {
      return;
    }
    setExportDestinationPath((prev) => {
      if (prev.trim().length > 0) {
        return prev;
      }
      return selectedWorkspace.lastImportSourcePath ?? prev;
    });
  }, [exportWorkspaceName, workspaces]);

  useEffect(() => {
    if (!activeJob || activeJob.status !== 'running') {
      return;
    }

    const timer = window.setInterval(() => {
      void (async () => {
        const result = await getSyncJob(activeJob.jobId);
        if (!result.ok || !result.data) {
          onToast(result.error?.message ?? 'Failed to poll sync job');
          return;
        }
        setActiveJob(result.data);
        if (result.data.status === 'failed') {
          const errorResult = await getSyncJobError(result.data.jobId);
          if (errorResult.ok && errorResult.data) {
            setActiveJobError(errorResult.data);
            onToast(errorResult.data.error);
          }
          return;
        }
        if (result.data.status === 'succeeded') {
          setActiveJobError(null);
          onToast(result.data.message);
          await refreshWorkspaces();
        }
      })();
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeJob, onToast, refreshWorkspaces]);

  const canRunPreview = useMemo(() => {
    return Boolean(status?.configured && status.sshReachable);
  }, [status]);

  const handlePreviewImport = useCallback(async () => {
    if (!canRunPreview) {
      onToast('Sync host is not reachable.');
      return;
    }
    setIsLoadingImportPreview(true);
    setActiveJobError(null);
    const result = await previewSyncImport({
      sourcePath: importSourcePath,
      workspaceName: importWorkspaceName,
    });
    setIsLoadingImportPreview(false);
    if (!result.ok || !result.data) {
      onToast(result.error?.message ?? 'Failed to preview import');
      return;
    }
    setImportPreview(result.data);
    if (exportWorkspaceName.length === 0) {
      setExportWorkspaceName(result.data.workspaceName);
    }
  }, [canRunPreview, exportWorkspaceName.length, importSourcePath, importWorkspaceName, onToast]);

  const handlePreviewExport = useCallback(async () => {
    if (!canRunPreview) {
      onToast('Sync host is not reachable.');
      return;
    }
    setIsLoadingExportPreview(true);
    setActiveJobError(null);
    const result = await previewSyncExport({
      workspaceName: exportWorkspaceName,
      destinationPath: exportDestinationPath,
    });
    setIsLoadingExportPreview(false);
    if (!result.ok || !result.data) {
      onToast(result.error?.message ?? 'Failed to preview export');
      return;
    }
    setExportPreview(result.data);
    const { lastImportSourcePath } = result.data;
    setExportDestinationPath((prev) => prev || lastImportSourcePath || prev);
  }, [canRunPreview, exportDestinationPath, exportWorkspaceName, onToast]);

  const handleConfirmExecute = useCallback(async () => {
    if (confirmState.kind === 'import' && importPreview) {
      const result = await executeSyncImport({
        sourcePath: importPreview.sourcePath,
        workspaceName: importPreview.workspaceName,
        previewToken: importPreview.previewToken,
      });
      if (!result.ok || !result.data) {
        onToast(result.error?.message ?? 'Failed to start import');
        return;
      }
      const jobResult = await getSyncJob(result.data.jobId);
      if (jobResult.ok && jobResult.data) {
        setActiveJob(jobResult.data);
        setActiveJobError(null);
      }
      setConfirmState({ kind: null });
      return;
    }

    if (confirmState.kind === 'export' && exportPreview) {
      const result = await executeSyncExport({
        workspaceName: exportPreview.workspaceName,
        destinationPath: exportPreview.destinationPath,
        previewToken: exportPreview.previewToken,
      });
      if (!result.ok || !result.data) {
        onToast(result.error?.message ?? 'Failed to start export');
        return;
      }
      const jobResult = await getSyncJob(result.data.jobId);
      if (jobResult.ok && jobResult.data) {
        setActiveJob(jobResult.data);
        setActiveJobError(null);
      }
      setConfirmState({ kind: null });
    }
  }, [confirmState.kind, exportPreview, importPreview, onToast]);

  return {
    status,
    workspaces,
    importSourcePath,
    importWorkspaceName,
    exportWorkspaceName,
    exportDestinationPath,
    importPreview,
    exportPreview,
    activeJob,
    activeJobError,
    isLoadingStatus,
    isLoadingWorkspaces,
    isLoadingImportPreview,
    isLoadingExportPreview,
    confirmState,
    onChangeImportSourcePath: (value) => {
      setImportSourcePath(value);
      setImportPreview(null);
    },
    onChangeImportWorkspaceName: (value) => {
      setImportWorkspaceName(value);
      setImportPreview(null);
    },
    onChangeExportWorkspaceName: (value) => {
      setExportWorkspaceName(value);
      setExportPreview(null);
    },
    onChangeExportDestinationPath: (value) => {
      setExportDestinationPath(value);
      setExportPreview(null);
    },
    onReloadStatus: () => {
      void refreshStatus();
    },
    onReloadWorkspaces: () => {
      void refreshWorkspaces();
    },
    onPreviewImport: () => {
      void handlePreviewImport();
    },
    onPreviewExport: () => {
      void handlePreviewExport();
    },
    onRequestImport: () => {
      if (!importPreview) {
        onToast('Run import preview first.');
        return;
      }
      setConfirmState({ kind: 'import' });
    },
    onRequestExport: () => {
      if (!exportPreview) {
        onToast('Run export preview first.');
        return;
      }
      setConfirmState({ kind: 'export' });
    },
    onCloseConfirm: () => {
      setConfirmState({ kind: null });
    },
    onConfirmExecute: () => {
      void handleConfirmExecute();
    },
    isActionLocked,
  };
};
