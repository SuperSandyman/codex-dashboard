import type { SyncPreviewFile, SyncPreviewSummary } from './types.js';

const shouldSkipLine = (line: string): boolean => {
  return (
    line.length === 0 ||
    line === 'sending incremental file list' ||
    line.startsWith('sent ') ||
    line.startsWith('total size is ') ||
    line.startsWith('created directory ')
  );
};

/**
 * `rsync --dry-run --itemize-changes` の出力を UI 向け preview へ変換する。
 * - `*deleting` は delete
 * - `+++++++` を含む itemize は add
 * - それ以外の itemize 行は update
 * @param output rsync の標準出力
 */
export const parseRsyncPreviewOutput = (
  output: string,
): { summary: SyncPreviewSummary; files: readonly SyncPreviewFile[] } => {
  const summary = { add: 0, update: 0, delete: 0 };
  const files: SyncPreviewFile[] = [];

  const lines = output.replace(/\r/g, '\n').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (shouldSkipLine(line)) {
      continue;
    }

    if (line.startsWith('*deleting ')) {
      const filePath = line.slice('*deleting '.length).trim();
      summary.delete += 1;
      files.push({
        path: filePath,
        changeType: 'delete',
        itemize: '*deleting',
      });
      continue;
    }

    const match = line.match(/^([^\s]{11})\s+(.+)$/);
    if (!match) {
      continue;
    }

    const [, itemize, filePath] = match;
    const changeType = itemize.includes('+++++++') ? 'add' : 'update';
    if (changeType === 'add') {
      summary.add += 1;
    } else {
      summary.update += 1;
    }
    files.push({
      path: filePath.trim(),
      changeType,
      itemize,
    });
  }

  return { summary, files };
};
