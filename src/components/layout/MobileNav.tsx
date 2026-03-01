import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, LogOut, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import aluminiaAvatar from '@/assets/aluminia-avatar.png';

interface NavItem {
  path: string;
  label: string;
}

interface MobileNavProps {
  isAuthenticated?: boolean;
}

const publicNavItems: NavItem[] = [
  { path: '/', label: 'Inicio' },
  { path: '/pricing', label: 'Precios' },
  { path: '/contact', label: 'Contacto' },
];

const authNavItems: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/statement-upload', label: 'Subir Extracto' },
  { path: '/transactions', label: 'Transacciones' },
  { path: '/invoices', label: 'Facturas' },
  { path: '/reports', label: 'Reportes' },
  { path: '/export', label: 'Exportar' },
];

export default function MobileNav({ isAuthenticated = false }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { signOut } = useAuth();

  const navItems = isAuthenticated ? authNavItems : publicNavItems;

  const handleSignOut = async () => {
    await signOut();
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Abrir menú</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] sm:w-[320px]">
        <SheetHeader className="pb-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-accent/20 shadow-sm">
              <img 
                src={aluminiaAvatar} 
                alt="AluminIA" 
                className="w-full h-full object-cover"
              />
            </div>
            <span className="text-xl font-bold">AluminIA</span>
          </SheetTitle>
        </SheetHeader>

        <nav className="flex flex-col py-6">
          <div className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center px-3 py-3 text-sm font-medium rounded-md transition-colors",
                  location.pathname === item.path
                    ? "bg-accent text-accent-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="border-t border-border mt-6 pt-6 space-y-2">
            {isAuthenticated ? (
              <>
                <Link to="/pricing" onClick={() => setOpen(false)}>
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-muted-foreground"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Ajustes y planes
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  className="w-full justify-start text-destructive"
                  onClick={handleSignOut}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Cerrar sesión
                </Button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={() => setOpen(false)}>
                  <Button variant="outline" className="w-full">
                    Iniciar Sesión
                  </Button>
                </Link>
                <Link to="/signup" onClick={() => setOpen(false)}>
                  <Button className="w-full">
                    Crear Cuenta
                  </Button>
                </Link>
              </>
            )}
          </div>
        </nav>

        <div className="absolute bottom-6 left-6 right-6">
          <div className="flex gap-4 text-xs text-muted-foreground">
            <Link to="/terms" onClick={() => setOpen(false)} className="hover:text-foreground">
              Términos
            </Link>
            <Link to="/privacy" onClick={() => setOpen(false)} className="hover:text-foreground">
              Privacidad
            </Link>
            <Link to="/contact" onClick={() => setOpen(false)} className="hover:text-foreground">
              Contacto
            </Link>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}