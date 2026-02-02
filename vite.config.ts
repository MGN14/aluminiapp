import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Prevent loading multiple copies of React (common cause of "Invalid hook call")
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    // Help Vite prebundle React consistently across dependencies
    include: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
  },
}));
