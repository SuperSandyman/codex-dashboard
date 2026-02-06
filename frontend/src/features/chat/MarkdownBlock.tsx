import type { ReactNode } from 'react';

interface MarkdownBlockProps {
  readonly text: string;
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

const tokenizeInline = (text: string): InlineToken[] => {
  const tokens: InlineToken[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remain = text.slice(cursor);

    const linkMatch = remain.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    if (linkMatch) {
      tokens.push({
        type: 'link',
        label: linkMatch[1],
        href: linkMatch[2],
      });
      cursor += linkMatch[0].length;
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

const renderInline = (text: string, keyPrefix: string): ReactNode[] => {
  const lines = text.split('\n');
  const rendered: ReactNode[] = [];

  lines.forEach((line, lineIndex) => {
    const tokens = tokenizeInline(line);
    tokens.forEach((token, tokenIndex) => {
      const key = `${keyPrefix}-${lineIndex}-${tokenIndex}`;
      if (token.type === 'code') {
        rendered.push(
          <code key={key} className="md-inline-code">
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
        rendered.push(
          <a
            key={key}
            href={token.href}
            target="_blank"
            rel="noreferrer noopener"
            className="md-link"
          >
            {token.label}
          </a>,
        );
        return;
      }
      rendered.push(<span key={key}>{token.value}</span>);
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

/**
 * チャット本文向けの軽量 Markdown レンダラ。
 * - 見出し
 * - 箇条書き
 * - 引用
 * - コードフェンス / インラインコード
 * - 強調 / リンク
 * @param props MarkdownBlock プロパティ
 */
export const MarkdownBlock = ({ text }: MarkdownBlockProps) => {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const fence = parseFenceBlock(lines, index);
      blocks.push(
        <pre key={`code-${index}`} className="md-code-block">
          <code data-lang={fence.lang || undefined}>{fence.code}</code>
        </pre>,
      );
      index = fence.endIndex + 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const className = `md-heading md-h${level}`;
      blocks.push(
        <p key={`h-${index}`} className={className}>
          {renderInline(heading[2], `h-${index}`)}
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
        <blockquote key={`q-${index}`} className="md-quote">
          {renderInline(quoteLines.join('\n'), `q-${index}`)}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*+]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`} className="md-list">
          {items.map((item, itemIndex) => (
            <li key={`ul-item-${index}-${itemIndex}`}>{renderInline(item, `ul-${index}-${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`} className="md-list">
          {items.map((item, itemIndex) => (
            <li key={`ol-item-${index}-${itemIndex}`}>{renderInline(item, `ol-${index}-${itemIndex}`)}</li>
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
      !/^[-*+]\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push(
      <p key={`p-${index}`} className="md-paragraph">
        {renderInline(paragraphLines.join('\n'), `p-${index}`)}
      </p>,
    );
  }

  return <div className="markdown-block">{blocks}</div>;
};
