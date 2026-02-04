import { useEffect, useRef, useState } from 'react';

import type { ChatLaunchOptions, ChatMessage, ChatModelOption } from '../../api/chats';
import { MarkdownBlock } from './MarkdownBlock';

interface ChatPaneProps {
  readonly chatId: string | null;
  readonly messages: readonly ChatMessage[];
  readonly activeTurnId: string | null;
  readonly isLoading: boolean;
  readonly isSending: boolean;
  readonly launchOptions: ChatLaunchOptions | null;
  readonly modelOptions: readonly ChatModelOption[];
  readonly isUpdatingLaunchOptions: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
  readonly onUpdateLaunchOptions: (model: string | null, effort: string | null) => void;
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

const resolveDefaultEffort = (model: ChatModelOption | null): string | null => {
  if (!model) {
    return null;
  }
  return model.defaultEffort ?? model.efforts[0] ?? null;
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
  isUpdatingLaunchOptions,
  onSend,
  onStop,
  onUpdateLaunchOptions,
}: ChatPaneProps) => {
  const [draft, setDraft] = useState('');
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, activeTurnId]);

  const canSend = Boolean(chatId) && !isLoading && !isSending && !activeTurnId;
  const canStop = Boolean(chatId) && Boolean(activeTurnId);
  const canEditLaunchOptions =
    Boolean(chatId) && !isLoading && !isUpdatingLaunchOptions && modelOptions.length > 0;

  const selectedModel = launchOptions?.model ?? null;
  const selectedEffort = launchOptions?.effort ?? null;
  const selectedModelOption = modelOptions.find((model) => model.id === selectedModel) ?? null;
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
    const nextModel = rawModel.length > 0 ? rawModel : null;
    const model = modelOptions.find((entry) => entry.id === nextModel) ?? null;
    if (!nextModel || !model) {
      onUpdateLaunchOptions(null, null);
      return;
    }

    const nextEffort =
      selectedEffort && model.efforts.includes(selectedEffort)
        ? selectedEffort
        : resolveDefaultEffort(model);
    onUpdateLaunchOptions(nextModel, nextEffort);
  };

  const handleEffortChange = (rawEffort: string) => {
    const nextEffort = rawEffort.length > 0 ? rawEffort : null;
    onUpdateLaunchOptions(selectedModel, nextEffort);
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

        <div className="chat-launch-settings">
          <label className="chat-launch-field">
            <span>Model</span>
            <select
              className="chat-select"
              value={selectedModel ?? ''}
              disabled={!canEditLaunchOptions}
              onChange={(event) => handleModelChange(event.target.value)}
            >
              <option value="">App default</option>
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

          <div className="chat-cwd-display" title={launchOptions?.cwd ?? 'workspace default'}>
            <span>CWD</span>
            <strong>{launchOptions?.cwd ?? 'Workspace default'}</strong>
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
        {messages.map((message) => (
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
            ) : (
              <MarkdownBlock text={message.text || ' '} />
            )}
            {message.status ? <div className="chat-message-status">{message.status}</div> : null}
          </article>
        ))}
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
        <div className="chat-actions">
          <button className="button button-secondary" type="button" onClick={onStop} disabled={!canStop}>
            Stop
          </button>
          <button className="button button-primary" type="button" onClick={handleSend} disabled={!canSend}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
};
