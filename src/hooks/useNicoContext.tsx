import { createContext, useContext, useState, ReactNode } from 'react';

export interface NicoPageContext {
  page: string;
  filters?: {
    period?: string;
    month?: number;
    year?: number;
    type?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    amountMin?: number;
    amountMax?: number;
  };
}

interface NicoContextValue {
  isOpen: boolean;
  openNico: () => void;
  closeNico: () => void;
  pageContext: NicoPageContext;
  setPageContext: (ctx: NicoPageContext) => void;
}

const NicoContext = createContext<NicoContextValue>({
  isOpen: false,
  openNico: () => {},
  closeNico: () => {},
  pageContext: { page: 'dashboard' },
  setPageContext: () => {},
});

export function NicoProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pageContext, setPageContext] = useState<NicoPageContext>({ page: 'dashboard' });

  return (
    <NicoContext.Provider
      value={{
        isOpen,
        openNico: () => setIsOpen(true),
        closeNico: () => setIsOpen(false),
        pageContext,
        setPageContext,
      }}
    >
      {children}
    </NicoContext.Provider>
  );
}

export function useNico() {
  return useContext(NicoContext);
}
