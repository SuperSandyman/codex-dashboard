import { AlertTriangleIcon, ArrowLeftRightIcon, RefreshCwIcon } from 'lucide-react';

import type {
  SyncJobErrorDetails,
  SyncJobSnapshot,
  SyncPreviewResult,
  SyncStatus,
  SyncWorkspaceSummary,
} from '../../api/sync';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { Textarea } from '../../components/ui/textarea';

interface SyncPaneProps {
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
  readonly confirmKind: 'import' | 'export' | null;
  readonly isActionLocked: boolean;
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
}

const getStatusVariant = (status: SyncStatus | null): 'outline' | 'success' | 'destructive' => {
  if (!status?.configured) {
    return 'outline';
  }
  return status.sshReachable ? 'success' : 'destructive';
};

const formatBytes = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) {
    return 'Unknown';
  }
  return new Intl.NumberFormat('en-US').format(value);
};

const renderPreview = (preview: SyncPreviewResult | null) => {
  if (!preview) {
    return (
      <div className="rounded-lg border border-dashed border-white/15 bg-black/15 p-4 text-sm text-[#9f9f9f]">
        Preview を実行すると、追加・更新・削除の件数と変更対象が表示されます。
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-[#ececec]">
        <div>Source: {preview.sourcePath}</div>
        <div>Destination: {preview.destinationPath}</div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Add {preview.summary.add}</Badge>
          <Badge variant="outline">Update {preview.summary.update}</Badge>
          <Badge variant="outline">Delete {preview.summary.delete}</Badge>
        </div>
      </div>
      <details className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-[#ececec]">
        <summary className="cursor-pointer select-none">変更対象ファイル ({preview.files.length})</summary>
        <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-white/10 bg-black/30">
          {preview.files.length === 0 ? (
            <div className="px-3 py-2 text-[#9f9f9f]">変更はありません。</div>
          ) : null}
          {preview.files.map((file) => (
            <div key={`${file.changeType}:${file.path}`} className="grid grid-cols-[auto_1fr] gap-3 border-t border-white/5 px-3 py-2 first:border-t-0">
              <Badge variant={file.changeType === 'delete' ? 'destructive' : 'outline'}>{file.changeType}</Badge>
              <div className="min-w-0 truncate font-mono text-xs">{file.path}</div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
};

const renderProgress = (activeJob: SyncJobSnapshot | null) => {
  if (!activeJob) {
    return null;
  }

  const widthClassName =
    activeJob.progress === null ? 'w-1/3 animate-pulse' : '';

  return (
    <Card className="border-white/10 bg-[#171717]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sync Job</CardTitle>
        <CardDescription>{activeJob.message}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-1 text-sm text-[#d0d0d0]">
          <div>Workspace: {activeJob.workspaceName}</div>
          <div>Status: {activeJob.status}</div>
          <div>Transferred: {formatBytes(activeJob.bytesTransferred)} bytes</div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          {activeJob.progress === null ? (
            <div className={`h-full rounded-full bg-[#7dd3fc] ${widthClassName}`} />
          ) : (
            <div className="h-full rounded-full bg-[#7dd3fc]" style={{ width: `${Math.min(100, activeJob.progress)}%` }} />
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const renderError = (activeJobError: SyncJobErrorDetails | null) => {
  if (!activeJobError) {
    return null;
  }

  return (
    <Card className="border-red-300/30 bg-red-950/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-red-200">
          <AlertTriangleIcon className="size-4" />
          Sync Error
        </CardTitle>
        <CardDescription className="text-red-100/80">{activeJobError.error}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="text-sm text-red-100/80">Exit code: {activeJobError.exitCode ?? 'unknown'}</div>
        <Textarea
          readOnly
          value={activeJobError.stderr}
          className="min-h-32 border-red-200/20 bg-black/30 font-mono text-xs text-red-50"
        />
      </CardContent>
    </Card>
  );
};

/**
 * Import / Export の preview・実行・進捗表示をまとめた Sync 画面。
 * @param props 表示状態と操作ハンドラ
 */
export const SyncPane = ({
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
  confirmKind,
  isActionLocked,
  onChangeImportSourcePath,
  onChangeImportWorkspaceName,
  onChangeExportWorkspaceName,
  onChangeExportDestinationPath,
  onReloadStatus,
  onReloadWorkspaces,
  onPreviewImport,
  onPreviewExport,
  onRequestImport,
  onRequestExport,
  onCloseConfirm,
  onConfirmExecute,
}: SyncPaneProps) => {
  const isConfigured = status?.configured ?? false;
  const isReachable = status?.sshReachable ?? false;

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4">
      <div className="mx-auto grid max-w-6xl gap-4">
        <Card className="border-white/10 bg-[#171717]">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowLeftRightIcon className="size-4" />
                  Sync
                </CardTitle>
                <CardDescription>メイン機とサーバー間で workspace をミラー同期します。</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getStatusVariant(status)}>{status?.statusLabel ?? 'Loading'}</Badge>
                <Button type="button" variant="outline" size="sm" onClick={onReloadStatus} disabled={isLoadingStatus}>
                  <RefreshCwIcon className={`size-3.5 ${isLoadingStatus ? 'animate-spin' : ''}`} />
                  Refresh status
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={onReloadWorkspaces} disabled={isLoadingWorkspaces}>
                  <RefreshCwIcon className={`size-3.5 ${isLoadingWorkspaces ? 'animate-spin' : ''}`} />
                  Refresh workspaces
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1 text-sm text-[#d0d0d0]">
              <div>Host: {status?.host ?? 'Not configured'}</div>
              <div>Workspace root: {status?.workspaceRoot ?? 'Not configured'}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {status?.allowedRoots.map((rootPath) => (
                <Badge key={rootPath} variant="outline">{rootPath}</Badge>
              ))}
              {status && status.allowedRoots.length === 0 ? <Badge variant="outline">No allowed roots</Badge> : null}
            </div>
          </CardContent>
        </Card>

        {renderProgress(activeJob)}
        {renderError(activeJobError)}

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="border-white/10 bg-[#171717]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Import</CardTitle>
              <CardDescription>メイン機の最新状態をサーバー側 workspace へ取り込みます。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <label className="grid gap-1 text-sm text-[#d0d0d0]">
                <span>Main PC path</span>
                <Input
                  value={importSourcePath}
                  onChange={(event) => onChangeImportSourcePath(event.target.value)}
                  disabled={!isConfigured || isActionLocked}
                  placeholder="/home/sandyman/projects/codex-dashboard"
                />
              </label>
              <label className="grid gap-1 text-sm text-[#d0d0d0]">
                <span>Workspace name</span>
                <Input
                  value={importWorkspaceName}
                  onChange={(event) => onChangeImportWorkspaceName(event.target.value)}
                  disabled={!isConfigured || isActionLocked}
                  placeholder="codex-dashboard"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={onPreviewImport} disabled={!isReachable || isActionLocked || isLoadingImportPreview}>
                  {isLoadingImportPreview ? 'Previewing...' : 'Run Preview'}
                </Button>
                <Button type="button" onClick={onRequestImport} disabled={!importPreview || isActionLocked}>
                  Start Import
                </Button>
              </div>
              {renderPreview(importPreview)}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-[#171717]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Export</CardTitle>
              <CardDescription>サーバー側 workspace をメイン機の出力先へ戻します。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <label className="grid gap-1 text-sm text-[#d0d0d0]">
                <span>Workspace</span>
                <Select
                  value={exportWorkspaceName}
                  onChange={(event) => onChangeExportWorkspaceName(event.target.value)}
                  disabled={!isConfigured || isActionLocked || workspaces.length === 0}
                >
                  <option value="">{isLoadingWorkspaces ? 'Loading workspaces...' : 'Select workspace'}</option>
                  {workspaces.map((workspace) => (
                    <option key={workspace.name} value={workspace.name}>
                      {workspace.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1 text-sm text-[#d0d0d0]">
                <span>Main PC destination path</span>
                <Input
                  value={exportDestinationPath}
                  onChange={(event) => onChangeExportDestinationPath(event.target.value)}
                  disabled={!isConfigured || isActionLocked}
                  placeholder="/home/sandyman/projects/codex-dashboard"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={onPreviewExport} disabled={!isReachable || isActionLocked || isLoadingExportPreview}>
                  {isLoadingExportPreview ? 'Previewing...' : 'Run Preview'}
                </Button>
                <Button type="button" variant="destructive" onClick={onRequestExport} disabled={!exportPreview || isActionLocked}>
                  Start Export
                </Button>
              </div>
              {renderPreview(exportPreview)}
            </CardContent>
          </Card>
        </div>
      </div>

      {confirmKind ? (
        <section
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/55 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur-sm sm:px-4 sm:pt-8"
          onClick={onCloseConfirm}
        >
          <Card
            className="w-full max-w-xl border-white/10 bg-[#171717]"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{confirmKind === 'import' ? 'Confirm Import' : 'Confirm Export'}</CardTitle>
              <CardDescription>
                {confirmKind === 'import'
                  ? 'サーバー側 workspace は sourcePath の内容に完全一致するよう上書きされます。'
                  : 'メイン機側の destinationPath は server workspace の内容で上書きされ、不要ファイルは削除されます。'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Separator />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onCloseConfirm}>
                  Cancel
                </Button>
                <Button type="button" variant={confirmKind === 'export' ? 'destructive' : 'default'} onClick={onConfirmExecute}>
                  {confirmKind === 'import' ? 'Run Import' : 'Run Export'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
};
