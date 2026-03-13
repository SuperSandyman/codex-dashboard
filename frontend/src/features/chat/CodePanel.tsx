import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface CodePanelProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly contentClassName?: string;
}

/**
 * chat まわりで使うコード表示用の共通パネル。
 * @param props 表示内容と追加スタイル
 * @returns 統一されたコード表示パネル
 */
export const CodePanel = ({ children, className, contentClassName }: CodePanelProps) => {
  return (
    <div className={cn('rounded-md border border-white/10 bg-black/25 px-3.5 py-3', className)}>
      <pre className={cn('m-0 max-h-72 overflow-auto text-xs text-[#d4d4d4]', contentClassName)}>
        <code>{children}</code>
      </pre>
    </div>
  );
};
