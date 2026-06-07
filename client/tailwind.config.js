/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#ff6b35',
        'accent-light': '#fff0eb',
        bg: '#f8f7f5',
        surface: {
          DEFAULT: '#ffffff',
          elevated: '#f0ede9',
          hover: '#e8e3dd',
        },
        border: '#e2dcd5',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
