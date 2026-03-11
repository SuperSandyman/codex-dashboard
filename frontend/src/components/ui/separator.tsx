import { cn } from '@/lib/utils';

interface SeparatorProps {
  readonly className?: string;
}

/**
 * 水平区切り線。
 * @param props className
 */
export const Separator = ({ className }: SeparatorProps) => {
  return <div aria-hidden className={cn('h-px w-full bg-border/80', className)} />;
};

