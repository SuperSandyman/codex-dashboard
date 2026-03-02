import { forwardRef, type ComponentProps } from 'react';

import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

import type { ChatMessage } from '../../api/chats';
import { MarkdownBlock } from './MarkdownBlock';
import { parseCommandExecutionText } from './parseCommandExecutionText';

interface AssistantThreadProps {
  readonly messages: readonly ChatMessage[];
  readonly isRunning: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
}

interface IconButtonProps extends Omit<ComponentProps<'button'>, 'type'> {
  readonly tooltip: string;
}

const normalizeStatus = (value: string | null): string => {
  if (!value) {
    return '';
  }
  return value.replace(/[\s_-]/g, '').toLowerCase();
};

const toAssistantStatus = (
  status: string | null,
): ThreadMessageLike['status'] => {
  const normalized = normalizeStatus(status);
  if (normalized === 'running' || normalized === 'inprogress') {
    return { type: 'running' };
  }
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'interrupted') {
    return { type: 'incomplete', reason: 'cancelled' };
  }
  if (normalized === 'failed' || normalized === 'error') {
    return { type: 'incomplete', reason: 'error' };
  }
  return { type: 'complete', reason: 'stop' };
};

const toUserText = (message: AppendMessage): string | null => {
  if (message.role !== 'user') {
    return null;
  }

  const text = message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();

  return text.length > 0 ? text : null;
};

