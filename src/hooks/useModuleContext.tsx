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
  const [mode, setMode] = useState<ModuleMode>('dian');

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
