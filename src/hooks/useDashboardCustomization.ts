import { useState, useCallback, useEffect } from 'react';

export type DashboardModule =
  | 'insights'
  | 'mainMetrics'
  | 'kpiGerencial'
  | 'invoiceTax'
  | 'operational'
  | 'chartsCashflow'
  | 'chartsFlow'
  | 'chartsBilling'
  | 'pendingTable';

interface ModuleConfig {
  id: DashboardModule;
  label: string;
  visible: boolean;
  order: number;
  pinned: boolean;
}

// Orden por defecto: pendientes va al FONDO del dashboard (es lo más
// accionable, pero el usuario prefiere verlo después de los KPIs y charts
// — el flow es overview → detalle accionable). En mobile las cards de
// pendientes ya tienen UX optimizada, no hace falta subirlas arriba.
const DEFAULT_MODULES: ModuleConfig[] = [
  { id: 'insights', label: 'Insights de Nico', visible: true, order: 0, pinned: false },
  { id: 'mainMetrics', label: 'Métricas principales', visible: true, order: 1, pinned: false },
  { id: 'kpiGerencial', label: 'KPIs gerenciales (margen, DSO, rotación)', visible: true, order: 2, pinned: false },
  { id: 'invoiceTax', label: 'Facturación e impuestos', visible: true, order: 3, pinned: false },
  { id: 'operational', label: 'Top Clientes y Referencias', visible: true, order: 4, pinned: false },
  { id: 'chartsCashflow', label: 'Saldo en el tiempo', visible: true, order: 5, pinned: false },
  { id: 'chartsFlow', label: 'Gráficos de flujo', visible: true, order: 6, pinned: false },
  { id: 'chartsBilling', label: 'Gráficos de facturación', visible: true, order: 7, pinned: false },
  { id: 'pendingTable', label: 'Transacciones pendientes', visible: true, order: 8, pinned: false },
];

const STORAGE_KEY = 'dashboard-customization';
// Bump cuando cambia el orden por defecto. Si el storage tiene una version
// distinta, lo descartamos y aplicamos los nuevos defaults (los users que
// SÍ personalizaron antes pierden la personalización — trade-off aceptable
// para que todos vean pendientes arriba sin tener que hacer "Personalizar").
const VERSION_KEY = 'dashboard-customization-version';
// v4: se agregó el bloque kpiGerencial (margen, DSO, rotación, break-even).
const CURRENT_VERSION = '4';

function loadModules(): ModuleConfig[] {
  try {
    const storedVersion = localStorage.getItem(VERSION_KEY);
    if (storedVersion !== CURRENT_VERSION) {
      localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
      return DEFAULT_MODULES;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as ModuleConfig[];
      // Merge with defaults to handle new modules
      const map = new Map(parsed.map(m => [m.id, m]));
      return DEFAULT_MODULES.map(d => map.get(d.id) || d).sort((a, b) => a.order - b.order);
    }
  } catch {}
  return DEFAULT_MODULES;
}

export function useDashboardCustomization() {
  const [modules, setModules] = useState<ModuleConfig[]>(loadModules);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modules));
  }, [modules]);

  const toggleVisibility = useCallback((id: DashboardModule) => {
    setModules(prev => prev.map(m => m.id === id ? { ...m, visible: !m.visible } : m));
  }, []);

  const togglePin = useCallback((id: DashboardModule) => {
    setModules(prev => prev.map(m => m.id === id ? { ...m, pinned: !m.pinned } : m));
  }, []);

  const moveUp = useCallback((id: DashboardModule) => {
    setModules(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next.map((m, i) => ({ ...m, order: i }));
    });
  }, []);

  const moveDown = useCallback((id: DashboardModule) => {
    setModules(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next.map((m, i) => ({ ...m, order: i }));
    });
  }, []);

  const resetDefaults = useCallback(() => {
    setModules(DEFAULT_MODULES);
  }, []);

  const isVisible = useCallback((id: DashboardModule) => {
    return modules.find(m => m.id === id)?.visible ?? true;
  }, [modules]);

  return { modules, toggleVisibility, togglePin, moveUp, moveDown, resetDefaults, isVisible };
}
