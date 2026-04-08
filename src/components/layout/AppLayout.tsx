import { ReactNode, useEffect } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import NicoDrawer from '@/components/nico/NicoDrawer';
import { NicoProvider, useNico } from '@/hooks/useNicoContext';
import TrialBanner from '@/components/subscription/TrialBanner';

interface AppLayoutProps {
  children: ReactNode;
}

function KeyboardShortcut() {
  const { openNico } = useNico();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openNico();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openNico]);
  return null;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <NicoProvider>
      <SidebarProvider>
        <div className="min-h-screen flex w-full bg-background">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <TrialBanner />
            <AppHeader />
            <main className="flex-1 container mx-auto px-4 py-6 sm:px-6 lg:px-8">
              {children}
            </main>
          </div>
        </div>
        <NicoDrawer />
        <KeyboardShortcut />
      </SidebarProvider>
    </NicoProvider>
  );
}
