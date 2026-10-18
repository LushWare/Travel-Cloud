/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      maxWidth: {
        '7xl': '84rem',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Poppins', 'sans-serif'],
        poppins: ['Poppins', 'sans-serif'],
        cursive: ['Caveat', 'cursive'],
      },
      colors: {
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          forest: '#164E3F',
          forestDark: '#0D382D',
          forestHover: '#114034',
          vibrant: '#10B981',
          accent: '#15803D',
          mint: '#ECFDF5',
          mintLight: '#F4FAF6',
          softBg: '#F8FAF8',
        },
      },
      boxShadow: {
        glow: '0 20px 40px -15px rgba(22, 78, 63, 0.25)',
        card: '0 10px 30px -5px rgba(0, 0, 0, 0.05)',
        device: '0 25px 60px -12px rgba(15, 23, 42, 0.25)',
      },
    },
  },
  plugins: [],
};
