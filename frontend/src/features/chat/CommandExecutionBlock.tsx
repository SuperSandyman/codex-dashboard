import { useMemo, useState } from 'react';

import { Button } from '../../components/ui/button';

interface CommandExecutionBlockProps {
  readonly command: string;
  readonly output: string;
  readonly exitCode: number | null;
  readonly status: string | null;
}

const normalizeStatus = (value: string | null): string => {
  if (!value) {
    return '';
  }
  return value.replace(/[\s_-]/g, '').toLowerCase();
};

const isInProgressStatus = (value: string | null): boolean => {
  const normalized = normalizeStatus(value);
  return normalized === 'inprogress' || normalized === 'running';
};

const resolveStatusLabel = (status: string | null, exitCode: number | null): string => {
  if (isInProgressStatus(status)) {
    return 'Running';
  }
  if (exitCode !== null) {
    return exitCode === 0 ? 'Succeeded' : 'Failed';
  }
  return status ?? 'Unknown';
};

const resolveStatusTone = (
  status: string | null,
  exitCode: number | null,
): 'running' | 'success' | 'failure' | 'idle' => {
  if (isInProgressStatus(status)) {
    return 'running';
  }
  if (exitCode !== null) {
    return exitCode === 0 ? 'success' : 'failure';
  }
  return 'idle';
};

const toOutputPreview = (output: string): string => {
  const firstLine = output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return 'No output';
  }
  if (firstLine.length <= 120) {
    return firstLine;
  }
  return `${firstLine.slice(0, 120)}...`;
};

const toneClassByStatus: Record<ReturnType<typeof resolveStatusTone>, string> = {
  running: 'text-amber-300',
  success: 'text-emerald-300',
  failure: 'text-red-300',
  idle: 'text-muted-foreground',
};

/**
 * commandExecution メッセージを「コマンド」「ステータス」「出力」に分けて描画する。
 * 長い本文は初期折りたたみとし、実行中は自動展開して追従しやすくする。
 * @param props 表示対象のコマンド実行結果
 */
export const CommandExecutionBlock = ({ command, output, exitCode, status }: CommandExecutionBlockProps) => {
  const isRunning = isInProgressStatus(status);
  const [isExpandedManual, setIsExpandedManual] = useState(false);
  const isExpanded = isRunning || isExpandedManual;
  const statusLabel = resolveStatusLabel(status, exitCode);
  const statusTone = resolveStatusTone(status, exitCode);
  const outputLineCount = useMemo(() => {
    if (!output) {
      return 0;
    }
    return output.split('\n').length;
  }, [output]);

  return (
    <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
      <div className="grid gap-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Command</div>
        <code className="overflow-auto rounded-md border border-border/60 bg-background/60 px-3.5 py-2 text-xs">{command}</code>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className={toneClassByStatus[statusTone]}>Status: {statusLabel}</span>
        {exitCode !== null ? <span className="text-muted-foreground">exitCode: {exitCode}</span> : null}
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Output</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsExpandedManual((prev) => !prev)}
            aria-label={isExpanded ? 'Collapse command output' : 'Expand command output'}
            disabled={isRunning}
          >
            {isRunning ? 'Streaming...' : isExpanded ? 'Hide output' : 'Show output'}
          </Button>
        </div>

        {!isExpanded ? (
          <p className="rounded-md border border-border/60 bg-background/60 px-3.5 py-2 text-xs text-muted-foreground">
            {toOutputPreview(output)}
            {outputLineCount > 1 ? ` (${outputLineCount} lines)` : ''}
          </p>
        ) : (
          <div className="rounded-md border border-border/60 bg-background/80 px-3.5 py-3">
            <pre className="m-0 max-h-72 overflow-auto text-xs">
              <code>{output || '(empty)'}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
