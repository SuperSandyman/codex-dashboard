import { useEffect, useRef, useState } from 'react';

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
import { CommandExecutionBlock } from './CommandExecutionBlock';
import { MarkdownBlock } from './MarkdownBlock';
import { parseCommandExecutionText } from './parseCommandExecutionText';

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
  readonly onRespondUserInput: (
    itemId: string,
    payload: RespondChatUserInputRequest,
  ) => void;
  readonly onUpdateLaunchOptions: (nextLaunchOptions: ChatLaunchOptions) => void;
}

const getMessageTitle = (message: ChatMessage): string => {
  if (message.role === 'tool') {
    return 'Tool';
  }
  if (message.role === 'assistant') {
    return 'Assistant';
  }
  if (message.role === 'system') {
    return 'System';
  }
  return 'You';
};

const isReasoningMessage = (message: ChatMessage): boolean => {
  return message.kind === 'reasoning';
};

const isCommandExecutionMessage = (message: ChatMessage): boolean => {
  return message.kind === 'commandExecution';
};

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
 * チャット履歴表示と Composer を提供する。
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
  const [draft, setDraft] = useState('');
  const [isComposerSettingsOpen, setIsComposerSettingsOpen] = useState(false);
  const [userInputDrafts, setUserInputDrafts] = useState<Record<string, Record<string, string>>>({});
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, activeTurnId]);

  useEffect(() => {
    setUserInputDrafts((prev) => {
      const next: Record<string, Record<string, string>> = {};
      userInputRequests.forEach((request) => {
        const existing = prev[request.itemId] ?? {};
        const questionAnswers: Record<string, string> = {};
        request.questions.forEach((question) => {
          questionAnswers[question.id] = existing[question.id] ?? '';
        });
        next[request.itemId] = questionAnswers;
      });
      return next;
    });
  }, [chatId, userInputRequests]);

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

  const handleSend = () => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    onSend(text);
    setDraft('');
  };

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
      selectedEffort && model.efforts.includes(selectedEffort)
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
    <div className="chat-card">
      <div className="chat-header">
        <div className="chat-header-main">
          <div className="chat-title">Chat</div>
          <div className="chat-status">
            {activeTurnId ? <span className="status-dot active" /> : <span className="status-dot" />}
            {activeTurnId ? 'Streaming' : 'Idle'}
          </div>
        </div>
      </div>

      <div className="chat-messages">
        {!chatId ? (
          <div className="chat-empty">Select or create a chat to start.</div>
        ) : null}
        {chatId && messages.length === 0 && !isLoading ? (
          <div className="chat-empty">No messages yet. Send your first prompt.</div>
        ) : null}
        {approvalRequests.length > 0 ? (
          <section className="approval-list">
            {approvalRequests.map((request) => {
              const isSubmitting = submittingApprovalItemIds.includes(request.itemId);
              return (
                <article key={request.itemId} className="approval-card">
                  <header className="approval-header">
                    <strong>Approval Required</strong>
                    <span>{formatApprovalKind(request.kind)}</span>
                  </header>
                  {request.reason ? <p className="approval-reason">{request.reason}</p> : null}
                  {request.command ? (
                    <pre className="approval-command">
                      <code>{request.command}</code>
                    </pre>
                  ) : null}
                  {request.cwd ? <div className="approval-path">cwd: {request.cwd}</div> : null}
                  {request.grantRoot ? <div className="approval-path">grantRoot: {request.grantRoot}</div> : null}
                  <div className="approval-actions">
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => onRespondApproval(request.itemId, 'accept')}
                    >
                      Yes
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => onRespondApproval(request.itemId, 'decline')}
                    >
                      No
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}
        {userInputRequests.length > 0 ? (
          <section className="user-input-list">
            {userInputRequests.map((request) => {
              const isSubmitting = submittingUserInputItemIds.includes(request.itemId);
              const isResolved = isQuestionResolved(userInputDrafts, request);
              return (
                <article key={request.itemId} className="user-input-card">
                  <header className="approval-header">
                    <strong>Input Required</strong>
                    <span>Tool User Input</span>
                  </header>
                  {request.questions.map((question) => {
                    const current = userInputDrafts[request.itemId]?.[question.id] ?? '';
                    const selectedOption =
                      question.options?.find((option) => option.label === current) ?? null;
                    const shouldUseSelect =
                      !question.isOther && Boolean(question.options && question.options.length > 0);
                    return (
                      <div key={question.id} className="user-input-question">
                        <div className="user-input-question-header">
                          <strong>{question.header}</strong>
                        </div>
                        <p className="user-input-question-text">{question.question}</p>
                        {shouldUseSelect ? (
                          <>
                            <select
                              className="chat-select user-input-select"
                              value={current}
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
                            </select>
                            {selectedOption ? (
                              <p className="user-input-option-description">{selectedOption.description}</p>
                            ) : null}
                          </>
                        ) : (
                          <input
                            className="chat-input user-input-text"
                            type={question.isSecret ? 'password' : 'text'}
                            value={current}
                            disabled={isSubmitting}
                            onChange={(event) => {
                              handleUserInputChange(request.itemId, question.id, event.target.value);
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                  <div className="approval-actions">
                    <button
                      className="button button-primary"
                      type="button"
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
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}
        {messages.map((message) => {
          const parsedCommandExecution = isCommandExecutionMessage(message)
            ? parseCommandExecutionText(message.text)
            : null;
          return (
            <article key={message.id} className={`chat-message role-${message.role}`}>
              <header className="chat-message-header">
                <span>{getMessageTitle(message)}</span>
                <span className="chat-message-kind">{message.kind}</span>
              </header>
              {isReasoningMessage(message) ? (
                <details className="reasoning-details">
                  <summary className="reasoning-summary">Reasoning (click to expand)</summary>
                  <MarkdownBlock text={message.text || ' '} />
                </details>
              ) : parsedCommandExecution ? (
                <CommandExecutionBlock
                  command={parsedCommandExecution.command}
                  output={parsedCommandExecution.output}
                  exitCode={parsedCommandExecution.exitCode}
                  status={message.status}
                />
              ) : (
                <MarkdownBlock text={message.text || ' '} />
              )}
              {message.status && !parsedCommandExecution ? (
                <div className="chat-message-status">{message.status}</div>
              ) : null}
            </article>
          );
        })}
        <div ref={messageEndRef} />
      </div>

      <div className="chat-composer">
        <textarea
          className="chat-input"
          placeholder="Type your prompt..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          disabled={!chatId || isLoading}
        />
        <div className="chat-composer-row">
          <div className="chat-actions">
            <button className="button button-secondary" type="button" onClick={onStop} disabled={!canStop}>
              Stop
            </button>
            <button className="button button-primary" type="button" onClick={handleSend} disabled={!canSend}>
              Send
            </button>
          </div>
          <button
            className="button button-secondary chat-settings-toggle"
            type="button"
            onClick={() => setIsComposerSettingsOpen((prev) => !prev)}
            aria-expanded={isComposerSettingsOpen}
            aria-label={isComposerSettingsOpen ? 'Hide chat settings' : 'Show chat settings'}
          >
            {isComposerSettingsOpen ? 'Hide Settings' : 'Show Settings'}
          </button>
        </div>
        <div
          className={`chat-launch-settings composer-launch-settings${
            isComposerSettingsOpen ? ' open' : ''
          }`}
        >
            <label className="chat-launch-field">
              <span>Model</span>
              <select
                className="chat-select"
                value={selectedModelValue}
                disabled={!canEditLaunchOptions}
                onChange={(event) => handleModelChange(event.target.value)}
              >
                {modelOptions.length === 0 ? <option value="">No models available</option> : null}
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label className="chat-launch-field">
              <span>Effort</span>
              <select
                className="chat-select"
                value={selectedEffort ?? ''}
                disabled={!canEditLaunchOptions || !selectedModelOption}
                onChange={(event) => handleEffortChange(event.target.value)}
              >
                <option value="">Model default</option>
                {effortOptions.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </select>
            </label>

            <label className="chat-launch-field">
              <span>Approval Policy</span>
              <select
                className="chat-select"
                value={selectedApprovalPolicy ?? ''}
                disabled={!canEditLaunchOptions || approvalPolicyOptions.length === 0}
                onChange={(event) => handleApprovalPolicyChange(event.target.value)}
              >
                <option value="">Default</option>
                {approvalPolicyOptions.map((policy) => (
                  <option key={policy} value={policy}>
                    {formatApprovalPolicy(policy)}
                  </option>
                ))}
              </select>
            </label>

            <label className="chat-launch-field">
              <span>Sandbox Mode</span>
              <select
                className="chat-select"
                value={selectedSandboxMode ?? ''}
                disabled={!canEditLaunchOptions || sandboxModeOptions.length === 0}
                onChange={(event) => handleSandboxModeChange(event.target.value)}
              >
                <option value="">Default</option>
                {sandboxModeOptions.map((mode) => (
                  <option key={mode} value={mode}>
                    {formatSandboxMode(mode)}
                  </option>
                ))}
              </select>
            </label>

            <div className="chat-cwd-display" title={launchOptions?.cwd ?? 'workspace default'}>
              <span>CWD</span>
              <strong>{launchOptions?.cwd ?? 'Workspace default'}</strong>
            </div>
        </div>
      </div>
    </div>
  );
};
