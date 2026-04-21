import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useSubscription } from '@/hooks/useSubscription';

type ModuleMode = 'dian' | 'gerencial';

interface ModuleContextValue {
  mode: ModuleMode;
  setMode: (mode: ModuleMode) => void;
  isDian: boolean;
  isGerencial: boolean;
}

const ModuleContext = createContext<ModuleContextValue | undefined>(undefined);

export function ModuleProvider({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useSubscription();

  const [mode, setModeState] = useState<ModuleMode>(() => {
    const saved = localStorage.getItem('aluminia_module_mode');
    return (saved === 'gerencial' ? 'gerencial' : 'dian') as ModuleMode;
  });

  // Safety net: if the user is not admin (e.g. collaborator, regular user, or
  // someone who lost the admin role), force mode back to 'dian'. This protects
  // against stale localStorage values carried over from a previous admin login.
  useEffect(() => {
    if (loading) return;
    if (!isAdmin && mode === 'gerencial') {
      localStorage.setItem('aluminia_module_mode', 'dian');
      setModeState('dian');
    }
  }, [isAdmin, loading, mode]);

  const setMode = (newMode: ModuleMode) => {
    if (newMode === 'gerencial' && !isAdmin) return;
    localStorage.setItem('aluminia_module_mode', newMode);
    setModeState(newMode);
  };

  const effectiveMode: ModuleMode = !isAdmin && mode === 'gerencial' ? 'dian' : mode;

  return (
    <ModuleContext.Provider
      value={{
        mode: effectiveMode,
        setMode,
        isDian: effectiveMode === 'dian',
        isGerencial: effectiveMode === 'gerencial',
      }}
    >
      {children}
    </ModuleContext.Provider>
  );
}

export function useModuleContext() {
  const ctx = useContext(ModuleContext);
  if (!ctx) return { mode: 'dian' as ModuleMode, setMode: () => {}, isDian: true, isGerencial: false };
  return ctx;
}
