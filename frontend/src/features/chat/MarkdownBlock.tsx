import {
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { Components, ExtraProps } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Button } from '../../components/ui/button';

interface MarkdownBlockProps {
  readonly text: string;
  readonly onOpenFile?: (path: string) => void;
}

interface CodeElementProps {
  readonly className?: string;
  readonly children?: ReactNode;
}

interface MarkdownAstNode {
  readonly type: string;
  value?: string;
  url?: string;
  children?: MarkdownAstNode[];
}

interface MarkdownParentNode extends MarkdownAstNode {
  children: MarkdownAstNode[];
}

type CopyState = 'idle' | 'copied' | 'failed';

const FILE_PATH_CANDIDATE_PATTERN =
  /(?:\/|\.\/|\.\.\/)[^\s<>()`'"]+\.[A-Za-z0-9][^\s<>()`'"]*(?:#L\d+(?:C\d+)?)?(?::\d+(?::\d+)?)?/g;

const trimPunctuationSuffix = (value: string): { readonly text: string; readonly suffix: string } => {
  const trimmed = value.replace(/[.,;!?]+$/, '');
  return {
    text: trimmed,
    suffix: value.slice(trimmed.length),
  };
};

const isParentNode = (node: MarkdownAstNode): node is MarkdownParentNode => {
  return Array.isArray(node.children);
};

const createTextNode = (value: string): MarkdownAstNode => {
  return {
    type: 'text',
    value,
  };
};

const createFileLinkNode = (path: string): MarkdownAstNode => {
  return {
    type: 'link',
    url: path,
    children: [createTextNode(path)],
  };
};

const toPlainText = (value: ReactNode): string => {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toPlainText(entry)).join('');
  }

  if (isValidElement<{ readonly children?: ReactNode }>(value)) {
    return toPlainText(value.props.children);
  }

  return '';
};

const getCodeElement = (value: ReactNode): ReactElement<CodeElementProps> | null => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = getCodeElement(entry);
      if (match) {
        return match;
      }
    }

    return null;
  }

  if (!isValidElement<CodeElementProps>(value) || value.type !== 'code') {
    return null;
  }

  return value;
};

const getCodeLanguage = (className: string | undefined): string | null => {
  if (!className) {
    return null;
  }

  const match = className.match(/(?:^|\s)language-([A-Za-z0-9_+-]+)(?:\s|$)/);
  return match?.[1] ?? null;
};

const isExternalHref = (href: string | undefined): boolean => {
  if (!href) {
    return false;
  }

  return /^https?:\/\//.test(href);
};

const buildFileLinkNodes = (text: string): MarkdownAstNode[] => {
  const nodes: MarkdownAstNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(FILE_PATH_CANDIDATE_PATTERN)) {
    const fullMatch = match[0];
    const start = match.index;

    if (start === undefined || fullMatch.length === 0) {
      continue;
    }

    if (start > cursor) {
      nodes.push(createTextNode(text.slice(cursor, start)));
    }

    const { text: filePath, suffix } = trimPunctuationSuffix(fullMatch);
    if (filePath) {
      nodes.push(createFileLinkNode(filePath));
    } else {
      nodes.push(createTextNode(fullMatch));
    }

    if (suffix) {
      nodes.push(createTextNode(suffix));
    }

    cursor = start + fullMatch.length;
  }

  if (cursor < text.length) {
    nodes.push(createTextNode(text.slice(cursor)));
  }

  return nodes.length > 0 ? nodes : [createTextNode(text)];
};

const replaceTextNodesWithFileLinks = (node: MarkdownAstNode): void => {
  if (!isParentNode(node)) {
    return;
  }

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];

    if (child.type === 'text' && typeof child.value === 'string' && child.value.length > 0) {
      const nextNodes = buildFileLinkNodes(child.value);
      const didChange = nextNodes.length !== 1 || nextNodes[0]?.value !== child.value;

      if (didChange) {
        node.children.splice(index, 1, ...nextNodes);
        index += nextNodes.length - 1;
        continue;
      }
    }

    if (child.type === 'link' || child.type === 'inlineCode' || child.type === 'code') {
      continue;
    }

    replaceTextNodesWithFileLinks(child);
  }
};

