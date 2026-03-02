import { useState } from 'react';

import type {
  ChatApprovalDecision,
  ChatApprovalPolicy,
  ChatApprovalRequest,
  ChatLaunchOptions,
  ChatMessage,
  ChatModelOption,
  ChatUserInputRequest,
  RespondChatUserInputRequest,
  ChatSandboxMode,
} from '../../api/chats';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { AssistantThread } from './AssistantThread';

interface ChatPaneProps {
  readonly chatId: string | null;
  readonly messages: readonly ChatMessage[];
  readonly activeTurnId: string | null;
  readonly isLoading: boolean;
  readonly isSending: boolean;
  readonly launchOptions: ChatLaunchOptions | null;
  readonly modelOptions: readonly ChatModelOption[];
  readonly approvalPolicyOptions: readonly ChatApprovalPolicy[];
  readonly sandboxModeOptions: readonly ChatSandboxMode[];
  readonly isUpdatingLaunchOptions: boolean;
  readonly approvalRequests: readonly ChatApprovalRequest[];
  readonly submittingApprovalItemIds: readonly string[];
  readonly userInputRequests: readonly ChatUserInputRequest[];
  readonly submittingUserInputItemIds: readonly string[];
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
  readonly onRespondApproval: (itemId: string, decision: ChatApprovalDecision) => void;
  readonly onRespondUserInput: (itemId: string, payload: RespondChatUserInputRequest) => void;
  readonly onUpdateLaunchOptions: (nextLaunchOptions: ChatLaunchOptions) => void;
}

const resolveDefaultEffort = (model: ChatModelOption | null): string | null => {
  if (!model) {
    return null;
  }
  return model.defaultEffort ?? model.efforts[0] ?? null;
};

