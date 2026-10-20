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
        // Brand — Party/DJ pink scale (replaces the former violet)
        brand: {
          50:  '#FFE5F1',
          100: '#FFC2DE',
          200: '#FF9BC8',
          300: '#FF74B3',
          400: '#FF4DA0',
          500: '#FF2D8D',
          600: '#E9207C',
          700: '#C21868',
          800: '#8F124B',
          900: '#5C0C31',
        },
        // Party/DJ identity palette
        party: {
          bg:       '#0A0A0D',
          surface:  '#15151B',
          surface2: '#1C1C23',
          pink:     '#FF2D8D',
          'pink-hover': '#E9207C',
          yellow:   '#F4FF3A',
          ink:      '#F8F8FA',
          muted:    '#9A9AA3',
          border:   '#2A2A33',
          success:  '#43E08D',
          danger:   '#FF5C75',
        },
        // Tailwind "purple" is remapped to the brand pink so legacy utilities follow the new identity
        purple: {
          50:  '#FFE5F1',
          100: '#FFC2DE',
          200: '#FF9BC8',
          300: '#FF74B3',
          400: '#FF4DA0',
          500: '#FF2D8D',
          600: '#E9207C',
          700: '#C21868',
          800: '#8F124B',
          900: '#5C0C31',
        },
        // Neon accents
        neon: {
          purple: '#FF2D8D',
          pink:   '#ec4899',
          cyan:   '#22d3ee',
          green:  '#4ade80',
        },
        // Dark surface palette
        surface: {
          50:  '#1C1C23',
          100: '#15151B',
          200: '#2A2A33',
          300: '#0F0F14',
          400: '#0A0A0D',
          500: '#050508',
        },
        // Glass
        glass: {
          white: 'rgba(255,255,255,0.05)',
          border: 'rgba(255,255,255,0.08)',
        },
        // Wedding admin (dashboard) palette — light pink platform theme
        wd: {
          pink:    '#F06A9B',
          'pink-hover': '#E8538A',
          bg:      '#FFF7FA',
          active:  '#FCE8F0',
          border:  '#F3D7E1',
          ink:     '#1F2028',
          muted:   '#85858C',
        },
        // Wedding Edition palette — romantic red/blush/taupe
        wedding: {
          ivory:     '#FFFDFB',  // page background (warm white)
          card:      '#F7F4F3',  // card interior (light gray)
          border:    '#E8B7C8',  // rose border
          champagne: '#E8B7C8',  // rose (alias)
          gold:      '#8F1D2C',  // elegant red (primary)
          'gold-soft': '#FBEAF0', // pale pink
          'gold-deep': '#741625', // primary hover
          blush:     '#FBEAF0',  // pale pink
          taupe:     '#B8A89A',
          'taupe-light': '#E8DED6',
          sage:      '#A7B8A1',
          night:     '#101827',
          ink:       '#2B2424',
          muted:     '#6F6260',
        },
      },
      backgroundImage: {
        'gradient-radial':   'radial-gradient(var(--tw-gradient-stops))',
        'gradient-hero':     'linear-gradient(180deg, #0A0A0D 0%, #15151B 100%)',
        'gradient-brand':    'linear-gradient(135deg, #FF2D8D, #E9207C)',
        'gradient-card':     'linear-gradient(135deg, rgba(255,45,141,0.10), rgba(255,45,141,0.03))',
        'gradient-wedding':  'linear-gradient(180deg, #FFFDFB 0%, #FBEAF0 45%, #E8DED6 100%)',
        'gradient-wedding-card': 'linear-gradient(140deg, rgba(255,255,255,0.85), rgba(245,215,161,0.18))',
        'noise':             "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E\")",
      },
      fontFamily: {
        sans:    ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-mono)', 'monospace'],
        album:   ['var(--font-fraunces)', 'Fraunces', 'Georgia', 'serif'],
        wedding: ['var(--font-cormorant)', 'Cormorant Garamond', 'Didot', 'Georgia', 'serif'],
        'wedding-playfair': ['var(--font-playfair)', 'Playfair Display', 'serif'],
        'wedding-great-vibes': ['var(--font-great-vibes)', 'Great Vibes', 'cursive'],
        'wedding-dancing': ['var(--font-dancing-script)', 'Dancing Script', 'cursive'],
        'wedding-cinzel': ['var(--font-cinzel)', 'Cinzel', 'serif'],
        'wedding-tangerine': ['var(--font-tangerine)', 'Tangerine', 'cursive'],
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
        'neon-purple': '0 0 14px rgba(255,45,141,0.35)',
        'neon-pink':   '0 0 14px rgba(255,45,141,0.35)',
        'neon-cyan':   '0 0 20px rgba(34,211,238,0.5), 0 0 60px rgba(34,211,238,0.2)',
        'glass':       '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        'card':        '0 4px 24px rgba(0,0,0,0.3)',
        'wedding':     '0 4px 16px rgba(143,29,44,0.06), 0 1px 3px rgba(143,29,44,0.04)',
        'wedding-lg':  '0 12px 32px rgba(143,29,44,0.08), 0 2px 6px rgba(143,29,44,0.06)',
      },
    },
  },
  plugins: [],
}

export default config
