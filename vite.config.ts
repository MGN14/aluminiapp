import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";
import fs from "fs";

// Build version = timestamp del build. Se inyecta en el bundle vía
// __APP_VERSION__ y se escribe en dist/version.json. El runtime polea
// el .json cada 5 min y compara — si cambia, muestra banner "Recargar".
// Sin esto, los colaboradores no recibían los pushes de Vercel hasta que
// el browser invalidaba el cache por su cuenta (a veces nunca).
const BUILD_VERSION = String(Date.now());

// Plugin que escribe public/version.json al final del build, para que
// Vercel lo sirva desde el dominio. Lo metemos en `public` (no `dist`)
// porque Vite copia public/ tal cual al output.
function writeVersionFile() {
  return {
    name: "write-version-file",
    apply: "build" as const,
    closeBundle() {
      const distDir = path.resolve(__dirname, "dist");
      try {
        if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
        fs.writeFileSync(
          path.join(distDir, "version.json"),
          JSON.stringify({ version: BUILD_VERSION }),
        );
      } catch (err) {
        // No fallar el build si esto rompe — el banner deja de funcionar pero
        // la app sigue.
        // eslint-disable-next-line no-console
        console.warn("[writeVersionFile] failed:", err);
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  define: {
    __APP_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    writeVersionFile(),
    // Source maps upload to Sentry (only when SENTRY_AUTH_TOKEN is set — CI/Vercel)
    process.env.SENTRY_AUTH_TOKEN &&
      sentryVitePlugin({
        org: "aluminia",
        project: "javascript-react",
        authToken: process.env.SENTRY_AUTH_TOKEN,
        sourcemaps: {
          filesToDeleteAfterUpload: ["./dist/**/*.map"],
        },
        telemetry: false,
      }),
  ],
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
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "icons": ["lucide-react"],
          "radix": [
            "@radix-ui/react-accordion",
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-avatar",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-collapsible",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-label",
            "@radix-ui/react-popover",
            "@radix-ui/react-progress",
            "@radix-ui/react-radio-group",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-select",
            "@radix-ui/react-separator",
            "@radix-ui/react-slider",
            "@radix-ui/react-slot",
            "@radix-ui/react-switch",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast",
            "@radix-ui/react-toggle",
            "@radix-ui/react-toggle-group",
            "@radix-ui/react-tooltip",
          ],
          "supabase": ["@supabase/supabase-js"],
          "forms": ["zod"],
          "query": ["@tanstack/react-query"],
        },
      },
    },
  },
}));
