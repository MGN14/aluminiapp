import { ReactNode, useEffect } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import NicoDrawer from '@/components/nico/NicoDrawer';
import NicoFAB from '@/components/nico/NicoFAB';
import { NicoProvider, useNico } from '@/hooks/useNicoContext';
import TrialBanner from '@/components/subscription/TrialBanner';
import AppFeedbackPopupHost from '@/components/feedback/AppFeedbackPopupHost';

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
          <div
            className="min-h-screen flex w-full"
            style={{
              background: '#f5f5f7',
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
              WebkitFontSmoothing: 'antialiased',
            }}
          >
            <AppSidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <TrialBanner />
              <AppHeader />
              <main
                className="flex-1 p-4 md:p-7 pb-24 md:pb-7"
                style={{ maxWidth: '100%' }}
              >
                {children}
              </main>
            </div>
          </div>
          <NicoDrawer />
          <NicoFAB />
          <AppFeedbackPopupHost />
          <KeyboardShortcut />
        </SidebarProvider>
      </NicoProvider>
  );
}
