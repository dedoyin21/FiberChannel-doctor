import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#f5efe2',
        ink: '#1d2a2a',
        fog: '#d8d3c5',
        pine: '#21574f',
        ember: '#d46a3b',
        ocean: '#0f7b8c',
        cream: '#fffaf0',
      },
      boxShadow: {
        card: '0 18px 60px rgba(24, 41, 39, 0.12)',
      },
      backgroundImage: {
        grid: 'radial-gradient(circle at 1px 1px, rgba(33, 87, 79, 0.08) 1px, transparent 0)',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui'],
        body: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular'],
      },
    },
  },
  plugins: [],
} satisfies Config
