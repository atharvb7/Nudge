import type { Metadata, Viewport } from 'next';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/lexend/400.css';
import '@fontsource/lexend/600.css';
import '@nudge/shared/tokens.css';
import './globals.css';
import { NudgeProvider } from '@/lib/nudge-context';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Nudge — your dashboard',
  description: 'A gentle, privacy-first executive-function companion. Everything here stays in your browser.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f5f1' },
    { media: '(prefers-color-scheme: dark)', color: '#181c1b' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NudgeProvider>
          <AppShell>{children}</AppShell>
        </NudgeProvider>
      </body>
    </html>
  );
}
