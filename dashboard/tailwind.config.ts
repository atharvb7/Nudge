import type { Config } from 'tailwindcss';

const v = (name: string) => `var(--n-${name})`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        surface2: v('surface-2'),
        line: v('border'),
        ink: v('text'),
        muted: v('text-muted'),
        accent: v('accent'),
        'accent-soft': v('accent-soft'),
        'accent-ink': v('accent-text'),
        calm: v('calm'),
        'calm-soft': v('calm-soft'),
        sun: v('sun'),
        'sun-soft': v('sun-soft'),
        focus: v('focus'),
      },
      fontFamily: { sans: ['var(--n-font)'] },
      borderRadius: { card: v('radius'), soft: v('radius-sm') },
      boxShadow: { card: v('shadow') },
      minHeight: { tap: v('tap') },
      minWidth: { tap: v('tap') },
    },
  },
  plugins: [],
};
export default config;
