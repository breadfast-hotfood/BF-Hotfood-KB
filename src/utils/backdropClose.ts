import { useRef } from 'react';
import type React from 'react';

/**
 * Click-outside-to-close for modal windows.
 * The modal wrapper covers the whole screen, so a click on the empty area lands on the wrapper itself.
 * We close only when BOTH the mouse press and the click happened on the wrapper itself, so:
 *  - clicking inside the card never closes it (the target is a child of the wrapper),
 *  - pressing inside the card and releasing outside (for example while selecting text) does not close it.
 */
export function shouldCloseOnBackdrop(downTarget: unknown, clickTarget: unknown, wrapper: unknown): boolean {
  return downTarget === wrapper && clickTarget === wrapper;
}

export function useBackdropClose(onClose: () => void) {
  const downTarget = useRef<EventTarget | null>(null);
  return {
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
      downTarget.current = e.target;
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      const close = shouldCloseOnBackdrop(downTarget.current, e.target, e.currentTarget);
      downTarget.current = null;
      if (close) onClose();
    },
  };
}
