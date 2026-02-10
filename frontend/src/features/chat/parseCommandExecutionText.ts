export interface ParsedCommandExecutionText {
  readonly command: string;
  readonly output: string;
  readonly exitCode: number | null;
}

const trimEmptyEdges = (lines: readonly string[]): string[] => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim().length === 0) {
    start += 1;
  }
  while (end > start && lines[end - 1].trim().length === 0) {
    end -= 1;
  }
  return lines.slice(start, end);
};

/**
 * commandExecution メッセージ文字列を構造化データへ変換する。
 * 先頭の `$ command` 行、末尾 `exitCode: <number>` を抽出し、それ以外を出力本文として返す。
 * 期待フォーマットに一致しない場合は null を返す。
 * @param text 正規化前の message.text
 * @returns パース済みデータ、または null
 */
export const parseCommandExecutionText = (text: string): ParsedCommandExecutionText | null => {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const firstLine = lines[0]?.trimEnd() ?? '';
  if (!firstLine.startsWith('$ ')) {
    return null;
  }

  const command = firstLine.slice(2).trim();
  if (command.length === 0) {
    return null;
  }

  const bodyLines = lines.slice(1);
  const trimmedBody = trimEmptyEdges(bodyLines);
  const maybeExitCodeLine = trimmedBody[trimmedBody.length - 1] ?? '';
  const exitCodeMatch = maybeExitCodeLine.match(/^exitCode:\s*(-?\d+)\s*$/);
  const exitCode = exitCodeMatch ? Number.parseInt(exitCodeMatch[1], 10) : null;

  const outputLines = exitCodeMatch ? trimmedBody.slice(0, -1) : trimmedBody;
  const output = trimEmptyEdges(outputLines).join('\n');

  return {
    command,
    output,
    exitCode,
  };
};