const formatApprovalPolicy = (value: ChatApprovalPolicy): string => {
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

const formatSandboxMode = (value: ChatSandboxMode): string => {
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

const formatApprovalKind = (kind: ChatApprovalRequest['kind']): string => {
  return kind === 'commandExecution' ? 'Command Execution' : 'File Change';
};

const isQuestionResolved = (
  drafts: Record<string, Record<string, string>>,
  request: ChatUserInputRequest,
): boolean => {
  return request.questions.every((question) => {
    const answer = drafts[request.itemId]?.[question.id] ?? '';
    return answer.trim().length > 0;
  });
};

const toUserInputResponsePayload = (
  drafts: Record<string, Record<string, string>>,
  request: ChatUserInputRequest,
): RespondChatUserInputRequest | null => {
  if (!isQuestionResolved(drafts, request)) {
    return null;
  }

  const answers: RespondChatUserInputRequest['answers'] = {};
  request.questions.forEach((question) => {
    const answer = drafts[request.itemId]?.[question.id] ?? '';
    answers[question.id] = {
      answers: [answer],
    };
  });

  return { answers };
};

/**
 * ChatGPT風テーマでチャット表示し、launch options と承認系入力を同一画面に維持する。
 * @param props ChatPane プロパティ
 */
export const ChatPane = ({
  chatId,
  messages,
  activeTurnId,
  isLoading,
  isSending,
  launchOptions,
  modelOptions,
  approvalPolicyOptions,
  sandboxModeOptions,
  isUpdatingLaunchOptions,
  approvalRequests,
  submittingApprovalItemIds,
  userInputRequests,
  submittingUserInputItemIds,
  onSend,
  onStop,
  onRespondApproval,
  onRespondUserInput,
  onUpdateLaunchOptions,
}: ChatPaneProps) => {
  const [userInputDrafts, setUserInputDrafts] = useState<Record<string, Record<string, string>>>({});
  const [isLaunchPanelOpen, setIsLaunchPanelOpen] = useState(false);

  const canSend = Boolean(chatId) && !isLoading && !isSending && !activeTurnId;
  const canStop = Boolean(chatId) && Boolean(activeTurnId);
  const canEditLaunchOptions = Boolean(chatId) && !isLoading && !isUpdatingLaunchOptions;

  const selectedModel = launchOptions?.model ?? null;
  const selectedEffort = launchOptions?.effort ?? null;
  const selectedApprovalPolicy = launchOptions?.approvalPolicy ?? null;
  const selectedSandboxMode = launchOptions?.sandboxMode ?? null;
  const selectedModelValue = selectedModel ?? modelOptions[0]?.id ?? '';
  const selectedModelOption = modelOptions.find((model) => model.id === selectedModelValue) ?? null;
  const effortOptions = selectedModelOption?.efforts ?? [];

  const handleModelChange = (rawModel: string) => {
    if (!launchOptions) {
      return;
    }
    const nextModel = rawModel.length > 0 ? rawModel : null;
    const model = modelOptions.find((entry) => entry.id === nextModel) ?? null;
    if (!nextModel || !model) {
      return;
    }

    const nextEffort = selectedEffort && model.efforts.includes(selectedEffort)
      ? selectedEffort
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

  const handleUserInputChange = (itemId: string, questionId: string, value: string) => {
    setUserInputDrafts((prev) => {
      const nextRequestAnswers = {
        ...(prev[itemId] ?? {}),
        [questionId]: value,
      };
      return {
        ...prev,
        [itemId]: nextRequestAnswers,
      };
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl bg-[#212121] text-[#ececec]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-xs">
          <Badge className="border border-white/15 bg-white/10 text-[#cdcdcd]" variant="outline">
            {activeTurnId ? 'Streaming' : 'Idle'}
          </Badge>
          <Badge className="border border-white/15 bg-white/[0.03] text-[#b4b4b4]" variant="outline">
            {isLoading ? 'Loading' : 'Ready'}
          </Badge>
          {selectedModel ? (
            <Badge className="border border-white/15 bg-white/[0.03] text-[#b4b4b4]" variant="outline">
              {selectedModel}
            </Badge>
          ) : null}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="border border-white/10 bg-white/[0.03] text-[#d8d8d8] hover:bg-white/10 hover:text-white"
          disabled={!chatId || isUpdatingLaunchOptions}
          onClick={() => setIsLaunchPanelOpen((prev) => !prev)}
        >
          {isLaunchPanelOpen ? 'Hide Settings' : 'Session Settings'}
        </Button>
      </div>

      {isLaunchPanelOpen ? (
        <div className="mx-4 mt-3 grid gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-xs text-[#b4b4b4]">
            <span>Model</span>
            <Select
              value={selectedModelValue}
              className="border-white/15 bg-[#2a2a2a] text-[#ececec]"
              disabled={!canEditLaunchOptions}
              onChange={(event) => handleModelChange(event.target.value)}
            >
              {modelOptions.length === 0 ? <option value="">No models available</option> : null}
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName}
                </option>
              ))}
            </Select>
          </label>

          <label className="grid gap-1 text-xs text-[#b4b4b4]">
            <span>Effort</span>
            <Select
              value={selectedEffort ?? ''}
              className="border-white/15 bg-[#2a2a2a] text-[#ececec]"
              disabled={!canEditLaunchOptions || !selectedModelOption}
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

          <label className="grid gap-1 text-xs text-[#b4b4b4]">
            <span>Approval</span>
            <Select
              value={selectedApprovalPolicy ?? ''}
              className="border-white/15 bg-[#2a2a2a] text-[#ececec]"
              disabled={!canEditLaunchOptions || approvalPolicyOptions.length === 0}
              onChange={(event) => handleApprovalPolicyChange(event.target.value)}
            >
              <option value="">Config default</option>
              {approvalPolicyOptions.map((policy) => (
                <option key={policy} value={policy}>
                  {formatApprovalPolicy(policy)}
                </option>
              ))}
            </Select>
          </label>

          <label className="grid gap-1 text-xs text-[#b4b4b4]">
            <span>Sandbox</span>
            <Select
              value={selectedSandboxMode ?? ''}
              className="border-white/15 bg-[#2a2a2a] text-[#ececec]"
              disabled={!canEditLaunchOptions || sandboxModeOptions.length === 0}
              onChange={(event) => handleSandboxModeChange(event.target.value)}
            >
              <option value="">Config default</option>
              {sandboxModeOptions.map((mode) => (
                <option key={mode} value={mode}>
                  {formatSandboxMode(mode)}
                </option>
              ))}
            </Select>
          </label>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 pt-2">
        {!chatId ? (
          <div className="grid h-full place-items-center p-6 text-sm text-[#b4b4b4]">Select or create a chat to start.</div>
        ) : (
          <AssistantThread
            messages={messages}
            isRunning={Boolean(activeTurnId)}
            onSend={(text) => {
              if (!canSend) {
                return;
              }
              onSend(text);
            }}
            onStop={() => {
              if (!canStop) {
                return;
              }
              onStop();
            }}
          />
        )}
      </div>

      {(approvalRequests.length > 0 || userInputRequests.length > 0) ? (
        <div className="mx-4 mb-3 mt-2 grid max-h-72 gap-2 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          {approvalRequests.map((request) => {
            const isSubmitting = submittingApprovalItemIds.includes(request.itemId);
            return (
              <div key={request.itemId} className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-[#ececec]">Approval Required</p>
                  <Badge className="border border-white/10 bg-white/[0.04] text-[#b4b4b4]" variant="outline">
                    {formatApprovalKind(request.kind)}
                  </Badge>
                </div>
                {request.reason ? <p className="text-[#b4b4b4]">{request.reason}</p> : null}
                {request.command ? (
                  <pre className="max-h-40 overflow-auto rounded-md border border-white/10 bg-black/25 p-2 text-xs text-[#d4d4d4]">
                    <code>{request.command}</code>
                  </pre>
                ) : null}
                {request.cwd ? <div className="text-xs text-[#9f9f9f]">cwd: {request.cwd}</div> : null}
                {request.grantRoot ? <div className="text-xs text-[#9f9f9f]">grantRoot: {request.grantRoot}</div> : null}
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="bg-[#2f2f2f] text-[#ececec] hover:bg-[#3a3a3a]"
                    disabled={isSubmitting}
                    onClick={() => onRespondApproval(request.itemId, 'decline')}
                  >
                    No
                  </Button>
                  <Button
                    type="button"
                    className="bg-white text-black hover:bg-white/90"
                    disabled={isSubmitting}
                    onClick={() => onRespondApproval(request.itemId, 'accept')}
                  >
                    Yes
                  </Button>
                </div>
              </div>
            );
          })}

          {userInputRequests.map((request) => {
            const isSubmitting = submittingUserInputItemIds.includes(request.itemId);
            const isResolved = isQuestionResolved(userInputDrafts, request);
            return (
              <div key={request.itemId} className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-[#ececec]">Input Required</p>
                  <Badge className="border border-white/10 bg-white/[0.04] text-[#b4b4b4]" variant="outline">
                    Tool User Input
                  </Badge>
                </div>

                {request.questions.map((question) => {
                  const current = userInputDrafts[request.itemId]?.[question.id] ?? '';
                  const selectedOption = question.options?.find((option) => option.label === current) ?? null;
                  const shouldUseSelect = !question.isOther && Boolean(question.options && question.options.length > 0);
                  return (
                    <div key={question.id} className="grid gap-1.5 rounded-md border border-white/10 bg-black/20 p-3">
                      <div className="text-xs font-medium text-[#b4b4b4]">{question.header}</div>
                      <p className="text-sm text-[#ececec]">{question.question}</p>
                      {shouldUseSelect ? (
                        <>
                          <Select
                            value={current}
                            className="border-white/15 bg-[#2a2a2a] text-[#ececec]"
                            disabled={isSubmitting}
                            onChange={(event) => {
                              handleUserInputChange(request.itemId, question.id, event.target.value);
                            }}
                          >
                            <option value="">Select an option</option>
                            {question.options?.map((option) => (
                              <option key={option.label} value={option.label}>
                                {option.label}
                              </option>
                            ))}
                          </Select>
                          {selectedOption ? <p className="text-xs text-[#a8a8a8]">{selectedOption.description}</p> : null}
                        </>
                      ) : (
                        <Input
                          type={question.isSecret ? 'password' : 'text'}
                          value={current}
                          className="border-white/15 bg-[#2a2a2a] text-[#ececec]"
                          disabled={isSubmitting}
                          onChange={(event) => {
                            handleUserInputChange(request.itemId, question.id, event.target.value);
                          }}
                        />
                      )}
                    </div>
                  );
                })}

                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    className="bg-white text-black hover:bg-white/90"
                    disabled={isSubmitting || !isResolved}
                    onClick={() => {
                      const payload = toUserInputResponsePayload(userInputDrafts, request);
                      if (!payload) {
                        return;
                      }
                      onRespondUserInput(request.itemId, payload);
                    }}
                  >
                    Submit
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
