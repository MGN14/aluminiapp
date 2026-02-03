import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, LogOut, Settings } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ViewModeToggle } from './ViewModeToggle';
import MobileNav from './MobileNav';
import PlanBadge from '@/components/subscription/PlanBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

const navItems = [{
  path: '/dashboard',
  label: 'Dashboard'
}, {
  path: '/statement-upload',
  label: 'Subir Extracto'
}, {
  path: '/transactions',
  label: 'Transacciones'
}, {
  path: '/export',
  label: 'Exportar'
}];

export default function AppHeader() {
  const { user, signOut } = useAuth();
  const { plan, subscribed, openCustomerPortal } = useSubscription();
  const location = useLocation();
  const [loadingPortal, setLoadingPortal] = useState(false);

  const handleManageSubscription = async () => {
    setLoadingPortal(true);
    try {
      const url = await openCustomerPortal();
      if (url) {
        window.open(url, '_blank');
      }
    } catch (error) {
      console.error('Error opening portal:', error);
    } finally {
      setLoadingPortal(false);
    }
  };
  
  return <header className="border-b border-border bg-card">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          {/* Mobile nav */}
          <MobileNav isAuthenticated={true} />
          
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground hidden sm:inline">AluminIA</span>
          </Link>
          
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(item => <Link key={item.path} to={item.path} className={cn("px-3 py-2 text-sm font-medium rounded-md transition-colors", location.pathname === item.path ? "bg-accent/10 text-accent" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>
                {item.label}
              </Link>)}
          </nav>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4">
          <ViewModeToggle />
          
          <PlanBadge plan={plan} />
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="hidden md:flex gap-2">
                <span className="text-sm text-muted-foreground max-w-[150px] truncate">
                  {user?.email}
                </span>
                <Settings className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Mi cuenta</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/pricing">Ver planes</Link>
              </DropdownMenuItem>
              {subscribed && (
                <DropdownMenuItem onClick={handleManageSubscription} disabled={loadingPortal}>
                  {loadingPortal ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Cargando...
                    </>
                  ) : (
                    'Gestionar suscripción'
                  )}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="text-destructive">
                <LogOut className="h-4 w-4 mr-2" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <Button variant="ghost" size="sm" onClick={signOut} className="md:hidden">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>;
}