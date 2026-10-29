// Small, opt-in, unlockable themes for wins. Never streak-based and never lost
// through inactivity: unlocks depend only on the total number of attempts ever.

export interface Theme {
  id: string;
  name: string;
  unlockAt: number; // total wins (attempts count!)
  accent: string;
  soft: string;
  description: string;
}

export const THEMES: Theme[] = [
  { id: 'meadow', name: 'Meadow', unlockAt: 0, accent: '#5b8a72', soft: '#e7f0ea', description: 'Calm sage greens.' },
  { id: 'dusk', name: 'Dusk', unlockAt: 5, accent: '#7a6aa8', soft: '#ece8f5', description: 'Soft lavender evening.' },
  { id: 'tide', name: 'Tide', unlockAt: 12, accent: '#4f7f99', soft: '#e4eef3', description: 'Quiet sea blues.' },
  { id: 'clay', name: 'Clay', unlockAt: 25, accent: '#a07656', soft: '#f3ebe4', description: 'Warm, earthy sand.' },
  { id: 'moss', name: 'Moss', unlockAt: 40, accent: '#6b7d4a', soft: '#eef0e4', description: 'Deep forest calm.' },
];

export const WIN_SOUNDS = [
  { id: 'chime', name: 'Soft chime', unlockAt: 3 },
  { id: 'wood', name: 'Wood block', unlockAt: 10 },
  { id: 'bell', name: 'Tiny bell', unlockAt: 20 },
];

export function unlockedFor(totalWins: number): string[] {
  return THEMES.filter((t) => totalWins >= t.unlockAt).map((t) => t.id);
}
