import { createContext, useContext, useState, ReactNode } from 'react';

type ModuleMode = 'dian' | 'gerencial';

interface ModuleContextValue {
  mode: ModuleMode;
  setMode: (mode: ModuleMode) => void;
  isDian: boolean;
  isGerencial: boolean;
}

const ModuleContext = createContext<ModuleContextValue | undefined>(undefined);

export function ModuleProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ModuleMode>(() => {
    const saved = localStorage.getItem('aluminia_module_mode');
    return (saved === 'gerencial' ? 'gerencial' : 'dian') as ModuleMode;
  });

  const setMode = (newMode: ModuleMode) => {
    localStorage.setItem('aluminia_module_mode', newMode);
    setModeState(newMode);
  };

  return (
    <ModuleContext.Provider value={{ mode, setMode, isDian: mode === 'dian', isGerencial: mode === 'gerencial' }}>
      {children}
    </ModuleContext.Provider>
  );
}

export function useModuleContext() {
  const ctx = useContext(ModuleContext);
  if (!ctx) throw new Error('useModuleContext must be used within ModuleProvider');
  return ctx;
}
