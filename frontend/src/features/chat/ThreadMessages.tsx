import { forwardRef, type ComponentProps } from 'react';

import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  MessagePrimitive,
} from '@assistant-ui/react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

import { MarkdownBlock } from './MarkdownBlock';

interface IconButtonProps extends Omit<ComponentProps<'button'>, 'type'> {
  readonly tooltip: string;
}

interface ThreadMessageProps {
  readonly onOpenFile?: (path: string) => void;
}

interface MessageMarkdownProps {
  readonly text: string;
  readonly onOpenFile?: (path: string) => void;
  readonly className?: string;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, children, tooltip, ...props }, ref) => {
    return (
      <button
        type="button"
        ref={ref}
        title={tooltip}
        className={cn(
          'inline-flex size-6 items-center justify-center rounded-md p-1 text-white transition-colors hover:bg-white/10 hover:text-white',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
IconButton.displayName = 'IconButton';

const messageMarkdownClassName = [
  'prose prose-invert max-w-none text-[15px] leading-7',
  'prose-p:my-2 prose-p:text-white prose-headings:my-3 prose-headings:font-semibold prose-headings:text-white',
  'prose-strong:text-white prose-a:text-inherit prose-li:text-white',
  'prose-code:rounded-md prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.78rem] prose-code:text-white',
  'prose-code:before:content-none prose-code:after:content-none',
  'prose-pre:my-2 prose-pre:bg-transparent prose-pre:p-0',
  '[&_pre_code]:bg-transparent [&_pre_code]:px-0 [&_pre_code]:py-0 [&_pre_code]:text-inherit [&_pre_code]:rounded-none',
  'prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6',
  'prose-blockquote:my-3 prose-blockquote:rounded-r-lg prose-blockquote:border-l-white/25 prose-blockquote:bg-white/3 prose-blockquote:py-1 prose-blockquote:pl-4 prose-blockquote:text-white',
  'prose-hr:border-white/10 prose-img:my-2 prose-img:rounded-xl',
  'prose-table:my-2 prose-table:w-full prose-thead:border-white/10 prose-tbody:divide-y prose-tbody:divide-white/10',
  'prose-th:border-white/10 prose-th:bg-white/4 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-white',
  'prose-td:border-white/10 prose-td:px-3 prose-td:py-2 prose-td:align-top prose-td:text-white',
].join(' ');

const MessageMarkdown = ({ text, onOpenFile, className }: MessageMarkdownProps) => {
  return (
    <div className={cn(messageMarkdownClassName, className)}>
      <MarkdownBlock text={text} onOpenFile={onOpenFile} />
    </div>
  );
};

const AssistantReasoning = ({ text, onOpenFile }: { readonly text: string; readonly onOpenFile?: (path: string) => void }) => {
  return (
    <details className="mt-1 opacity-60">
      <summary className="cursor-pointer text-[11px] text-white">
        <strong>Reasoning</strong>
      </summary>
      <MessageMarkdown text={text} onOpenFile={onOpenFile} className="mt-1 text-white" />
    </details>
  );
};

const BranchPicker = ({ className }: { readonly className?: string }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn('inline-flex items-center gap-1 font-semibold text-white text-xs', className)}
    >
      <BranchPickerPrimitive.Previous asChild>
        <IconButton tooltip="Previous">
          <ChevronLeftIcon className="size-3.5" />
        </IconButton>
      </BranchPickerPrimitive.Previous>
      <BranchPickerPrimitive.Number />/<BranchPickerPrimitive.Count />
      <BranchPickerPrimitive.Next asChild>
        <IconButton tooltip="Next">
          <ChevronRightIcon className="size-3.5" />
        </IconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

/**
 * ユーザーメッセージ用の表示部品。
 * @param props ファイルリンク解決用ハンドラ
 */
export const UserMessage = ({ onOpenFile }: ThreadMessageProps) => {
  return (
    <MessagePrimitive.Root className="relative mx-auto flex w-full max-w-3xl flex-col items-end gap-1 px-0.5 sm:px-0">
      <div className="ml-auto flex w-fit max-w-[92%] flex-col items-end gap-1 sm:max-w-[85%]">
        <div className="min-w-0 rounded-3xl bg-white/5 px-4 py-2 text-left text-[#f5f5f5] sm:py-1.5">
          <MessagePrimitive.Parts
            components={{
              Text: (props) => <MessageMarkdown {...props} onOpenFile={onOpenFile} />,
            }}
          />
        </div>

        <ActionBarPrimitive.Root
          hideWhenRunning
          className="mt-0.5 self-end rounded-lg"
        >
          <ActionBarPrimitive.Edit asChild>
            <IconButton tooltip="Edit">
              <PencilIcon className="size-3.5" />
            </IconButton>
          </ActionBarPrimitive.Edit>
        </ActionBarPrimitive.Root>
      </div>

      <BranchPicker className="mr-1 mt-1" />
    </MessagePrimitive.Root>
  );
};

/**
 * assistant メッセージ用の表示部品。
 * @param props ファイルリンク解決用ハンドラ
 */
export const AssistantMessage = ({ onOpenFile }: ThreadMessageProps) => {
  return (
    <MessagePrimitive.Root className="relative mx-auto flex w-full max-w-3xl px-0.5 sm:px-0">
      <div className="pt-1">
        <div className="text-white">
          <MessagePrimitive.Parts
            components={{
              Text: (props) => <MessageMarkdown {...props} onOpenFile={onOpenFile} />,
              Reasoning: (props) => <AssistantReasoning {...props} onOpenFile={onOpenFile} />,
            }}
          />
        </div>

        <div className="flex pt-2">
          <BranchPicker />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

/**
 * system メッセージ用の表示部品。
 */
export const SystemMessage = () => {
  return (
    <MessagePrimitive.Root className="mx-auto w-full max-w-3xl px-0.5 sm:px-0">
      <div className="rounded-xl border border-white/10 bg-white/3 px-3 py-2 text-xs text-white">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
};
