import { useEffect, useRef, useState } from 'react';

import {
  AuiIf,
  ComposerPrimitive,
} from '@assistant-ui/react';
import {
  ArrowUpIcon,
  EllipsisIcon,
  SquareIcon,
} from 'lucide-react';

import type {
  ChatApprovalPolicy,
  ChatLaunchOptions,
  ChatModelOption,
  ChatSandboxMode,
} from '../../api/chats';
import { Select } from '../../components/ui/select';

interface ThreadComposerProps {
  readonly launchOptions: ChatLaunchOptions | null;
  readonly modelOptions: readonly ChatModelOption[];
  readonly approvalPolicyOptions: readonly ChatApprovalPolicy[];
  readonly sandboxModeOptions: readonly ChatSandboxMode[];
  readonly isUpdatingLaunchOptions: boolean;
  readonly onUpdateLaunchOptions: (nextLaunchOptions: ChatLaunchOptions) => void;
}

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

/**
 * メッセージ編集時に使う簡易 composer。
 */
export const EditComposer = () => {
  return (
    <ComposerPrimitive.Root className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-[1.75rem] bg-white/15 p-2 sm:rounded-3xl sm:p-3">
      <ComposerPrimitive.Input className="h-11 max-h-32 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-white outline-none" />

      <div className="flex items-center justify-end gap-2 self-end">
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

/**
 * 通常のメッセージ送信用 composer。
 * @param props launch options と更新ハンドラ
 */
export const ThreadComposer = (props: ThreadComposerProps) => {
  const {
    launchOptions,
    modelOptions,
    approvalPolicyOptions,
    sandboxModeOptions,
    isUpdatingLaunchOptions,
    onUpdateLaunchOptions,
  } = props;
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
    <ComposerPrimitive.Root className="mx-auto flex w-full max-w-none items-end gap-2 border-t border-white/10 bg-[#212121]/98 px-3 py-2 sm:max-w-3xl sm:rounded-3xl sm:border-none sm:bg-white/5 sm:p-2">
      <div className="relative shrink-0 self-end" ref={settingsPanelRef}>
        <button
          type="button"
          title="Chat settings"
          disabled={!launchOptions}
          className="inline-flex size-10 items-center justify-center rounded-full bg-white/8 text-[#d8d8d8] transition-colors hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => {
            setIsSettingsOpen((prev) => !prev);
          }}
        >
          <EllipsisIcon className="size-4" />
        </button>

        {isSettingsOpen ? (
          <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-30 w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-xl border border-white/10 bg-[#1b1b1b] p-3 shadow-2xl shadow-black/45 sm:w-[18rem] sm:max-w-none">
            <div className="grid gap-2.5 text-sm">
              <label className="grid gap-1">
                <span className="text-[11px] text-[#999999]">Model</span>
                <Select
                  value={selectedModelValue}
                  disabled={!canEditLaunchOptions || modelOptions.length === 0}
                  className="h-8 border-white/12 bg-[#252525] text-xs"
                  onChange={(event) => handleModelChange(event.target.value)}
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
                  onChange={(event) => handleEffortChange(event.target.value)}
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
                  onChange={(event) => handleApprovalPolicyChange(event.target.value)}
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
                  onChange={(event) => handleSandboxModeChange(event.target.value)}
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
        className="min-h-10 max-h-32 grow resize-none bg-transparent px-3 py-2.5 text-sm leading-5 text-white outline-none placeholder:text-white/50"
      />
      <div className="flex shrink-0 items-center justify-end gap-2 self-end">
        <AuiIf condition={(state) => !state.thread.isRunning}>
          <ComposerPrimitive.Send className="flex size-10 items-center justify-center rounded-full bg-white transition-opacity disabled:opacity-10">
            <ArrowUpIcon className="size-4 text-black" />
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(state) => state.thread.isRunning}>
          <ComposerPrimitive.Cancel className="flex size-10 items-center justify-center rounded-full bg-white">
            <SquareIcon className="size-2.5 fill-black text-black" />
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </ComposerPrimitive.Root>
  );
};
