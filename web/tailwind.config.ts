import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#fff7ec',
        carbon: '#17131c',
        smoke: '#e8dcc9',
        signal: '#dd5c33',
        lagoon: '#0e7bff',
        gold: '#c69821',
        plum: '#5d2f86',
        chalk: '#fffdf8',
      },
      boxShadow: {
        card: '0 18px 60px rgba(23, 19, 28, 0.12)',
      },
      backgroundImage: {
        dots: 'radial-gradient(circle at 1px 1px, rgba(221, 92, 51, 0.14) 1px, transparent 0)',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui'],
        body: ['"Manrope"', 'ui-sans-serif', 'system-ui'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular'],
      },
    },
  },
  plugins: [],
} satisfies Config
