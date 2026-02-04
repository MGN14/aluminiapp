import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { LogOut, Settings, User } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import MobileNav from './MobileNav';
import PlanBadge from '@/components/subscription/PlanBadge';
import aluminiaAvatar from '@/assets/aluminia-avatar.png';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

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

  // Get user initial for avatar
  const getUserInitial = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name.charAt(0).toUpperCase();
    }
    if (user?.email) {
      return user.email.charAt(0).toUpperCase();
    }
    return 'U';
  };
  
  return <header className="border-b border-border bg-card">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          {/* Mobile nav */}
          <MobileNav isAuthenticated={true} />
          
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-accent/20 shadow-sm">
              <img 
                src={aluminiaAvatar} 
                alt="AluminIA" 
                className="w-full h-full object-cover"
              />
            </div>
            <span className="text-xl font-bold text-foreground hidden sm:inline">AluminIA</span>
          </Link>
          
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(item => (
              <Link 
                key={item.path} 
                to={item.path} 
                className={cn(
                  "px-3 py-2 text-sm font-medium rounded-md transition-colors",
                  location.pathname === item.path 
                    ? "bg-accent text-accent-foreground font-semibold shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4">
          <PlanBadge plan={plan} />
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 p-0">
                <Avatar className="h-9 w-9 border-2 border-border hover:border-accent transition-colors">
                  <AvatarFallback className="bg-accent/10 text-accent font-semibold">
                    {getUserInitial()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-popover">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">Mi cuenta</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user?.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/pricing" className="cursor-pointer">
                  <Settings className="h-4 w-4 mr-2" />
                  Ajustes y planes
                </Link>
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
              <DropdownMenuItem onClick={signOut} className="text-destructive cursor-pointer">
                <LogOut className="h-4 w-4 mr-2" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>;
}