import { useEffect, useMemo, useState } from 'react';

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

const resolveStatusTone = (status: string | null, exitCode: number | null): 'running' | 'success' | 'failure' | 'idle' => {
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

/**
 * commandExecution メッセージを「コマンド」「ステータス」「出力」に分けて描画する。
 * 長い本文は初期折りたたみとし、実行中は自動展開して追従しやすくする。
 * @param props 表示対象のコマンド実行結果
 */
export const CommandExecutionBlock = ({ command, output, exitCode, status }: CommandExecutionBlockProps) => {
  const isRunning = isInProgressStatus(status);
  const [isExpanded, setIsExpanded] = useState(isRunning);
  const statusLabel = resolveStatusLabel(status, exitCode);
  const statusTone = resolveStatusTone(status, exitCode);
  const outputLineCount = useMemo(() => {
    if (!output) {
      return 0;
    }
    return output.split('\n').length;
  }, [output]);

  useEffect(() => {
    if (isRunning) {
      setIsExpanded(true);
    }
  }, [isRunning, output]);

  return (
    <div className="command-exec-block">
      <div className="command-exec-meta">
        <div className="command-exec-label">Command</div>
        <code className="command-exec-command">{command}</code>
      </div>

      <div className="command-exec-status-row">
        <span className={`command-exec-status tone-${statusTone}`}>Status: {statusLabel}</span>
        {exitCode !== null ? <span className="command-exec-exit">exitCode: {exitCode}</span> : null}
      </div>

      <div className="command-exec-output">
        <div className="command-exec-output-header">
          <span className="command-exec-label">Output</span>
          <button
            type="button"
            className="button button-secondary command-exec-toggle"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-label={isExpanded ? 'Collapse command output' : 'Expand command output'}
          >
            {isExpanded ? 'Hide output' : 'Show output'}
          </button>
        </div>

        {!isExpanded ? (
          <p className="command-exec-preview">
            {toOutputPreview(output)}{outputLineCount > 1 ? ` (${outputLineCount} lines)` : ''}
          </p>
        ) : (
          <pre className="command-exec-output-body">
            <code>{output || '(empty)'}</code>
          </pre>
        )}
      </div>
    </div>
  );
};
