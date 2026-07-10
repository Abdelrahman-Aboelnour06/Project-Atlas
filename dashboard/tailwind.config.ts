import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // "Wayfinding" palette — Atlas's own dashboard practices the
        // legibility/contrast principles the product exists to enforce
        // on other sites. Named tokens, not raw hexes, throughout the UI.
        ink: '#101828',
        paper: '#F5F7FA',
        panel: '#FFFFFF',
        line: '#E2E6EC',
        muted: '#5B6472',
        compass: {
          DEFAULT: '#2F5DE3',
          dim: '#E8EDFC',
          deep: '#1E3FA0',
        },
        amber: {
          DEFAULT: '#D98E04',
          dim: '#FBF0DA',
        },
        ok: '#1F9254',
        danger: '#C0392B',
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
      },
    },
  },
  plugins: [],
}
export default config
