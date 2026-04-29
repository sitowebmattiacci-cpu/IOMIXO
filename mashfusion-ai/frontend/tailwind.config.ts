import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand
        brand: {
          50:  '#f0e7ff',
          100: '#d9c4ff',
          200: '#b896ff',
          300: '#9666ff',
          400: '#7c3aed',
          500: '#6d28d9',
          600: '#5b21b6',
          700: '#4c1d95',
          800: '#3b1577',
          900: '#2c0e5e',
        },
        // Neon accents
        neon: {
          purple: '#a855f7',
          pink:   '#ec4899',
          cyan:   '#22d3ee',
          green:  '#4ade80',
        },
        // Dark surface palette
        surface: {
          50:  '#1a1a2e',
          100: '#16213e',
          200: '#0f3460',
          300: '#0d0d1a',
          400: '#080810',
          500: '#050508',
        },
        // Glass
        glass: {
          white: 'rgba(255,255,255,0.05)',
          border: 'rgba(255,255,255,0.08)',
        },
      },
      backgroundImage: {
        'gradient-radial':   'radial-gradient(var(--tw-gradient-stops))',
        'gradient-hero':     'linear-gradient(135deg, #0f0f23 0%, #1a0a2e 50%, #0a1628 100%)',
        'gradient-brand':    'linear-gradient(135deg, #7c3aed, #ec4899, #22d3ee)',
        'gradient-card':     'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(236,72,153,0.08))',
        'noise':             "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E\")",
      },
      fontFamily: {
        sans:  ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono:  ['var(--font-mono)', 'monospace'],
      },
      animation: {
        'pulse-slow':     'pulse 4s ease-in-out infinite',
        'float':          'float 6s ease-in-out infinite',
        'glow':           'glow 2s ease-in-out infinite alternate',
        'scan':           'scan 3s linear infinite',
        'waveform':       'waveform 1.2s ease-in-out infinite',
        'shimmer':        'shimmer 2s linear infinite',
        'spin-slow':      'spin 8s linear infinite',
        'fade-in':        'fadeIn 0.5s ease-out',
        'slide-up':       'slideUp 0.4s ease-out',
        'bounce-subtle':  'bounceSubtle 2s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%':   { boxShadow: '0 0 20px rgba(124,58,237,0.3)' },
          '100%': { boxShadow: '0 0 40px rgba(124,58,237,0.8), 0 0 80px rgba(236,72,153,0.4)' },
        },
        scan: {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        waveform: {
          '0%, 100%': { scaleY: '0.3' },
          '50%':      { scaleY: '1' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
        bounceSubtle: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-4px)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'neon-purple': '0 0 20px rgba(124,58,237,0.5), 0 0 60px rgba(124,58,237,0.2)',
        'neon-pink':   '0 0 20px rgba(236,72,153,0.5), 0 0 60px rgba(236,72,153,0.2)',
        'neon-cyan':   '0 0 20px rgba(34,211,238,0.5), 0 0 60px rgba(34,211,238,0.2)',
        'glass':       '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        'card':        '0 4px 24px rgba(0,0,0,0.3)',
      },
    },
  },
  plugins: [],
}

export default config
