import { forwardRef, useEffect, useRef, useState, type ComponentProps } from 'react';

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
  EllipsisIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

import type {
  ChatApprovalPolicy,
  ChatLaunchOptions,
  ChatMessage,
  ChatModelOption,
  ChatSandboxMode,
} from '../../api/chats';
import { Select } from '../../components/ui/select';
import { MarkdownBlock } from './MarkdownBlock';
import { parseCommandExecutionText } from './parseCommandExecutionText';

interface AssistantThreadProps {
  readonly messages: readonly ChatMessage[];
  readonly isRunning: boolean;
  readonly launchOptions: ChatLaunchOptions | null;
  readonly modelOptions: readonly ChatModelOption[];
  readonly approvalPolicyOptions: readonly ChatApprovalPolicy[];
  readonly sandboxModeOptions: readonly ChatSandboxMode[];
  readonly isUpdatingLaunchOptions: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
  readonly onUpdateLaunchOptions: (nextLaunchOptions: ChatLaunchOptions) => void;
  readonly onOpenFile?: (path: string) => void;
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

const resolveDefaultEffort = (model: ChatModelOption): string | null => {
  if (model.defaultEffort && model.efforts.includes(model.defaultEffort)) {
    return model.defaultEffort;
  }
  return model.efforts[0] ?? null;
};

const formatApprovalPolicyLabel = (value: ChatApprovalPolicy): string => {
  switch (value) {
    case 'untrusted':
      return 'Untrusted';
    case 'on-failure':
      return 'On Failure';
    case 'on-request':
      return 'On Request';
    case 'never':
      return 'Never';
    default:
      return value;
  }
};

const formatSandboxModeLabel = (value: ChatSandboxMode): string => {
  switch (value) {
    case 'read-only':
      return 'Read Only';
    case 'workspace-write':
      return 'Workspace Write';
    case 'danger-full-access':
      return 'Danger Full Access';
    default:
      return value;
  }
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
  'prose-blockquote:my-3 prose-blockquote:rounded-r-lg prose-blockquote:border-l-white/25 prose-blockquote:bg-white/[0.03] prose-blockquote:py-1 prose-blockquote:pl-4 prose-blockquote:text-white',
  'prose-hr:border-white/10 prose-img:my-2 prose-img:rounded-xl',
  'prose-table:my-2 prose-table:w-full prose-thead:border-white/10 prose-tbody:divide-y prose-tbody:divide-white/10',
  'prose-th:border-white/10 prose-th:bg-white/[0.04] prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-white',
  'prose-td:border-white/10 prose-td:px-3 prose-td:py-2 prose-td:align-top prose-td:text-white',
].join(' ');

const UserText = ({ text, onOpenFile }: { readonly text: string; readonly onOpenFile?: (path: string) => void }) => {
  return (
    <div className={messageMarkdownClassName}>
      <MarkdownBlock text={text} onOpenFile={onOpenFile} />
    </div>
  );
};

const AssistantText = ({ text, onOpenFile }: { readonly text: string; readonly onOpenFile?: (path: string) => void }) => {
  return (
    <div className={messageMarkdownClassName}>
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
      <div className={cn('mt-1 text-white', messageMarkdownClassName)}>
        <MarkdownBlock text={text} onOpenFile={onOpenFile} />
      </div>
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

const UserMessage = ({ onOpenFile }: { readonly onOpenFile?: (path: string) => void }) => {
  return (
    <MessagePrimitive.Root className="relative mx-auto flex w-full max-w-3xl flex-col items-end gap-1">
      <div className="ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1">
        <div className="min-w-0 rounded-3xl bg-white/5 px-4 py-1.5 text-left text-[#f5f5f5]">
          <MessagePrimitive.Parts
            components={{
              Text: (props) => <UserText {...props} onOpenFile={onOpenFile} />,
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

const AssistantMessage = ({ onOpenFile }: { readonly onOpenFile?: (path: string) => void }) => {
  return (
    <MessagePrimitive.Root className="relative mx-auto flex w-full max-w-3xl">
      <div className="pt-1">
        <div className="text-white">
          <MessagePrimitive.Parts
            components={{
              Text: (props) => <AssistantText {...props} onOpenFile={onOpenFile} />,
              Reasoning: (props) => <AssistantReasoning {...props} onOpenFile={onOpenFile} />,
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
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
};

interface ComposerProps {
  readonly launchOptions: ChatLaunchOptions | null;
  readonly modelOptions: readonly ChatModelOption[];
  readonly approvalPolicyOptions: readonly ChatApprovalPolicy[];
  readonly sandboxModeOptions: readonly ChatSandboxMode[];
  readonly isUpdatingLaunchOptions: boolean;
  readonly onUpdateLaunchOptions: (nextLaunchOptions: ChatLaunchOptions) => void;
}

const Composer = ({
  launchOptions,
  modelOptions,
  approvalPolicyOptions,
  sandboxModeOptions,
  isUpdatingLaunchOptions,
  onUpdateLaunchOptions,
}: ComposerProps) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const canEditLaunchOptions = Boolean(launchOptions) && !isUpdatingLaunchOptions;
  const selectedModelValue = launchOptions?.model ?? modelOptions[0]?.id ?? '';
  const selectedModelOption = modelOptions.find((model) => model.id === selectedModelValue) ?? null;
  const effortOptions = selectedModelOption?.efforts ?? [];
  const selectedEffort = launchOptions?.effort ?? '';
  const selectedApprovalPolicy = launchOptions?.approvalPolicy ?? '';
  const selectedSandboxMode = launchOptions?.sandboxMode ?? '';

  useEffect(() => {
    if (!isSettingsOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const panel = settingsPanelRef.current;
      if (!panel) {
        return;
      }
      if (event.target instanceof Node && !panel.contains(event.target)) {
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isSettingsOpen]);

  const handleModelChange = (rawModel: string) => {
    if (!launchOptions) {
      return;
    }
    const nextModel = rawModel.length > 0 ? rawModel : null;
    const model = modelOptions.find((entry) => entry.id === nextModel) ?? null;
    if (!nextModel || !model) {
      return;
    }

    const nextEffort =
      launchOptions.effort && model.efforts.includes(launchOptions.effort)
        ? launchOptions.effort
        : resolveDefaultEffort(model);
    onUpdateLaunchOptions({
      ...launchOptions,
      model: nextModel,
      effort: nextEffort,
    });
  };

  const handleEffortChange = (rawEffort: string) => {
    if (!launchOptions) {
      return;
    }
    const nextEffort = rawEffort.length > 0 ? rawEffort : null;
    onUpdateLaunchOptions({
      ...launchOptions,
      model: selectedModelValue || null,
      effort: nextEffort,
    });
  };

  const handleApprovalPolicyChange = (rawPolicy: string) => {
    if (!launchOptions) {
      return;
    }
    const nextPolicy = rawPolicy.length > 0 ? (rawPolicy as ChatApprovalPolicy) : null;
    onUpdateLaunchOptions({
      ...launchOptions,
      approvalPolicy: nextPolicy,
    });
  };

  const handleSandboxModeChange = (rawMode: string) => {
    if (!launchOptions) {
      return;
    }
    const nextMode = rawMode.length > 0 ? (rawMode as ChatSandboxMode) : null;
    if (nextMode === 'danger-full-access') {
      const accepted = window.confirm('Danger Full Access disables filesystem sandboxing. Continue?');
      if (!accepted) {
        return;
      }
    }
    onUpdateLaunchOptions({
      ...launchOptions,
      sandboxMode: nextMode,
    });
  };

  return (
    <ComposerPrimitive.Root className="mx-auto flex w-full max-w-3xl items-end gap-1 rounded-3xl bg-white/5 pl-2 pr-1">
      <div className="relative mb-2" ref={settingsPanelRef}>
        <button
          type="button"
          title="Chat settings"
          disabled={!launchOptions}
          className="inline-flex size-8 items-center justify-center rounded-full bg-white/[0.08] text-[#d8d8d8] transition-colors hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => {
            setIsSettingsOpen((prev) => !prev);
          }}
        >
          <EllipsisIcon className="size-4" />
        </button>

        {isSettingsOpen ? (
          <div className="absolute bottom-10 left-0 z-30 w-[18rem] rounded-xl border border-white/10 bg-[#1b1b1b] p-3 shadow-2xl shadow-black/45">
            <div className="grid gap-2.5 text-sm">
              <label className="grid gap-1">
                <span className="text-[11px] text-[#999999]">Model</span>
                <Select
                  value={selectedModelValue}
                  disabled={!canEditLaunchOptions || modelOptions.length === 0}
                  className="h-8 border-white/12 bg-[#252525] text-xs"
                  onChange={(event) => {
                    handleModelChange(event.target.value);
                  }}
                >
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] text-[#999999]">Effort</span>
                <Select
                  value={selectedEffort}
                  disabled={!canEditLaunchOptions || !selectedModelOption}
                  className="h-8 border-white/12 bg-[#252525] text-xs"
                  onChange={(event) => {
                    handleEffortChange(event.target.value);
                  }}
                >
                  <option value="">Model default</option>
                  {effortOptions.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] text-[#999999]">Approval</span>
                <Select
                  value={selectedApprovalPolicy}
                  disabled={!canEditLaunchOptions || approvalPolicyOptions.length === 0}
                  className="h-8 border-white/12 bg-[#252525] text-xs"
                  onChange={(event) => {
                    handleApprovalPolicyChange(event.target.value);
                  }}
                >
                  <option value="">Default</option>
                  {approvalPolicyOptions.map((policy) => (
                    <option key={policy} value={policy}>
                      {formatApprovalPolicyLabel(policy)}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] text-[#999999]">Sandbox</span>
                <Select
                  value={selectedSandboxMode}
                  disabled={!canEditLaunchOptions || sandboxModeOptions.length === 0}
                  className="h-8 border-white/12 bg-[#252525] text-xs"
                  onChange={(event) => {
                    handleSandboxModeChange(event.target.value);
                  }}
                >
                  <option value="">Default</option>
                  {sandboxModeOptions.map((mode) => (
                    <option key={mode} value={mode}>
                      {formatSandboxModeLabel(mode)}
                    </option>
                  ))}
                </Select>
              </label>

              <div className="rounded-md border border-white/10 bg-[#222222] px-2 py-1.5">
                <div className="text-[10px] text-[#9a9a9a]">CWD</div>
                <div className="truncate text-xs text-[#d5d5d5]" title={launchOptions?.cwd ?? 'Workspace default'}>
                  {launchOptions?.cwd ?? 'Workspace default'}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <ComposerPrimitive.Input
        placeholder="Message Codex"
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
export const AssistantThread = ({
  messages,
  isRunning,
  launchOptions,
  modelOptions,
  approvalPolicyOptions,
  sandboxModeOptions,
  isUpdatingLaunchOptions,
  onSend,
  onStop,
  onUpdateLaunchOptions,
  onOpenFile,
}: AssistantThreadProps) => {
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
      <ThreadPrimitive.Root className="dark relative flex h-full min-h-0 flex-col items-stretch bg-[#212121] text-[#ececec]">
        <ThreadPrimitive.Viewport className="flex min-h-0 grow flex-col gap-8 overflow-y-auto pt-8 md:pt-16">
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <div className="flex grow flex-col items-center justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-3xl border border-white/15 shadow">C</div>
              <p className="mt-4 text-xl text-white">How can I help you today?</p>
            </div>
          </AuiIf>

          <ThreadPrimitive.Messages
            components={{
              UserMessage: () => <UserMessage onOpenFile={onOpenFile} />,
              EditComposer,
              AssistantMessage: () => <AssistantMessage onOpenFile={onOpenFile} />,
              SystemMessage,
            }}
          />

          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-[#212121] px-4 pb-2">
            <ThreadPrimitive.ScrollToBottom asChild>
              <button
                type="button"
                title="Scroll to bottom"
                className="absolute -top-10 right-4 inline-flex size-8 items-center justify-center rounded-full border border-white/10 bg-[#2b2b2b] text-[#d3d3d3] transition-colors hover:bg-[#353535]"
              >
                <ChevronRightIcon className="size-4 rotate-90" />
              </button>
            </ThreadPrimitive.ScrollToBottom>

            <Composer
              launchOptions={launchOptions}
              modelOptions={modelOptions}
              approvalPolicyOptions={approvalPolicyOptions}
              sandboxModeOptions={sandboxModeOptions}
              isUpdatingLaunchOptions={isUpdatingLaunchOptions}
              onUpdateLaunchOptions={onUpdateLaunchOptions}
            />
            <p className="p-2 text-center text-white text-xs">Codex can make mistakes. Check important info.</p>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
};
