import { useRef, type TouchEvent } from 'react';

import type { SwipeDirection } from './types';

const MIN_SWIPE_DISTANCE_PX = 48;
const MAX_SWIPE_VERTICAL_DRIFT_PX = 72;

interface SwipeStartPoint {
  readonly x: number;
  readonly y: number;
}

interface UseMobileViewSwitcherOptions {
  readonly mediaQuery: string;
  readonly onSwipe: (direction: SwipeDirection) => void;
}

interface MobileViewSwitcherHandlers {
  readonly onTouchStart: (event: TouchEvent<HTMLElement>) => void;
  readonly onTouchEnd: (event: TouchEvent<HTMLElement>) => void;
}

/**
 * モバイル時の左右スワイプ検知をまとめて扱う。
 * @param options 判定に使う media query とスワイプ時コールバック
 * @returns touch start / end ハンドラ
 */
export const useMobileViewSwitcher = (
  options: UseMobileViewSwitcherOptions,
): MobileViewSwitcherHandlers => {
  const { mediaQuery, onSwipe } = options;
  const touchStartRef = useRef<SwipeStartPoint | null>(null);

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.changedTouches[0];
    if (!touch) {
      touchStartRef.current = null;
      return;
    }

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    if (!window.matchMedia(mediaQuery).matches) {
      touchStartRef.current = null;
      return;
    }

    const startPoint = touchStartRef.current;
    touchStartRef.current = null;
    if (!startPoint) {
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }

    const deltaX = touch.clientX - startPoint.x;
    const deltaY = touch.clientY - startPoint.y;
    if (Math.abs(deltaX) < MIN_SWIPE_DISTANCE_PX) {
      return;
    }
    if (Math.abs(deltaY) > MAX_SWIPE_VERTICAL_DRIFT_PX || Math.abs(deltaY) > Math.abs(deltaX)) {
      return;
    }

    onSwipe(deltaX < 0 ? 'left' : 'right');
  };

  return {
    onTouchStart: handleTouchStart,
    onTouchEnd: handleTouchEnd,
  };
};
