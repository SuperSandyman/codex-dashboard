import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '../../components/ui/button';

interface MarkdownBlockProps {
  readonly text: string;
  readonly onOpenFile?: (path: string) => void;
}

interface InlineTokenText {
  readonly type: 'text';
  readonly value: string;
}

interface InlineTokenCode {
  readonly type: 'code';
  readonly value: string;
}

interface InlineTokenStrong {
  readonly type: 'strong';
  readonly value: string;
}

interface InlineTokenLink {
  readonly type: 'link';
  readonly label: string;
  readonly href: string;
}

type InlineToken = InlineTokenText | InlineTokenCode | InlineTokenStrong | InlineTokenLink;

const FILE_PATH_CANDIDATE_PATTERN = /(?:\/|\.\/|\.\.\/)[^\s<>()`'"]+\.[A-Za-z0-9][^\s<>()`'"]*(?:#L\d+(?:C\d+)?)?(?::\d+(?::\d+)?)?/g;

const parseLinkToken = (
  text: string,
): { readonly token: InlineTokenLink; readonly length: number } | null => {
  if (!text.startsWith('[')) {
    return null;
  }

  let labelEnd = -1;
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === ']') {
      labelEnd = index;
      break;
    }
  }

  if (labelEnd < 0 || text[labelEnd + 1] !== '(') {
    return null;
  }

  let depth = 1;
  let hrefEnd = -1;
  for (let index = labelEnd + 2; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        hrefEnd = index;
        break;
      }
    }
  }

  if (hrefEnd < 0) {
    return null;
  }

  const label = text.slice(1, labelEnd);
  const destination = text.slice(labelEnd + 2, hrefEnd).trim();
  if (!destination) {
    return null;
  }

  const href = (() => {
    if (destination.startsWith('<')) {
      const closing = destination.indexOf('>');
      if (closing > 1) {
        return destination.slice(1, closing);
      }
    }
    return destination.split(/\s+/)[0] ?? destination;
  })();

  if (!href) {
    return null;
  }

  return {
    token: {
      type: 'link',
      label,
      href,
    },
    length: hrefEnd + 1,
  };
};

const trimPunctuationSuffix = (value: string): { readonly text: string; readonly suffix: string } => {
  const trimmed = value.replace(/[.,;!?]+$/, '');
  return {
    text: trimmed,
    suffix: value.slice(trimmed.length),
  };
};

const renderTextWithFileLinks = (
  text: string,
  keyPrefix: string,
  onOpenFile?: (path: string) => void,
): ReactNode[] => {
  if (!onOpenFile) {
    return [<span key={`${keyPrefix}-plain`}>{text}</span>];
  }

  const rendered: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = 0;

  for (const match of text.matchAll(FILE_PATH_CANDIDATE_PATTERN)) {
    const fullMatch = match[0];
    const start = match.index;
    if (start === undefined || fullMatch.length === 0) {
      continue;
    }

    if (start > cursor) {
      rendered.push(<span key={`${keyPrefix}-text-${matchIndex}`}>{text.slice(cursor, start)}</span>);
    }

    const { text: filePath, suffix } = trimPunctuationSuffix(fullMatch);
    if (!filePath) {
      rendered.push(<span key={`${keyPrefix}-path-${matchIndex}`}>{fullMatch}</span>);
      cursor = start + fullMatch.length;
      matchIndex += 1;
      continue;
    }

    rendered.push(
      <a
        key={`${keyPrefix}-path-${matchIndex}`}
        href={filePath}
        className="text-[#d9d9d9] underline"
        onClick={(event) => {
          event.preventDefault();
          onOpenFile(filePath);
        }}
      >
        {filePath}
      </a>,
    );
    if (suffix) {
      rendered.push(<span key={`${keyPrefix}-suffix-${matchIndex}`}>{suffix}</span>);
    }

    cursor = start + fullMatch.length;
    matchIndex += 1;
  }

  if (cursor < text.length) {
    rendered.push(<span key={`${keyPrefix}-tail`}>{text.slice(cursor)}</span>);
  }

  return rendered.length > 0 ? rendered : [<span key={`${keyPrefix}-plain`}>{text}</span>];
};

const tokenizeInline = (text: string): InlineToken[] => {
  const tokens: InlineToken[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remain = text.slice(cursor);

    const linkToken = parseLinkToken(remain);
    if (linkToken) {
      tokens.push(linkToken.token);
      cursor += linkToken.length;
      continue;
    }

    const codeMatch = remain.match(/^`([^`]+)`/);
    if (codeMatch) {
      tokens.push({
        type: 'code',
        value: codeMatch[1],
      });
      cursor += codeMatch[0].length;
      continue;
    }

    const strongMatch = remain.match(/^\*\*([^*]+)\*\*/);
    if (strongMatch) {
      tokens.push({
        type: 'strong',
        value: strongMatch[1],
      });
      cursor += strongMatch[0].length;
      continue;
    }

    const nextSpecial = remain.search(/(\[|`|\*\*)/);
    if (nextSpecial <= 0) {
      tokens.push({ type: 'text', value: remain });
      break;
    }
    tokens.push({ type: 'text', value: remain.slice(0, nextSpecial) });
    cursor += nextSpecial;
  }

  return tokens;
};

