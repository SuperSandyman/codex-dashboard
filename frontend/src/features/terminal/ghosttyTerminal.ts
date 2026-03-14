import { FitAddon, init as initGhostty, Terminal } from 'ghostty-web';

interface GhosttyTerminalResize {
  readonly cols: number;
  readonly rows: number;
}

interface CreateGhosttyTerminalSessionOptions {
  readonly container: HTMLElement;
  readonly onData: (data: string) => void;
  readonly onResize: (size: GhosttyTerminalResize) => void;
}

interface GhosttyTerminalSession {
  readonly terminal: Terminal;
  readonly fitAddon: FitAddon;
  dispose: () => void;
}

let ghosttyInitPromise: Promise<void> | null = null;

const ensureGhosttyReady = async (): Promise<void> => {
  ghosttyInitPromise ??= initGhostty();
  await ghosttyInitPromise;
};

/**
 * ghostty-web の初期化を 1 回だけ行い、接続済み terminal session を返す。
 * @param options mount 先要素と入出力イベントの購読処理
 * @returns 描画・fit・dispose をまとめた session
 * @throws WASM 読み込みや terminal 初期化に失敗した場合
 */
export const createGhosttyTerminalSession = async ({
  container,
  onData,
  onResize,
}: CreateGhosttyTerminalSessionOptions): Promise<GhosttyTerminalSession> => {
  await ensureGhosttyReady();

  const terminal = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily:
      '\'Hack Nerd Font Mono\', \'Hack Nerd Mono\', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace',
    fontSize: 13,
    theme: {
      background: '#09090b',
    },
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  fitAddon.fit();
  fitAddon.observeResize();

  const dataDisposable = terminal.onData(onData);
  const resizeDisposable = terminal.onResize(onResize);

  return {
    terminal,
    fitAddon,
    dispose: () => {
      resizeDisposable.dispose();
      dataDisposable.dispose();
      fitAddon.dispose();
      terminal.dispose();
    },
  };
};
