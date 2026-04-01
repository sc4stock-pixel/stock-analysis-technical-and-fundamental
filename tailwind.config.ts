import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: "#0a0e1a",
          card: "#0f1629",
          border: "#1e2d4a",
          accent: "#00d4ff",
          green: "#00ff88",
          red: "#ff4757",
          amber: "#ffa502",
          muted: "#4a6080",
          text: "#c8d8f0",
          dim: "#6b85a0",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
