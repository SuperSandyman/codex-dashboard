import {
  AssistantRuntimeProvider,
  AuiIf,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { ChevronRightIcon } from 'lucide-react';

import type {
  ChatApprovalPolicy,
  ChatLaunchOptions,
  ChatMessage,
  ChatModelOption,
  ChatSandboxMode,
} from '../../api/chats';
import { ThreadComposer, EditComposer } from './ThreadComposer';
import { AssistantMessage, SystemMessage, UserMessage } from './ThreadMessages';
import { toThreadMessage, toUserText } from './threadRuntime';

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

/**
 * assistant-ui 上にチャットスレッドを構築し、既存 backend の送受信と接続する。
 * @param props 既存チャット状態と送信・停止ハンドラ
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
        <ThreadPrimitive.Viewport className="flex min-h-0 grow flex-col overflow-y-auto px-3 pt-6 sm:px-4 sm:pt-8 md:pt-10">
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <div className="flex grow flex-col items-center justify-center px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-3xl border border-white/15 shadow">C</div>
              <p className="mt-4 text-xl text-white">How can I help you today?</p>
            </div>
          </AuiIf>

          <div className="flex flex-col gap-6 sm:gap-8">
            <ThreadPrimitive.Messages
              components={{
                UserMessage: () => <UserMessage onOpenFile={onOpenFile} />,
                EditComposer,
                AssistantMessage: () => <AssistantMessage onOpenFile={onOpenFile} />,
                SystemMessage,
              }}
            />
          </div>

          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-[#212121]/95 px-0 pb-[env(safe-area-inset-bottom)] pt-0 backdrop-blur sm:px-4 sm:pb-2 sm:pt-2">
            <ThreadPrimitive.ScrollToBottom asChild>
              <button
                type="button"
                title="Scroll to bottom"
                className="absolute -top-10 right-3 inline-flex size-8 items-center justify-center rounded-full border border-white/10 bg-[#2b2b2b] text-[#d3d3d3] transition-colors hover:bg-[#353535] sm:right-4"
              >
                <ChevronRightIcon className="size-4 rotate-90" />
              </button>
            </ThreadPrimitive.ScrollToBottom>

            <ThreadComposer
              launchOptions={launchOptions}
              modelOptions={modelOptions}
              approvalPolicyOptions={approvalPolicyOptions}
              sandboxModeOptions={sandboxModeOptions}
              isUpdatingLaunchOptions={isUpdatingLaunchOptions}
              onUpdateLaunchOptions={onUpdateLaunchOptions}
            />
            <p className="hidden px-2 pt-2 text-center text-white text-xs sm:block">
              Codex can make mistakes. Check important info.
            </p>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
};
