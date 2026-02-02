import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type ViewMode = 'simple' | 'advanced';

interface ViewModeContextType {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  isSimpleMode: boolean;
  isAdvancedMode: boolean;
}

const ViewModeContext = createContext<ViewModeContextType | undefined>(undefined);

const STORAGE_KEY = 'aluminia_view_mode';

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      return (saved === 'advanced' ? 'advanced' : 'simple') as ViewMode;
    }
    return 'simple';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, viewMode);
  }, [viewMode]);

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
  };

  return (
    <ViewModeContext.Provider
      value={{
        viewMode,
        setViewMode,
        isSimpleMode: viewMode === 'simple',
        isAdvancedMode: viewMode === 'advanced',
      }}
    >
      {children}
    </ViewModeContext.Provider>
  );
}

export function useViewMode() {
  const context = useContext(ViewModeContext);
  if (context === undefined) {
    throw new Error('useViewMode must be used within a ViewModeProvider');
  }
  return context;
}
