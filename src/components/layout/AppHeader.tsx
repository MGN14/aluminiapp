import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, LogOut } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ViewModeToggle } from './ViewModeToggle';

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
  const {
    user,
    signOut
  } = useAuth();
  const location = useLocation();
  return <header className="border-b border-border bg-card">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">AluminIA</span>
          </Link>
          
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(item => <Link key={item.path} to={item.path} className={cn("px-3 py-2 text-sm font-medium rounded-md transition-colors text-success", location.pathname === item.path ? "bg-accent/10 text-accent" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>
                {item.label}
              </Link>)}
          </nav>
        </div>
        
        <div className="flex items-center gap-4">
          <ViewModeToggle />
          <span className="text-sm text-muted-foreground hidden sm:block">
            {user?.email}
          </span>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Salir
          </Button>
        </div>
      </div>
    </header>;
}