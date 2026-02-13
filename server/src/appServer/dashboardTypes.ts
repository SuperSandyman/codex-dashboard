export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';
export type ChatApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type ChatSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type ChatApprovalRequestKind = 'commandExecution' | 'fileChange';
export type ChatApprovalDecision = 'accept' | 'decline';

export interface ChatLaunchOptions {
  readonly model: string | null;
  readonly effort: string | null;
  readonly cwd: string | null;
  readonly approvalPolicy: ChatApprovalPolicy | null;
  readonly sandboxMode: ChatSandboxMode | null;
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
  readonly approvalPolicies: ChatApprovalPolicy[];
  readonly sandboxModes: ChatSandboxMode[];
  readonly defaultApprovalPolicy: ChatApprovalPolicy | null;
  readonly defaultSandboxMode: ChatSandboxMode | null;
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
  readonly pendingApprovals: ChatApprovalRequest[];
  readonly pendingUserInputRequests: ChatUserInputRequest[];
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

export interface ChatApprovalRequest {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly kind: ChatApprovalRequestKind;
  readonly reason: string | null;
  readonly command: string | null;
  readonly cwd: string | null;
  readonly grantRoot: string | null;
}

export interface ChatStreamApprovalRequestedEvent {
  readonly type: 'approval_requested';
  readonly threadId: string;
  readonly request: ChatApprovalRequest;
}

export interface ChatStreamApprovalResolvedEvent {
  readonly type: 'approval_resolved';
  readonly threadId: string;
  readonly itemId: string;
  readonly decision: ChatApprovalDecision;
}

export interface ChatUserInputOption {
  readonly label: string;
  readonly description: string;
}

export interface ChatUserInputQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly isOther: boolean;
  readonly isSecret: boolean;
  readonly options: ChatUserInputOption[] | null;
}

export interface ChatUserInputRequest {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly questions: ChatUserInputQuestion[];
}

export interface ChatUserInputAnswer {
  readonly answers: string[];
}

export interface ChatUserInputResponse {
  readonly answers: Record<string, ChatUserInputAnswer>;
}

export interface ChatStreamUserInputRequestedEvent {
  readonly type: 'user_input_requested';
  readonly threadId: string;
  readonly request: ChatUserInputRequest;
}

export interface ChatStreamUserInputResolvedEvent {
  readonly type: 'user_input_resolved';
  readonly threadId: string;
  readonly itemId: string;
}

export type ChatStreamEvent =
  | ChatStreamReadyEvent
  | ChatStreamTurnStartedEvent
  | ChatStreamTurnCompletedEvent
  | ChatStreamItemStartedEvent
  | ChatStreamItemUpdatedEvent
  | ChatStreamMessageDeltaEvent
  | ChatStreamErrorEvent
  | ChatStreamApprovalRequestedEvent
  | ChatStreamApprovalResolvedEvent
  | ChatStreamUserInputRequestedEvent
  | ChatStreamUserInputResolvedEvent;
