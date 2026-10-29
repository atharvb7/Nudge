import { CHECKIN_OPTIONS, copy, type WordingStyle } from '@nudge/shared';
import type { OverlaySpec } from '../lib/messages';

// Builders for every in-page overlay. Wording-style aware; calm and short.

let n = 0;
const id = (p: string) => `${p}_${Date.now().toString(36)}_${n++}`;

export function stuckNudge(style: WordingStyle): OverlaySpec {
  return {
    id: id('nudge'),
    variant: 'nudge',
    text: copy(style, 'nudgeText'),
    buttons: [
      { id: 'help', label: copy(style, 'nudgeHelp'), primary: true },
      { id: 'break', label: copy(style, 'nudgeBreak') },
      { id: 'fine', label: copy(style, 'nudgeFine') },
    ],
  };
}

export function depletedNudge(style: WordingStyle): OverlaySpec {
  return {
    id: id('nudge'),
    variant: 'nudge',
    text:
      style === 'literal'
        ? 'You have been working for a long time. Do you want to take a break?'
        : "You've been at it a while. Rest might feel good — or one tiny thing. Your call.",
    buttons: [
      { id: 'break', label: copy(style, 'nudgeBreak'), primary: true },
      { id: 'help', label: style === 'literal' ? 'Help me start' : 'One tiny thing' },
      { id: 'fine', label: copy(style, 'nudgeFine') },
    ],
  };
}

export function wakeNudge(style: WordingStyle): OverlaySpec {
  return {
    id: id('nudge'),
    variant: 'nudge',
    text: style === 'literal' ? 'Nudge heard you. Do you want help starting?' : "I'm here — want help starting?",
    buttons: [
      { id: 'help', label: copy(style, 'nudgeHelp'), primary: true },
      { id: 'dismiss', label: 'Not now' },
    ],
  };
}

export function hydrationChip(style: WordingStyle): OverlaySpec {
  return {
    id: id('chip'),
    variant: 'chip',
    text: copy(style, 'hydration'),
    buttons: [{ id: 'dismiss', label: 'Thanks', aria: 'Dismiss this reminder' }],
    autoFadeMs: 20_000,
  };
}

export function restuckChip(style: WordingStyle): OverlaySpec {
  return {
    id: id('chip'),
    variant: 'chip',
    text: copy(style, 'restuckQ'),
    buttons: [
      { id: 'still_going', label: copy(style, 'stillGoing'), primary: true },
      { id: 'stuck_again', label: copy(style, 'stuckAgain') },
      { id: 'taking_break', label: copy(style, 'takingBreak') },
    ],
    autoFadeMs: 60_000,
  };
}

export function longBreakChip(style: WordingStyle): OverlaySpec {
  return {
    id: id('chip'),
    variant: 'chip',
    text: copy(style, 'longBreakQ'),
    buttons: [
      { id: 'come_back', label: style === 'literal' ? 'Continue' : 'Come back', primary: true },
      { id: 'call_it_day', label: 'Call it a day' },
      { id: 'dismiss', label: 'Not yet', aria: 'Keep resting' },
    ],
  };
}

export function timeAnchorChip(minutes: number): OverlaySpec {
  return {
    id: id('chip'),
    variant: 'chip',
    text: `~${minutes} min have passed`,
    buttons: [{ id: 'dismiss', label: 'Okay', aria: 'Dismiss time note' }],
    autoFadeMs: 12_000,
  };
}

export function checkinChip(style: WordingStyle): OverlaySpec {
  return {
    id: id('chip'),
    variant: 'chip',
    text: copy(style, 'checkinQ'),
    sub: 'One tap. It helps me learn your rhythm.',
    buttons: CHECKIN_OPTIONS.map((o) => ({ id: 'checkin' as const, label: `${o.emoji} ${o.label}`, value: o.value, aria: `Today felt ${o.label}` })),
    autoFadeMs: 90_000,
  };
}
