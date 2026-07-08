/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: {
    relative: true,
    files: ['./index.html', './src/**/*.{js,jsx}'],
  },
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // opendesign token 直引层（frontend-react/src/styles.css @import 的
        // opendesign/design-systems/tech-minimal-product/tokens/colors_and_type.css）。
        // 注意：var() 直引不支持透明度修饰符（bg-ink/50 无效），半透明请用阴影或内置色。
        ink: 'var(--accent-primary)',
        'ink-strong': 'var(--accent-primary-strong)',
        signal: 'var(--accent-secondary)',
        page: 'var(--page-bg)',
        'surface-1': 'var(--surface-primary)',
        'surface-2': 'var(--surface-secondary)',
        'surface-hover': 'var(--surface-hover)',
        'fg-1': 'var(--text-primary)',
        'fg-2': 'var(--text-secondary)',
        'fg-3': 'var(--text-muted)',
        'line-1': 'var(--border-subtle)',
        'line-2': 'var(--line-2)',
        warn: 'var(--status-warning)',
        danger: 'var(--status-danger)',
        success: 'var(--status-success)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};
