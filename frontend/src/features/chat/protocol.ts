import type { ChatApprovalDecision, ChatApprovalRequest, ChatMessage, ChatRole } from '../../api/chats';

export interface ChatStreamReadyEvent {
  readonly type: 'ready';
  readonly threadId: string;
  readonly activeTurnId: string | null;
  readonly pendingApprovals: ChatApprovalRequest[];
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

export type ChatStreamEvent =
  | ChatStreamReadyEvent
  | ChatStreamTurnStartedEvent
  | ChatStreamTurnCompletedEvent
  | ChatStreamItemStartedEvent
  | ChatStreamItemUpdatedEvent
  | ChatStreamMessageDeltaEvent
  | ChatStreamErrorEvent
  | ChatStreamApprovalRequestedEvent
  | ChatStreamApprovalResolvedEvent;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object';
};

const isChatRole = (value: unknown): value is ChatRole => {
  return value === 'user' || value === 'assistant' || value === 'tool' || value === 'system';
};

const parseChatMessage = (value: unknown): ChatMessage | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.threadId !== 'string' ||
    (value.turnId !== null && typeof value.turnId !== 'string') ||
    !isChatRole(value.role) ||
    typeof value.kind !== 'string' ||
    typeof value.text !== 'string' ||
    (value.status !== null && typeof value.status !== 'string')
  ) {
    return null;
  }
  return {
    id: value.id,
    threadId: value.threadId,
    turnId: value.turnId,
    role: value.role,
    kind: value.kind,
    text: value.text,
    status: value.status,
  };
};

const parseChatApprovalRequest = (value: unknown): ChatApprovalRequest | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.threadId !== 'string' ||
    typeof value.turnId !== 'string' ||
    typeof value.itemId !== 'string' ||
    (value.kind !== 'commandExecution' && value.kind !== 'fileChange') ||
    (value.reason !== null && typeof value.reason !== 'string') ||
    (value.command !== null && typeof value.command !== 'string') ||
    (value.cwd !== null && typeof value.cwd !== 'string') ||
    (value.grantRoot !== null && typeof value.grantRoot !== 'string')
  ) {
    return null;
  }
  return {
    threadId: value.threadId,
    turnId: value.turnId,
    itemId: value.itemId,
    kind: value.kind,
    reason: value.reason,
    command: value.command,
    cwd: value.cwd,
    grantRoot: value.grantRoot,
  };
};

/**
 * WebSocket で受信したストリームイベントを検証する。
 * @param payload 受信 JSON
 */
export const parseChatStreamEvent = (payload: unknown): ChatStreamEvent | null => {
  if (!isRecord(payload) || typeof payload.type !== 'string' || typeof payload.threadId !== 'string') {
    return null;
  }

  switch (payload.type) {
    case 'ready':
      if (payload.activeTurnId !== null && typeof payload.activeTurnId !== 'string') {
        return null;
      }
      if (!Array.isArray(payload.pendingApprovals)) {
        return null;
      }
      const pendingApprovals: ChatApprovalRequest[] = [];
      for (const entry of payload.pendingApprovals) {
        const parsed = parseChatApprovalRequest(entry);
        if (!parsed) {
          return null;
        }
        pendingApprovals.push(parsed);
      }
      return {
        type: 'ready',
        threadId: payload.threadId,
        activeTurnId: payload.activeTurnId,
        pendingApprovals,
      };
    case 'turn_started':
      if (typeof payload.turnId !== 'string') {
        return null;
      }
      return {
        type: 'turn_started',
        threadId: payload.threadId,
        turnId: payload.turnId,
      };
    case 'turn_completed':
      if (
        typeof payload.turnId !== 'string' ||
        typeof payload.status !== 'string' ||
        (payload.errorMessage !== null && typeof payload.errorMessage !== 'string')
      ) {
        return null;
      }
      return {
        type: 'turn_completed',
        threadId: payload.threadId,
        turnId: payload.turnId,
        status: payload.status,
        errorMessage: payload.errorMessage,
      };
    case 'item_started':
    case 'item_updated': {
      if (typeof payload.turnId !== 'string') {
        return null;
      }
      const message = parseChatMessage(payload.message);
      if (!message) {
        return null;
      }
      if (payload.type === 'item_started') {
        return {
          type: 'item_started',
          threadId: payload.threadId,
          turnId: payload.turnId,
          message,
        };
      }
      return {
        type: 'item_updated',
        threadId: payload.threadId,
        turnId: payload.turnId,
        message,
      };
    }
    case 'message_delta':
      if (
        typeof payload.turnId !== 'string' ||
        typeof payload.itemId !== 'string' ||
        !isChatRole(payload.role) ||
        typeof payload.kind !== 'string' ||
        typeof payload.delta !== 'string'
      ) {
        return null;
      }
      return {
        type: 'message_delta',
        threadId: payload.threadId,
        turnId: payload.turnId,
        itemId: payload.itemId,
        role: payload.role,
        kind: payload.kind,
        delta: payload.delta,
      };
    case 'error':
      if (!isRecord(payload.error) || typeof payload.error.code !== 'string' || typeof payload.error.message !== 'string') {
        return null;
      }
      return {
        type: 'error',
        threadId: payload.threadId,
        error: {
          code: payload.error.code,
          message: payload.error.message,
        },
      };
    case 'approval_requested': {
      const request = parseChatApprovalRequest(payload.request);
      if (!request) {
        return null;
      }
      return {
        type: 'approval_requested',
        threadId: payload.threadId,
        request,
      };
    }
    case 'approval_resolved':
      if (
        typeof payload.itemId !== 'string' ||
        (payload.decision !== 'accept' && payload.decision !== 'decline')
      ) {
        return null;
      }
      return {
        type: 'approval_resolved',
        threadId: payload.threadId,
        itemId: payload.itemId,
        decision: payload.decision,
      };
    default:
      return null;
  }
};
