import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * カード外枠コンテナ。
 * @param props className と子要素
 */
export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return <div className={cn('rounded-xl border border-border/70 bg-card/90 text-card-foreground', className)} {...props} />;
};

/**
 * カードヘッダ領域。
 * @param props className と子要素
 */
export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return <div className={cn('flex flex-col gap-1.5 p-4', className)} {...props} />;
};

/**
 * カードタイトル。
 * @param props className と子要素
 */
export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
  return <h3 className={cn('font-semibold leading-none tracking-tight', className)} {...props} />;
};

/**
 * カード説明文。
 * @param props className と子要素
 */
export const CardDescription = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
};

/**
 * カード本体領域。
 * @param props className と子要素
 */
export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return <div className={cn('p-4 pt-0', className)} {...props} />;
};

/**
 * カードフッタ領域。
 * @param props className と子要素
 */
export const CardFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return <div className={cn('flex items-center gap-2 p-4 pt-0', className)} {...props} />;
};

