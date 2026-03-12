import type {
  ChatApprovalPolicy,
  ChatLaunchOptions,
  ChatModelOption,
  ChatSandboxMode,
} from '../../api/chats';
import type { TerminalCatalog, TerminalProfile } from '../../api/terminals';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import type { CreateMode } from './types';

interface CreateSessionDialogProps {
  readonly isOpen: boolean;
  readonly createMode: CreateMode;
  readonly isLoadingChats: boolean;
  readonly isCreatingTerminal: boolean;
  readonly isLoadingCatalog: boolean;
  readonly isLoadingTerminalCatalog: boolean;
  readonly isLoadingSessionDirectories: boolean;
  readonly sessionDirectoryError: string | null;
  readonly workspaceRoot: string | null;
  readonly newChatLaunchOptions: ChatLaunchOptions;
  readonly newChatEfforts: readonly string[];
  readonly newChatPrompt: string;
  readonly modelOptions: readonly ChatModelOption[];
  readonly approvalPolicyOptions: readonly ChatApprovalPolicy[];
  readonly sandboxModeOptions: readonly ChatSandboxMode[];
  readonly chatDirectoryOptions: readonly string[];
  readonly terminalCatalog: TerminalCatalog;
  readonly terminalDirectoryOptions: readonly string[];
  readonly newTerminalProfileId: string | null;
  readonly newTerminalCwd: string | null;
  readonly selectedProfile: TerminalProfile | null;
  readonly onClose: () => void;
  readonly onSelectMode: (mode: CreateMode) => void;
  readonly onChangeNewChatModel: (modelId: string) => void;
  readonly onChangeNewChatEffort: (effort: string) => void;
  readonly onChangeNewChatApprovalPolicy: (policy: string) => void;
  readonly onChangeNewChatDirectory: (value: string) => void;
  readonly onResetNewChatDirectory: () => void;
  readonly onReloadDirectoryOptions: () => void;
  readonly onChangeNewChatSandboxMode: (mode: string) => void;
  readonly onSelectChatDirectory: (cwd: string) => void;
  readonly onChangeNewChatPrompt: (prompt: string) => void;
  readonly onChangeNewTerminalProfileId: (profileId: string) => void;
  readonly onChangeNewTerminalCwd: (cwd: string) => void;
  readonly onResetNewTerminalCwd: () => void;
  readonly onSelectTerminalDirectory: (cwd: string) => void;
  readonly onCreateChat: () => void;
  readonly onCreateTerminal: () => void;
  readonly formatApprovalPolicyLabel: (value: ChatApprovalPolicy) => string;
  readonly formatSandboxModeLabel: (value: ChatSandboxMode) => string;
  readonly toDirectoryOptionLabel: (workspaceRoot: string | null, cwd: string) => string;
}

/**
 * チャット・ターミナル作成フォームを表示するモーダル。
 * @param props 作成対象の入力値とイベントハンドラ
 */
