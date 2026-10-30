import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Nudge — Pitch slide template',
  description: 'A template for the pitch "Insights" slide. Fill it only with real, consented interview quotes.',
};

const QUOTE_SLOTS = [
  'Student 1 — e.g. ADHD, 2nd-year CS',
  'Student 2 — e.g. autistic, 1st-year design',
  'Student 3 — e.g. ADHD + anxiety, final-year commerce',
  'Student 4 — e.g. AuDHD, postgraduate',
  'Student 5 — e.g. undiagnosed / self-identified',
];

const SHAPED = [
  {
    need: 'Reminders that feel like being told off (rejection sensitivity)',
    built: 'Anti-nag safeguards: at most one nudge per 20 min, “I’m fine” doubles the wait, three dismissals and Nudge rests until tomorrow.',
  },
  {
    need: 'Time slipping away unnoticed (time blindness)',
    built: 'Visual timers everywhere, optional “~30 min have passed” chips, and steps sized as tiny / small instead of minutes.',
  },
  {
    need: 'Vague advice that’s hard to act on (literal processing)',
    built: '“Clear & literal” wording: exact file names and concrete actions — no idioms or metaphors.',
  },
  {
    need: '“It’s not about effort — starting is just hard”',
    built: 'Copy rules everywhere: no pressure words, unfinished work is “saved for later”, and every attempt counts as a win.',
  },
  {
    need: 'Hyperfocus being interrupted',
    built: 'Flow is never interrupted; only a tiny, ignorable water-and-stretch chip after 90 minutes.',
  },
  {
    need: 'Can’t talk out loud in a shared room',
    built: 'Whisper mode, buttons-only mode, and typing always optional.',
  },
  {
    need: 'Sensory overload making everything harder',
    built: 'Sensory-reset and grounding cards, calm muted colours, no sounds by default.',
  },
  {
    need: 'Worry about being watched',
    built: 'Metadata only, on-device sensing, local AI by default, one-tap export and delete.',
  },
];

const QUESTIONS = [
  'Tell me about the last time you wanted to start something but couldn’t. What was going on?',
  'What has helped you get started before — even a little?',
  'When an app reminds or nudges you, how does it feel? What makes it feel okay, or not okay?',
  'How do you notice time passing while you work — or not notice it?',
  'When you need a break, what does real rest look like for you?',
  'What would you never want a tool like this to track, or to say to you?',
];

export default function InsightsPage() {
  return (
    <div className="n-rise">
      <section aria-labelledby="slide-title" className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <div className="bg-accent-soft px-6 py-8 sm:px-10 sm:py-10">
          <p className="text-sm font-bold uppercase tracking-widest text-muted">Pitch slide template · not part of the app</p>
          <h1 id="slide-title" className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            What students told us — and what it changed
          </h1>
          <p className="mt-2 max-w-2xl text-muted">
            [Template] Write here how many neurodivergent students you actually interviewed, and when — for example “Interviews with 4 students, before the event”. Only count real, consented interviews.
          </p>
        </div>

        <div className="px-6 py-6 sm:px-10">
          <div role="note" className="rounded-soft border-2 border-dashed border-calm bg-calm-soft p-4 text-ink">
            <p className="font-bold">This is a template. Nothing on this slide is a real quote yet.</p>
            <p className="text-sm">
              Replace each card with a real quote from your interviews, used with the person&apos;s consent. Please don&apos;t invent or paraphrase quotes —
              anonymise names and keep only what they agreed to share.
            </p>
          </div>

          <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {QUOTE_SLOTS.map((who, i) => (
              <li key={who} className="flex flex-col rounded-card border border-dashed border-line bg-surface2/50 p-5">
                <span aria-hidden="true" className="text-4xl leading-none text-accent">
                  “
                </span>
                <p className="mt-1 flex-1 italic text-muted">[Template: paste a real quote from {who}, word for word, only with their consent]</p>
                <p className="mt-4 text-sm font-semibold text-ink">Feature it shaped: [the feature this real quote led to]</p>
                <span className="sr-only">Placeholder {i + 1} of {QUOTE_SLOTS.length}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="shaped-title" className="n-card mt-6">
        <h2 id="shaped-title" className="n-h2">
          Needs we heard → what we built
        </h2>
        <p className="mt-1 text-sm text-muted">Link each row to the interview(s) that raised it once your quotes are in.</p>
        <ul className="mt-4 divide-y divide-line">
          {SHAPED.map((row) => (
            <li key={row.need} className="grid gap-1 py-4 md:grid-cols-[minmax(0,2fr)_auto_minmax(0,3fr)] md:items-start md:gap-4">
              <p className="font-semibold text-ink">{row.need}</p>
              <span aria-hidden="true" className="hidden text-accent md:block">
                →
              </span>
              <p className="text-ink">
                <span className="sr-only">What we built: </span>
                {row.built}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="guide-title" className="n-card mt-6">
        <h2 id="guide-title" className="n-h2">
          Interview guide
        </h2>
        <p className="mt-1 text-sm text-muted">Short, open questions. 15 minutes is plenty. Let silences sit.</p>
        <ol className="mt-4 list-inside list-decimal space-y-2 text-ink">
          {QUESTIONS.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
        <div className="mt-5 rounded-soft bg-surface2 p-4 text-sm text-ink">
          <p className="font-semibold">Before you start</p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            <li>Ask for consent to take notes and to quote them, anonymously.</li>
            <li>Offer to show them the quote before it goes on a slide.</li>
            <li>Make it easy to skip any question or stop at any time.</li>
            <li>Offer the questions in writing too — some people prefer to answer by text.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
