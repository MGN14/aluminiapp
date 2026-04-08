import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { LogOut, Settings, Sparkles, Moon, Sun } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useNico } from '@/hooks/useNicoContext';

const PAGE_PLACEHOLDERS: Record<string, string> = {
  dashboard: '¿Cómo va mi negocio este mes?',
  transactions: '¿Qué gastos están fuera de lo normal?',
  'reportes/estado-resultados': 'Explícame este reporte',
  'reportes/anticipos': '¿Cómo van mis anticipos?',
  'reportes/cuentas-por-cobrar': '¿Quién me debe plata?',
  'reportes/cuentas-por-pagar': '¿Cuánto debo a proveedores?',
  'financial-health': '¿Tengo riesgo con la DIAN?',
  export: '¿Qué período debería exportar?',
  invoices: '¿Cómo va mi facturación?',
  settings: '¿Cómo configuro mi empresa?',
  default: 'Pregúntale a Nico...',
};

function getPlaceholder(pathname: string): string {
  const clean = pathname.replace(/^\//, '');
  if (PAGE_PLACEHOLDERS[clean]) return PAGE_PLACEHOLDERS[clean];
  // Try partial match for nested routes
  for (const key of Object.keys(PAGE_PLACEHOLDERS)) {
    if (clean.startsWith(key)) return PAGE_PLACEHOLDERS[key];
  }
  return PAGE_PLACEHOLDERS.default;
}

export default function AppHeader() {
  const { user, signOut } = useAuth();
  const { openNico, isOpen } = useNico();
  const [companyInitial, setCompanyInitial] = useState<string | null>(null);
  const [placeholder, setPlaceholder] = useState(PAGE_PLACEHOLDERS.default);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  // Initialize theme from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
      document.documentElement.classList.add('dark');
      setIsDark(true);
    } else {
      document.documentElement.classList.remove('dark');
      setIsDark(false);
    }
  }, []);

  useEffect(() => {
    const updatePlaceholder = () => {
      setPlaceholder(getPlaceholder(window.location.pathname));
    };
    updatePlaceholder();
    window.addEventListener('popstate', updatePlaceholder);
    // Also listen for route changes via a MutationObserver on the URL
    const interval = setInterval(updatePlaceholder, 500);
    return () => {
      window.removeEventListener('popstate', updatePlaceholder);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      try {
        const { data } = await supabase
          .from('profiles')
          .select('company_initial')
          .eq('user_id', user.id)
          .maybeSingle();
        if (data?.company_initial) {
          setCompanyInitial(data.company_initial);
        }
      } catch (error) {
        console.error('Error loading profile:', error);
      }
    };
    loadProfile();
  }, [user]);

  const getAvatarInitial = () => {
    if (companyInitial) return companyInitial;
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name.charAt(0).toUpperCase();
    if (user?.email) return user.email.charAt(0).toUpperCase();
    return 'U';
  };

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 gap-3">
      <SidebarTrigger className="h-8 w-8 shrink-0" />

      {/* Nico Search Input */}
      <button
        onClick={openNico}
        className="flex-1 max-w-xl flex items-center gap-2.5 px-4 py-2 rounded-xl border border-success/30 bg-success/5 hover:bg-success/10 hover:border-success/50 transition-all cursor-text group shadow-sm hover:shadow-md hover:shadow-success/5"
      >
        <Sparkles className="w-4 h-4 text-success shrink-0" />
        <span className="text-sm text-success/70 group-hover:text-success transition-colors truncate font-medium">
          {placeholder}
        </span>
        <kbd className="hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-success/20 bg-success/5 text-[10px] text-success/60 ml-auto shrink-0">
          ⌘K
        </kbd>
      </button>

      <div className="flex items-center gap-2 shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 p-0">
              <Avatar className="h-9 w-9 border-2 border-border hover:border-accent transition-colors">
                <AvatarFallback className="bg-accent/10 text-accent-foreground font-semibold text-sm">
                  {getAvatarInitial()}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-popover">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">Mi cuenta</p>
                <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings" className="cursor-pointer">
                <Settings className="h-4 w-4 mr-2" />
                Ajustes
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-destructive cursor-pointer">
              <LogOut className="h-4 w-4 mr-2" />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
