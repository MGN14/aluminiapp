// ErrorBoundary para rutas lazy.
//
// Detecta dos clases de fallos:
//   1. ChunkLoadError / "Loading chunk X failed" — pasa cuando el navegador
//      tiene en caché un index.html viejo que apunta a /assets/foo-abc123.js
//      pero después de un deploy esos hashes ya no existen. Sin handler →
//      pantalla en blanco al navegar entre módulos. Con handler → recargamos
//      la página automáticamente para que pida los nuevos assets.
//   2. Cualquier otro error en una página lazy: mostramos un fallback con
//      botón "Reintentar" en vez de pantalla en blanco.

import { Component, ReactNode } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
  reloading: boolean;
}

function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  if (e.name === 'ChunkLoadError') return true;
  const msg = e.message ?? '';
  return /Loading chunk [\w-]+ failed/i.test(msg)
    || /Failed to fetch dynamically imported module/i.test(msg)
    || /Importing a module script failed/i.test(msg);
}

export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, isChunkError: false, reloading: false };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      isChunkError: isChunkLoadError(error),
      reloading: false,
    };
  }

  componentDidCatch(error: Error) {
    // Si es un chunk viejo en caché, recargamos automáticamente — el browser
    // pedirá el index.html fresco con los hashes nuevos. Una sola vez para
    // evitar bucles si por alguna razón el reload no resuelve el problema
    // (sessionStorage como guardia).
    if (isChunkLoadError(error)) {
      const KEY = 'aluminia_chunk_reload_attempt';
      const already = sessionStorage.getItem(KEY);
      if (!already) {
        sessionStorage.setItem(KEY, String(Date.now()));
        this.setState({ reloading: true });
        window.location.reload();
        return;
      }
      // Si ya intentamos reload y volvió a fallar → no hacemos auto-reload
      // de nuevo, mostramos UI con botón manual.
    }
    // Log para Sentry/console — útil en producción.

    console.error('[RouteErrorBoundary]', error);
  }

  handleRetry = () => {
    sessionStorage.removeItem('aluminia_chunk_reload_attempt');
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.state.reloading) {
      return (
        <div className="flex h-screen w-full items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-slate-500">
            <RefreshCw className="h-6 w-6 animate-spin" />
            <span className="text-sm">Actualizando a la última versión…</span>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-screen w-full items-center justify-center px-6">
        <div className="max-w-md w-full text-center flex flex-col items-center gap-4">
          <AlertCircle className="h-10 w-10 text-amber-500" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {this.state.isChunkError
                ? 'Hay una versión más nueva disponible'
                : 'Algo no cargó como debería'}
            </h2>
            <p className="text-sm text-slate-500 mt-1.5">
              {this.state.isChunkError
                ? 'Esta pestaña tiene una versión vieja de la app. Recargá para traer la última.'
                : 'Probá recargar la página. Si el problema persiste, avisanos.'}
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Recargar
          </button>
        </div>
      </div>
    );
  }
}
