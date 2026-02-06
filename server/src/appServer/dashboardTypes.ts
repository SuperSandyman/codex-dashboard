export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ChatLaunchOptions {
  readonly model: string | null;
  readonly effort: string | null;
  readonly cwd: string | null;
}

export interface ChatModelOption {
  readonly id: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly efforts: string[];
  readonly defaultEffort: string | null;
  readonly isDefault: boolean;
}

export interface ChatLaunchOptionCatalog {
  readonly models: ChatModelOption[];
  readonly workspaceRoot: string | null;
  readonly cwdChoices: string[];
}

export interface ChatSummary {
  readonly id: string;
  readonly preview: string;
  readonly modelProvider: string;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly launchOptions: ChatLaunchOptions;
}

export interface ChatMessage {
  readonly id: string;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly role: ChatRole;
  readonly kind: string;
  readonly text: string;
  readonly status: string | null;
}

export interface ChatDetail {
  readonly chat: ChatSummary;
  readonly messages: ChatMessage[];
  readonly activeTurnId: string | null;
}

export interface ChatStreamReadyEvent {
  readonly type: 'ready';
  readonly threadId: string;
  readonly activeTurnId: string | null;
}

export interface ChatStreamTurnStartedEvent {
  readonly type: 'turn_started';
  readonly threadId: string;
  readonly turnId: string;
}

export interface ChatStreamTurnCompletedEvent {
  readonly type: 'turn_completed';
  readonly threadId: string;
  readonly turnId: string;
  readonly status: string;
  readonly errorMessage: string | null;
}

export interface ChatStreamItemStartedEvent {
  readonly type: 'item_started';
  readonly threadId: string;
  readonly turnId: string;
  readonly message: ChatMessage;
}

export interface ChatStreamItemUpdatedEvent {
  readonly type: 'item_updated';
  readonly threadId: string;
  readonly turnId: string;
  readonly message: ChatMessage;
}

export interface ChatStreamMessageDeltaEvent {
  readonly type: 'message_delta';
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly role: ChatRole;
  readonly kind: string;
  readonly delta: string;
}

export interface ChatStreamErrorEvent {
  readonly type: 'error';
  readonly threadId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type ChatStreamEvent =
  | ChatStreamReadyEvent
  | ChatStreamTurnStartedEvent
  | ChatStreamTurnCompletedEvent
  | ChatStreamItemStartedEvent
  | ChatStreamItemUpdatedEvent
  | ChatStreamMessageDeltaEvent
  | ChatStreamErrorEvent;
