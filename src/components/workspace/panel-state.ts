'use client';

/**
 * Open/closed state for the two workspace panels (the side nav and the chat
 * drawer), read through useSyncExternalStore rather than an effect that calls
 * setState.
 *
 * Wide windows remember the choice in localStorage, so closing a panel once
 * keeps it closed across routes. Narrow windows do not: there the panels
 * overlay the page, so each one starts closed on every load and a phone never
 * opens onto a page covered by a drawer it did not ask for.
 */
import { useSyncExternalStore } from 'react';

export const NARROW_QUERY = '(max-width: 900px)';

type Store = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => boolean;
  getServerSnapshot: () => boolean;
  set: (open: boolean) => void;
};

const stores = new Map<string, Store>();

function isNarrow() {
  return typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches;
}

function createStore(key: string, defaultOpen: boolean): Store {
  let listeners: (() => void)[] = [];
  let narrowOpen = false;
  const notify = () => listeners.forEach((l) => l());

  return {
    subscribe(listener) {
      listeners.push(listener);
      const media = window.matchMedia(NARROW_QUERY);
      const onChange = () => {
        narrowOpen = false;
        listener();
      };
      media.addEventListener('change', onChange);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
        media.removeEventListener('change', onChange);
      };
    },
    getSnapshot() {
      if (isNarrow()) return narrowOpen;
      try {
        const stored = localStorage.getItem(key);
        return stored === null ? defaultOpen : stored === 'open';
      } catch {
        return defaultOpen;
      }
    },
    /** Closed during SSR and hydration; the real value applies immediately after. */
    getServerSnapshot() {
      return false;
    },
    set(open) {
      if (isNarrow()) {
        narrowOpen = open;
      } else {
        try {
          localStorage.setItem(key, open ? 'open' : 'closed');
        } catch {
          /* Private window, or storage blocked. The panel still works, it just forgets. */
        }
      }
      notify();
    },
  };
}

export function usePanelState(key: string, defaultOpen: boolean): [boolean, (open: boolean) => void] {
  let store = stores.get(key);
  if (!store) {
    store = createStore(key, defaultOpen);
    stores.set(key, store);
  }
  const open = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return [open, store.set];
}