const renderInline = (
  text: string,
  keyPrefix: string,
  onOpenFile?: (path: string) => void,
): ReactNode[] => {
  const lines = text.split('\n');
  const rendered: ReactNode[] = [];

  lines.forEach((line, lineIndex) => {
    const tokens = tokenizeInline(line);
    tokens.forEach((token, tokenIndex) => {
      const key = `${keyPrefix}-${lineIndex}-${tokenIndex}`;
      if (token.type === 'code') {
        rendered.push(
          <code key={key} className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs text-[#e8e8e8]">
            {token.value}
          </code>,
        );
        return;
      }
      if (token.type === 'strong') {
        rendered.push(<strong key={key}>{token.value}</strong>);
        return;
      }
      if (token.type === 'link') {
        const isExternalLink = /^https?:\/\//.test(token.href);
        if (!isExternalLink && onOpenFile) {
          rendered.push(
            <a
              key={key}
              href={token.href}
              className="text-[#d9d9d9] underline"
              onClick={(event) => {
                event.preventDefault();
                onOpenFile(token.href);
              }}
            >
              {token.label}
            </a>,
          );
          return;
        }
        rendered.push(
          <a key={key} href={token.href} target="_blank" rel="noreferrer noopener" className="text-[#d9d9d9] underline">
            {token.label}
          </a>,
        );
        return;
      }
      rendered.push(...renderTextWithFileLinks(token.value, key, onOpenFile));
    });

    if (lineIndex < lines.length - 1) {
      rendered.push(<br key={`${keyPrefix}-br-${lineIndex}`} />);
    }
  });

  return rendered;
};

const parseFenceBlock = (
  lines: string[],
  startIndex: number,
): { readonly endIndex: number; readonly lang: string; readonly code: string } => {
  const startLine = lines[startIndex];
  const lang = startLine.replace(/^```/, '').trim();
  const body: string[] = [];
  let index = startIndex + 1;

  while (index < lines.length) {
    if (lines[index].startsWith('```')) {
      return {
        endIndex: index,
        lang,
        code: body.join('\n'),
      };
    }
    body.push(lines[index]);
    index += 1;
  }

  return {
    endIndex: lines.length - 1,
    lang,
    code: body.join('\n'),
  };
};

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * チャット本文向けの軽量 Markdown レンダラ。
 * - 見出し
 * - 箇条書き
 * - 引用
 * - コードフェンス / インラインコード
 * - 強調 / リンク
 * @param props MarkdownBlock プロパティ
 */
export const MarkdownBlock = ({ text, onOpenFile }: MarkdownBlockProps) => {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  const [copyStateByBlock, setCopyStateByBlock] = useState<Record<string, CopyState>>({});
  let index = 0;

  useEffect(() => {
    if (Object.keys(copyStateByBlock).length === 0) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setCopyStateByBlock({});
    }, 1800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copyStateByBlock]);

  const handleCopyFence = async (blockKey: string, code: string) => {
    if (!window.isSecureContext || !navigator.clipboard) {
      setCopyStateByBlock((prev) => ({ ...prev, [blockKey]: 'failed' }));
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopyStateByBlock((prev) => ({ ...prev, [blockKey]: 'copied' }));
    } catch {
      setCopyStateByBlock((prev) => ({ ...prev, [blockKey]: 'failed' }));
    }
  };

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const fence = parseFenceBlock(lines, index);
      const blockKey = `code-${index}`;
      const copyState = copyStateByBlock[blockKey] ?? 'idle';
      const buttonLabel = copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy';
      blocks.push(
        <div key={blockKey} className="rounded-lg border border-white/10 bg-black/25">
          <div className="flex items-center justify-between border-b border-white/10 px-2 py-1.5">
            <span className="text-[11px] text-[#b4b4b4]">{fence.lang || 'text'}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleCopyFence(blockKey, fence.code);
              }}
              aria-label="Copy code block"
            >
              {buttonLabel}
            </Button>
          </div>
          <pre className="max-h-72 overflow-auto p-2 text-xs text-[#e5e5e5]">
            <code data-lang={fence.lang || undefined}>{fence.code}</code>
          </pre>
        </div>,
      );
      index = fence.endIndex + 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const classNameByLevel: Record<number, string> = {
        1: 'text-xl font-semibold',
        2: 'text-lg font-semibold',
        3: 'text-base font-semibold',
        4: 'text-base font-semibold',
        5: 'text-base font-medium',
        6: 'text-base font-medium text-muted-foreground',
      };
      blocks.push(
        <p key={`h-${index}`} className={classNameByLevel[level] ?? 'text-base font-semibold'}>
          {renderInline(heading[2], `h-${index}`, onOpenFile)}
        </p>,
      );
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(
        <blockquote key={`q-${index}`} className="border-l-2 border-white/20 pl-3 text-base text-[#c5c5c5]">
          {renderInline(quoteLines.join('\n'), `q-${index}`, onOpenFile)}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`} className="ml-5 list-disc space-y-0.5 text-base marker:text-[#bdbdbd]">
          {items.map((item, itemIndex) => (
            <li key={`ul-item-${index}-${itemIndex}`}>{renderInline(item, `ul-${index}-${itemIndex}`, onOpenFile)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`} className="ml-5 list-decimal space-y-0.5 text-base marker:text-[#bdbdbd]">
          {items.map((item, itemIndex) => (
            <li key={`ol-item-${index}-${itemIndex}`}>{renderInline(item, `ol-${index}-${itemIndex}`, onOpenFile)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim().length > 0 &&
      !lines[index].startsWith('```') &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push(
      <p key={`p-${index}`} className="text-base leading-relaxed">
        {renderInline(paragraphLines.join('\n'), `p-${index}`, onOpenFile)}
      </p>,
    );
  }

  return <div className="grid gap-1">{blocks}</div>;
};
