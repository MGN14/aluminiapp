// Persistent guided-tour state.
//
// The tour is triggered from the onboarding flow (Step10Tour) and then rides
// alongside the user across the real app via <TourOverlay />. Survives
// navigation / reload because we persist to localStorage.

import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'aluminia.tour.v1';
const EVENT_NAME = 'aluminia:tour-change';

export interface TourState {
  active: boolean;
  stopIdx: number;       // 0-based index into TOUR_STOPS
  minimized: boolean;
  startedAt?: string;
}

const DEFAULT: TourState = {
  active: false,
  stopIdx: 0,
  minimized: false,
};

function readRaw(): TourState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw);
    return {
      active: !!parsed.active,
      stopIdx: typeof parsed.stopIdx === 'number' ? parsed.stopIdx : 0,
      minimized: !!parsed.minimized,
      startedAt: parsed.startedAt,
    };
  } catch {
    return DEFAULT;
  }
}

function writeRaw(state: TourState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  // Notify same-tab listeners (storage event only fires on OTHER tabs).
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function getTourState(): TourState {
  return readRaw();
}

export function startTour() {
  writeRaw({
    active: true,
    stopIdx: 0,
    minimized: false,
    startedAt: new Date().toISOString(),
  });
}

export function jumpToStop(idx: number) {
  const cur = readRaw();
  writeRaw({ ...cur, active: true, stopIdx: idx, minimized: false });
}

export function advanceTour() {
  const cur = readRaw();
  writeRaw({ ...cur, stopIdx: cur.stopIdx + 1, minimized: false });
}

export function setMinimized(minimized: boolean) {
  const cur = readRaw();
  writeRaw({ ...cur, minimized });
}

export function endTour() {
  writeRaw({ ...DEFAULT, active: false });
}

/** React hook that re-renders whenever tour state changes. */
export function useTourState(): TourState {
  const [state, setState] = useState<TourState>(() => readRaw());

  const sync = useCallback(() => {
    setState(readRaw());
  }, []);

  useEffect(() => {
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener('storage', sync); // other-tab updates
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener('storage', sync);
    };
  }, [sync]);

  return state;
}
