import { useState } from 'react';

import type {
  ChatApprovalDecision,
  ChatApprovalPolicy,
  ChatApprovalRequest,
  ChatLaunchOptions,
  ChatMessage,
  ChatModelOption,
  ChatSandboxMode,
  ChatUserInputRequest,
  RespondChatUserInputRequest,
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
  readonly onOpenFileFromChat: (path: string) => void;
}

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
 * Codex風テーマでチャット表示し、承認系入力のみ下部に表示する。
 * @param props ChatPane プロパティ
 */
export const ChatPane = (props: ChatPaneProps) => {
  const {
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
    onOpenFileFromChat,
  } = props;
  const [userInputDrafts, setUserInputDrafts] = useState<Record<string, Record<string, string>>>({});

  const canSend = Boolean(chatId) && !isLoading && !isSending && !activeTurnId;
  const canStop = Boolean(chatId) && Boolean(activeTurnId);

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
    <div className="flex h-full min-h-0 flex-col rounded-none bg-[#212121] text-white md:rounded-2xl">
      <div className="min-h-0 flex-1">
        {!chatId ? (
          <div className="grid h-full place-items-center p-6 text-sm text-white">Select or create a chat to start.</div>
        ) : (
          <AssistantThread
            messages={messages}
            isRunning={Boolean(activeTurnId)}
            launchOptions={launchOptions}
            modelOptions={modelOptions}
            approvalPolicyOptions={approvalPolicyOptions}
            sandboxModeOptions={sandboxModeOptions}
            isUpdatingLaunchOptions={isUpdatingLaunchOptions}
            onOpenFile={onOpenFileFromChat}
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
            onUpdateLaunchOptions={onUpdateLaunchOptions}
          />
        )}
      </div>

      {(approvalRequests.length > 0 || userInputRequests.length > 0) ? (
        <div className="mx-3 mb-3 mt-2 grid max-h-[40vh] gap-2 overflow-y-auto rounded-2xl border border-white/10 bg-white/3 p-3 sm:mx-4 sm:max-h-72">
          {approvalRequests.map((request) => {
            const isSubmitting = submittingApprovalItemIds.includes(request.itemId);
            return (
              <div key={request.itemId} className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-medium text-white">Approval Required</p>
                  <Badge className="border border-white/10 bg-white/4 text-white" variant="outline">
                    {formatApprovalKind(request.kind)}
                  </Badge>
                </div>
                {request.reason ? <p className="text-white">{request.reason}</p> : null}
                {request.command ? (
                  <pre className="max-h-40 overflow-auto rounded-md border border-white/10 bg-black/25 p-2 text-xs text-[#d4d4d4]">
                    <code>{request.command}</code>
                  </pre>
                ) : null}
                {request.cwd ? <div className="text-xs text-[#d8d8d8]">cwd: {request.cwd}</div> : null}
                {request.grantRoot ? <div className="text-xs text-[#d8d8d8]">grantRoot: {request.grantRoot}</div> : null}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full bg-[#2f2f2f] text-[#ececec] hover:bg-[#3a3a3a] sm:w-auto"
                    disabled={isSubmitting}
                    onClick={() => onRespondApproval(request.itemId, 'decline')}
                  >
                    No
                  </Button>
                  <Button
                    type="button"
                    className="w-full bg-white text-black hover:bg-white/90 sm:w-auto"
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
                <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-medium text-white">Input Required</p>
                  <Badge className="border border-white/10 bg-white/4 text-white" variant="outline">
                    Tool User Input
                  </Badge>
                </div>

                {request.questions.map((question) => {
                  const current = userInputDrafts[request.itemId]?.[question.id] ?? '';
                  const selectedOption = question.options?.find((option) => option.label === current) ?? null;
                  const shouldUseSelect = !question.isOther && Boolean(question.options && question.options.length > 0);
                  return (
                    <div key={question.id} className="grid gap-1.5 rounded-md border border-white/10 bg-black/20 p-3">
                      <div className="text-xs font-medium text-white">{question.header}</div>
                      <p className="text-sm text-white">{question.question}</p>
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
                          {selectedOption ? <p className="text-xs text-[#d8d8d8]">{selectedOption.description}</p> : null}
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

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <Button
                    type="button"
                    className="w-full bg-white text-black hover:bg-white/90 sm:w-auto"
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
