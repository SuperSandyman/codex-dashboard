/**
 * ダッシュボードのトップレベル表示モード。
 */
export type AppView = 'chat' | 'terminal' | 'editor';

/**
 * 新規セッション作成ダイアログのモード。
 */
export type CreateMode = 'chat' | 'terminal';

/**
 * モバイル時のスワイプ方向。
 */
export type SwipeDirection = 'left' | 'right';

/**
 * ワークベンチタブの種類。
 */
export type WorkbenchTabKind = 'terminal' | 'editor';

/**
 * ワークベンチ上に表示するタブ情報。
 */
export interface WorkbenchTab {
  readonly id: string;
  readonly kind: WorkbenchTabKind;
  readonly resourceId: string;
}

/**
 * 一時通知の表示内容。
 */
export interface ToastState {
  readonly message: string;
}
