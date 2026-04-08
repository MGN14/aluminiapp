import { ReactNode } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import AppSidebar from './AppSidebar';
import AppHeader from './AppHeader';
import NicoFAB from '@/components/nico/NicoFAB';
import NicoDrawer from '@/components/nico/NicoDrawer';
import { NicoProvider } from '@/hooks/useNicoContext';
import TrialBanner from '@/components/subscription/TrialBanner';

interface AppLayoutProps {
  children: ReactNode;
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
        <NicoFAB />
        <NicoDrawer />
      </SidebarProvider>
    </NicoProvider>
  );
}