export const CreateSessionDialog = (props: CreateSessionDialogProps) => {
  const {
    isOpen,
    createMode,
    isLoadingChats,
    isCreatingTerminal,
    isLoadingCatalog,
    isLoadingTerminalCatalog,
    isLoadingSessionDirectories,
    sessionDirectoryError,
    workspaceRoot,
    newChatLaunchOptions,
    newChatEfforts,
    newChatPrompt,
    modelOptions,
    approvalPolicyOptions,
    sandboxModeOptions,
    chatDirectoryOptions,
    terminalCatalog,
    terminalDirectoryOptions,
    newTerminalProfileId,
    newTerminalCwd,
    selectedProfile,
    onClose,
    onSelectMode,
    onChangeNewChatModel,
    onChangeNewChatEffort,
    onChangeNewChatApprovalPolicy,
    onChangeNewChatDirectory,
    onResetNewChatDirectory,
    onReloadDirectoryOptions,
    onChangeNewChatSandboxMode,
    onSelectChatDirectory,
    onChangeNewChatPrompt,
    onChangeNewTerminalProfileId,
    onChangeNewTerminalCwd,
    onResetNewTerminalCwd,
    onSelectTerminalDirectory,
    onCreateChat,
    onCreateTerminal,
    formatApprovalPolicyLabel,
    formatSandboxModeLabel,
    toDirectoryOptionLabel,
  } = props;

  if (!isOpen) {
    return null;
  }

  return (
    <section
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/55 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur-sm sm:px-4 sm:pt-8"
      onClick={onClose}
    >
      <Card
        className="max-h-[calc(100dvh-2rem)] w-full max-w-5xl overflow-hidden border-white/10 bg-[#171717] sm:max-h-[calc(100dvh-3rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">New Session</CardTitle>
            <div className="inline-flex rounded-md border border-white/10 bg-white/3 p-1">
              <Button
                variant={createMode === 'chat' ? 'default' : 'ghost'}
                size="sm"
                type="button"
                onClick={() => onSelectMode('chat')}
              >
                Chat
              </Button>
              <Button
                variant={createMode === 'terminal' ? 'default' : 'ghost'}
                size="sm"
                type="button"
                onClick={() => onSelectMode('terminal')}
              >
                Terminal
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 overflow-y-auto pt-0">
          {createMode === 'chat' ? (
            <>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  <span>Model</span>
                  <Select
                    value={newChatLaunchOptions.model ?? ''}
                    disabled={isLoadingCatalog || modelOptions.length === 0}
                    onChange={(event) => onChangeNewChatModel(event.target.value)}
                  >
                    {modelOptions.length === 0 ? <option value="">No models available</option> : null}
                    {modelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="grid gap-1 text-xs text-muted-foreground">
                  <span>Effort</span>
                  <Select
                    value={newChatLaunchOptions.effort ?? ''}
                    disabled={isLoadingCatalog || !newChatLaunchOptions.model || newChatEfforts.length === 0}
                    onChange={(event) => onChangeNewChatEffort(event.target.value)}
                  >
                    <option value="">Model default</option>
                    {newChatEfforts.map((effort) => (
                      <option key={effort} value={effort}>
                        {effort}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="grid gap-1 text-xs text-muted-foreground">
                  <span>Approval Policy</span>
                  <Select
                    value={newChatLaunchOptions.approvalPolicy ?? ''}
                    disabled={isLoadingCatalog || approvalPolicyOptions.length === 0}
                    onChange={(event) => onChangeNewChatApprovalPolicy(event.target.value)}
                  >
                    {approvalPolicyOptions.length > 0 ? <option value="">Config default</option> : null}
                    {approvalPolicyOptions.length === 0 ? <option value="">No policies available</option> : null}
                    {approvalPolicyOptions.map((policy) => (
                      <option key={policy} value={policy}>
                        {formatApprovalPolicyLabel(policy)}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  <span>Directory</span>
                  <Input
                    list="new-session-chat-directory-options"
                    value={newChatLaunchOptions.cwd ?? ''}
                    disabled={isLoadingCatalog || workspaceRoot === null}
                    placeholder={workspaceRoot ? `Workspace default (${workspaceRoot})` : 'WORKSPACE_ROOT not configured'}
                    onChange={(event) => onChangeNewChatDirectory(event.target.value)}
                  />
                  <datalist id="new-session-chat-directory-options">
                    {chatDirectoryOptions.map((cwd) => (
                      <option key={cwd} value={cwd} />
                    ))}
                  </datalist>
                </label>

                <label className="grid gap-1 text-xs text-muted-foreground">
                  <span>Sandbox Mode</span>
                  <Select
                    value={newChatLaunchOptions.sandboxMode ?? ''}
                    disabled={isLoadingCatalog || sandboxModeOptions.length === 0}
                    onChange={(event) => onChangeNewChatSandboxMode(event.target.value)}
                  >
                    {sandboxModeOptions.length > 0 ? <option value="">Config default</option> : null}
                    {sandboxModeOptions.length === 0 ? <option value="">No sandbox modes available</option> : null}
                    {sandboxModeOptions.map((mode) => (
                      <option key={mode} value={mode}>
                        {formatSandboxModeLabel(mode)}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={workspaceRoot === null}
                  onClick={onResetNewChatDirectory}
                >
                  Workspace default
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={workspaceRoot === null || isLoadingSessionDirectories}
                  onClick={onReloadDirectoryOptions}
                >
                  Reload list
                </Button>
                <Badge variant="outline">
                  {isLoadingSessionDirectories ? 'Loading directories...' : 'Directory suggestions ready'}
                </Badge>
                {sessionDirectoryError ? <Badge variant="destructive">{sessionDirectoryError}</Badge> : null}
              </div>

              <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto rounded-md border border-border/60 bg-background/60 p-2">
                {chatDirectoryOptions.slice(0, 24).map((cwd) => (
                  <button
                    key={cwd}
                    type="button"
                    className={
                      newChatLaunchOptions.cwd === cwd
                        ? 'rounded-full border border-primary/60 bg-primary/15 px-2 py-0.5 text-primary text-xs'
                        : 'rounded-full border border-border/60 px-2 py-0.5 text-xs hover:bg-accent/70'
                    }
                    onClick={() => onSelectChatDirectory(cwd)}
                    title={cwd}
                  >
                    {toDirectoryOptionLabel(workspaceRoot, cwd)}
                  </button>
                ))}
              </div>

              <label className="grid gap-1 text-xs text-muted-foreground">
                <span>Prompt</span>
                <Textarea
                  className="min-h-24"
                  placeholder="Type the first prompt..."
                  value={newChatPrompt}
                  onChange={(event) => onChangeNewChatPrompt(event.target.value)}
                  disabled={isLoadingChats}
                />
              </label>
            </>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  <span>Profile</span>
                  <Select
                    value={newTerminalProfileId ?? ''}
                    disabled={isLoadingTerminalCatalog || terminalCatalog.profiles.length === 0}
                    onChange={(event) => onChangeNewTerminalProfileId(event.target.value)}
                  >
                    {terminalCatalog.profiles.length === 0 ? <option value="">No profiles available</option> : null}
                    {terminalCatalog.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="grid gap-1 text-xs text-muted-foreground">
                  <span>Directory</span>
                  <Input
                    list="new-session-terminal-directory-options"
                    value={newTerminalCwd ?? ''}
                    disabled={isLoadingTerminalCatalog || terminalCatalog.workspaceRoot === null}
                    placeholder={
                      terminalCatalog.workspaceRoot
                        ? `Workspace default (${terminalCatalog.workspaceRoot})`
                        : 'WORKSPACE_ROOT not configured'
                    }
                    onChange={(event) => onChangeNewTerminalCwd(event.target.value)}
                  />
                  <datalist id="new-session-terminal-directory-options">
                    {terminalDirectoryOptions.map((cwd) => (
                      <option key={cwd} value={cwd} />
                    ))}
                  </datalist>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={terminalCatalog.workspaceRoot === null}
                  onClick={onResetNewTerminalCwd}
                >
                  Workspace default
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={terminalCatalog.workspaceRoot === null || isLoadingSessionDirectories}
                  onClick={onReloadDirectoryOptions}
                >
                  Reload list
                </Button>
              </div>

              <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto rounded-md border border-border/60 bg-background/60 p-2">
                {terminalDirectoryOptions.slice(0, 24).map((cwd) => (
                  <button
                    key={cwd}
                    type="button"
                    className={
                      newTerminalCwd === cwd
                        ? 'rounded-full border border-primary/60 bg-primary/15 px-2 py-0.5 text-primary text-xs'
                        : 'rounded-full border border-border/60 px-2 py-0.5 text-xs hover:bg-accent/70'
                    }
                    onClick={() => onSelectTerminalDirectory(cwd)}
                    title={cwd}
                  >
                    {toDirectoryOptionLabel(terminalCatalog.workspaceRoot, cwd)}
                  </button>
                ))}
              </div>

              <label className="grid gap-1 text-xs text-muted-foreground">
                <span>Command</span>
                <Input
                  value={selectedProfile ? `${selectedProfile.command} ${selectedProfile.args.join(' ')}`.trim() : ''}
                  disabled
                />
              </label>
            </>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
            <Button
              variant="outline"
              type="button"
              onClick={onClose}
              disabled={isLoadingChats || isCreatingTerminal}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={createMode === 'chat' ? onCreateChat : onCreateTerminal}
              disabled={createMode === 'chat' ? isLoadingChats : isCreatingTerminal || !newTerminalProfileId}
            >
              {createMode === 'chat' ? 'Create Chat' : 'Create Terminal'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
};