const toThreadMessage = (message: ChatMessage): ThreadMessageLike => {
  const mappedRole: ThreadMessageLike['role'] =
    message.role === 'assistant' || message.role === 'user' || message.role === 'system'
      ? message.role
      : 'assistant';

  if (message.kind === 'reasoning' && mappedRole === 'assistant') {
    return {
      id: message.id,
      role: 'assistant',
      content: [{ type: 'reasoning', text: message.text || ' ' }],
      status: toAssistantStatus(message.status),
    };
  }

  if (message.kind === 'commandExecution') {
    const parsed = parseCommandExecutionText(message.text);
    const rendered = parsed
      ? [
          '```bash',
          `$ ${parsed.command}`,
          '```',
          '',
          '```text',
          parsed.output || '(empty)',
          '```',
          parsed.exitCode !== null ? `exitCode: ${parsed.exitCode}` : null,
        ]
          .filter((line): line is string => line !== null)
          .join('\n')
      : message.text;

    return {
      id: message.id,
      role: mappedRole === 'user' ? 'assistant' : mappedRole,
      content: [{ type: 'text', text: rendered }],
      ...(mappedRole === 'assistant' ? { status: toAssistantStatus(message.status) } : {}),
    };
  }

  if (mappedRole === 'assistant') {
    return {
      id: message.id,
      role: 'assistant',
      content: [{ type: 'text', text: message.text || ' ' }],
      status: toAssistantStatus(message.status),
    };
  }

  if (mappedRole === 'user') {
    return {
      id: message.id,
      role: 'user',
      content: [{ type: 'text', text: message.text || ' ' }],
    };
  }

  return {
    id: message.id,
    role: 'system',
    content: [{ type: 'text', text: message.text || ' ' }],
  };
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, children, tooltip, ...props }, ref) => {
    return (
      <button
        type="button"
        ref={ref}
        title={tooltip}
        className={cn(
          'inline-flex size-6 items-center justify-center rounded-md p-1 text-[#b4b4b4] transition-colors hover:bg-white/10 hover:text-white',
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

const AssistantText = ({ text }: { readonly text: string }) => {
  return <MarkdownBlock text={text} />;
};

const AssistantReasoning = ({ text }: { readonly text: string }) => {
  return (
    <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-2.5">
      <summary className="cursor-pointer text-xs text-[#b4b4b4]">Reasoning</summary>
      <div className="mt-2 text-sm text-[#d3d3d3]">
        <MarkdownBlock text={text} />
      </div>
    </details>
  );
};

const BranchPicker = ({ className }: { readonly className?: string }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn('inline-flex items-center gap-1 font-semibold text-[#b4b4b4] text-xs', className)}
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

const UserMessage = () => {
  return (
    <MessagePrimitive.Root className="relative mx-auto flex w-full max-w-3xl flex-col items-end gap-1">
      <div className="ml-auto flex w-full max-w-[85%] items-start justify-end gap-2">
        <div className="rounded-3xl bg-white/5 px-5 py-2 text-[#eeeeee]">
          <MessagePrimitive.Parts />
        </div>

        <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" autohideFloat="single-branch" className="mt-1">
          <ActionBarPrimitive.Edit asChild>
            <IconButton tooltip="Edit">
              <PencilIcon className="size-3.5" />
            </IconButton>
          </ActionBarPrimitive.Edit>
        </ActionBarPrimitive.Root>
      </div>

      <BranchPicker className="mr-8 mt-1" />
    </MessagePrimitive.Root>
  );
};

const EditComposer = () => {
  return (
    <ComposerPrimitive.Root className="mx-auto flex w-full max-w-3xl flex-col justify-end gap-1 rounded-3xl bg-white/15">
      <ComposerPrimitive.Input className="flex min-h-14 w-full resize-none bg-transparent p-5 pb-0 text-white outline-none" />

      <div className="m-3 mt-2 flex items-center justify-center gap-2 self-end">
        <ComposerPrimitive.Cancel className="rounded-full bg-zinc-900 px-3 py-2 font-semibold text-sm text-white hover:bg-zinc-800">
          Cancel
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send className="rounded-full bg-white px-3 py-2 font-semibold text-black text-sm hover:bg-white/90">
          Send
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
};

const AssistantMessage = () => {
  return (
    <MessagePrimitive.Root className="relative mx-auto flex w-full max-w-3xl gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-3xl border border-white/15 text-xs text-white shadow">
        C
      </div>

      <div className="pt-1">
        <div className="text-[#eeeeee]">
          <MessagePrimitive.Parts
            components={{
              Text: AssistantText,
              Reasoning: AssistantReasoning,
            }}
          />
        </div>

        <div className="flex pt-2">
          <BranchPicker />

          <ActionBarPrimitive.Root
            hideWhenRunning
            autohide="not-last"
            autohideFloat="single-branch"
            className="flex items-center gap-1 rounded-lg data-floating:absolute data-floating:border data-floating:border-white/15 data-floating:bg-[#212121] data-floating:p-1"
          >
            <ActionBarPrimitive.Reload asChild>
              <IconButton tooltip="Reload">
                <RefreshCwIcon className="size-3.5" />
              </IconButton>
            </ActionBarPrimitive.Reload>
            <ActionBarPrimitive.Copy asChild>
              <IconButton tooltip="Copy">
                <AuiIf condition={(state) => state.message.isCopied}>
                  <CheckIcon className="size-3.5" />
                </AuiIf>
                <AuiIf condition={(state) => !state.message.isCopied}>
                  <CopyIcon className="size-3.5" />
                </AuiIf>
              </IconButton>
            </ActionBarPrimitive.Copy>
          </ActionBarPrimitive.Root>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const SystemMessage = () => {
  return (
    <MessagePrimitive.Root className="mx-auto w-full max-w-3xl">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-[#b4b4b4]">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
};

const Composer = () => {
  return (
    <ComposerPrimitive.Root className="mx-auto flex w-full max-w-3xl items-end rounded-3xl bg-white/5 pl-2">
      <ComposerPrimitive.Input
        placeholder="Message ChatGPT"
        className="h-12 max-h-40 grow resize-none bg-transparent p-3.5 text-sm text-white outline-none placeholder:text-white/50"
      />
      <AuiIf condition={(state) => !state.thread.isRunning}>
        <ComposerPrimitive.Send className="m-2 flex size-8 items-center justify-center rounded-full bg-white transition-opacity disabled:opacity-10">
          <ArrowUpIcon className="size-4 text-black" />
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(state) => state.thread.isRunning}>
        <ComposerPrimitive.Cancel className="m-2 flex size-8 items-center justify-center rounded-full bg-white">
          <SquareIcon className="size-2.5 fill-black text-black" />
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </ComposerPrimitive.Root>
  );
};

/**
 * assistant-ui の ChatGPT サンプル構成を基にしたチャットスレッド表示。
 * 既存送信/停止ロジックへ委譲し、バックエンドとの連携挙動は維持する。
 * @param props 既存チャット状態と送信ハンドラ
 */
export const AssistantThread = ({ messages, isRunning, onSend, onStop }: AssistantThreadProps) => {
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    convertMessage: (message) => toThreadMessage(message),
    onNew: async (message) => {
      const text = toUserText(message);
      if (!text) {
        return;
      }
      onSend(text);
    },
    onCancel: async () => {
      onStop();
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="dark relative flex h-full min-h-0 flex-col items-stretch bg-[#212121] px-4 text-[#ececec]">
        <ThreadPrimitive.Viewport className="flex min-h-0 grow flex-col gap-8 overflow-y-auto pb-6 pt-8 md:pt-16">
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <div className="flex grow flex-col items-center justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-3xl border border-white/15 shadow">C</div>
              <p className="mt-4 text-xl text-white">How can I help you today?</p>
            </div>
          </AuiIf>

          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              EditComposer,
              AssistantMessage,
              SystemMessage,
            }}
          />
        </ThreadPrimitive.Viewport>

        <ThreadPrimitive.ScrollToBottom asChild>
          <button
            type="button"
            title="Scroll to bottom"
            className="absolute right-8 bottom-28 inline-flex size-8 items-center justify-center rounded-full border border-white/10 bg-[#2b2b2b] text-[#d3d3d3] transition-colors hover:bg-[#353535]"
          >
            <ChevronRightIcon className="size-4 rotate-90" />
          </button>
        </ThreadPrimitive.ScrollToBottom>

        <Composer />
        <p className="p-2 text-center text-[#cdcdcd] text-xs">ChatGPT can make mistakes. Check important info.</p>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
};