const remarkFilePathLinks = () => {
  return (tree: MarkdownAstNode) => {
    replaceTextNodesWithFileLinks(tree);
  };
};

interface MarkdownCodeBlockProps {
  readonly code: string;
  readonly language: string | null;
}

const MarkdownCodeBlock = ({ code, language }: MarkdownCodeBlockProps) => {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  useEffect(() => {
    if (copyState === 'idle') {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setCopyState('idle');
    }, 1800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copyState]);

  const handleCopy = async () => {
    if (!window.isSecureContext || !navigator.clipboard) {
      setCopyState('failed');
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const buttonLabel =
    copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy';
  const normalizedCode = code.replace(/\n$/, '');

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-white/10 bg-black/30">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/3 px-3 py-2">
        <span className="min-w-0 truncate text-[11px] font-medium uppercase tracking-[0.16em] text-white">
          {language ?? 'text'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-white hover:bg-white/10 hover:text-white"
          onClick={() => {
            void handleCopy();
          }}
          aria-label="Copy code block"
        >
          {buttonLabel}
        </Button>
      </div>
      <pre className="max-w-full overflow-x-auto px-5 py-3 text-[13px] leading-6 text-white">
        <code className="block whitespace-pre-wrap break-words [overflow-wrap:anywhere]" data-lang={language ?? undefined}>
          {normalizedCode}
        </code>
      </pre>
    </div>
  );
};

const MarkdownPre = ({ children }: ComponentPropsWithoutRef<'pre'> & ExtraProps) => {
  const codeElement = getCodeElement(children);

  if (!codeElement) {
    return <pre>{children}</pre>;
  }

  return (
    <MarkdownCodeBlock
      code={toPlainText(codeElement.props.children)}
      language={getCodeLanguage(codeElement.props.className)}
    />
  );
};

interface MarkdownLinkProps extends ComponentPropsWithoutRef<'a'>, ExtraProps {
  readonly onOpenFile?: (path: string) => void;
}

const MarkdownLink = ({ href, children, onOpenFile, ...props }: MarkdownLinkProps) => {
  const external = isExternalHref(href);
  const isFileLink = Boolean(onOpenFile) && !external && typeof href === 'string' && href.length > 0;

  return (
    <a
      {...props}
      href={href}
      className="font-medium text-[#d9d9d9] underline decoration-white/25 underline-offset-4 transition-colors hover:text-white"
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer noopener' : undefined}
      onClick={(event) => {
        if (!isFileLink || !href || !onOpenFile) {
          return;
        }

        event.preventDefault();
        onOpenFile(href);
      }}
    >
      {children}
    </a>
  );
};

const MarkdownTable = ({ children }: ComponentPropsWithoutRef<'table'> & ExtraProps) => {
  return (
    <div className="my-2 overflow-x-auto rounded-xl border border-white/10 bg-black/20">
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  );
};

const MarkdownImage = ({ alt, ...props }: ComponentPropsWithoutRef<'img'> & ExtraProps) => {
  return <img {...props} alt={alt ?? ''} className="my-2 max-w-full rounded-xl border border-white/10" loading="lazy" />;
};

/**
 * チャット本文向けの Markdown レンダラ。
 * GFM とファイルパスリンク化に対応し、横に崩れやすいコードブロックや表を安全に表示する。
 * @param props MarkdownBlock プロパティ
 * @returns 整形済み Markdown 表示
 */
export const MarkdownBlock = ({ text, onOpenFile }: MarkdownBlockProps) => {
  const components = useMemo<Components>(() => {
    return {
      a: (props) => <MarkdownLink {...props} onOpenFile={onOpenFile} />,
      img: MarkdownImage,
      pre: MarkdownPre,
      table: MarkdownTable,
    };
  }, [onOpenFile]);

  const remarkPlugins = useMemo(() => {
    return onOpenFile ? [remarkGfm, remarkFilePathLinks] : [remarkGfm];
  }, [onOpenFile]);

  return (
    <div className="min-w-0">
      <ReactMarkdown components={components} remarkPlugins={remarkPlugins} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
};
