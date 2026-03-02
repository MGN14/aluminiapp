import { ReactNode } from 'react';
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
      <div className="min-h-screen bg-background">
        <TrialBanner />
        <AppHeader />
        <main className="container mx-auto px-4 py-8">
          {children}
        </main>
        <NicoFAB />
        <NicoDrawer />
      </div>
    </NicoProvider>
  );
}
