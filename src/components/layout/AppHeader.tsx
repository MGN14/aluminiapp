import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { LogOut, Settings, Sparkles, Moon, Sun } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
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
import { useModuleContext } from '@/hooks/useModuleContext';
import { useSubscription } from '@/hooks/useSubscription';
import { useDataOwner } from '@/hooks/useDataOwner';

const BRAND = 'oklch(0.43 0.14 155)';
const BRAND_DIM = 'oklch(0.43 0.14 155 / 0.10)';
const BRAND_BORDER = 'oklch(0.43 0.14 155 / 0.22)';

const PAGE_PLACEHOLDERS: Record<string, string> = {
  dashboard: '¿Cómo va mi negocio este mes?',
  transactions: '¿Qué gastos están fuera de lo normal?',
  'reportes/estado-resultados': 'Explícame este reporte',
  'reportes/anticipos': '¿Cómo van mis anticipos?',
  'reportes/cuentas-por-cobrar': '¿Quién me debe plata?',
  'reportes/cuentas-por-pagar': '¿Cuánto debo a proveedores?',
  'reportes/flujo-caja': '¿Cómo está mi flujo de caja?',
  'financial-health': '¿Tengo riesgo con la DIAN?',
  export: '¿Qué período debería exportar?',
  invoices: '¿Cómo va mi facturación?',
  settings: '¿Cómo configuro mi empresa?',
  default: 'Pregúntale a Nico...',
};

function getPlaceholder(pathname: string): string {
  const clean = pathname.replace(/^\//, '');
  if (PAGE_PLACEHOLDERS[clean]) return PAGE_PLACEHOLDERS[clean];
  for (const key of Object.keys(PAGE_PLACEHOLDERS)) {
    if (clean.startsWith(key)) return PAGE_PLACEHOLDERS[key];
  }
  return PAGE_PLACEHOLDERS.default;
}

export default function AppHeader() {
  const { user, signOut } = useAuth();
  const { openNico } = useNico();
  const { mode, setMode } = useModuleContext();
  const { isAdmin } = useSubscription();
  // El toggle DIAN/Gerencial debe verse para CUALQUIER owner, no solo admin/founder.
  // Pika (creacionesmarvel) es owner normal y reportó no verlo → bug histórico
  // donde el gate era isAdmin (true solo para founder + admins explícitos en user_roles).
  const { isCollaborator } = useDataOwner();
  // Use this to gate the module toggle so all owners see it, but collaborators NEVER do.
  const canSeeModuleToggle = !isCollaborator;
  const [companyInitial, setCompanyInitial] = useState<string | null>(null);
  const location = useLocation();
  // Antes: setInterval(500ms) re-rendereaba el header constantemente para
  // detectar cambio de ruta. useLocation solo dispara cuando la ruta cambia
  // de verdad — eliminamos el polling y los re-renders ociosos.
  const placeholder = useMemo(() => getPlaceholder(location.pathname), [location.pathname]);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

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
    <header
      style={{
        height: 58,
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <SidebarTrigger className="h-8 w-8 shrink-0" />

      {/* Center group — search + module toggle, centered between left trigger and right avatar */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          minWidth: 0,
        }}
      >
        {/* Nico search — oculto en mobile, ya hay FAB con la misma función */}
        <button
          onClick={openNico}
          className="hidden md:flex"
          style={{
            flex: '0 1 480px',
            minWidth: 0,
            alignItems: 'center',
            gap: 10,
            height: 36,
            padding: '0 14px',
            background: BRAND_DIM,
            border: `1px solid ${BRAND_BORDER}`,
            borderRadius: 10,
            cursor: 'text',
            transition: 'box-shadow 0.2s, border-color 0.2s',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = `0 0 0 3px oklch(0.43 0.14 155 / 0.08)`;
            e.currentTarget.style.borderColor = BRAND;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.borderColor = BRAND_BORDER;
          }}
        >
          <Sparkles style={{ color: BRAND, width: 14, height: 14, flexShrink: 0 }} />
          <span
            style={{
              fontSize: 13,
              color: 'oklch(0.43 0.14 155 / 0.7)',
              fontWeight: 500,
              flex: 1,
              textAlign: 'left',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {placeholder}
          </span>
          <kbd
            className="hidden md:inline-flex"
            style={{
              fontSize: 10,
              color: 'oklch(0.43 0.14 155 / 0.6)',
              border: `1px solid ${BRAND_BORDER}`,
              borderRadius: 5,
              padding: '2px 5px',
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            ⌘K
          </kbd>
        </button>

        {/* Module toggle — owners (no colaboradores) */}
        {canSeeModuleToggle && (
          <div
            className="hidden md:flex"
            style={{
              display: 'flex',
              background: '#f5f5f7',
              borderRadius: 9,
              padding: 3,
              gap: 1,
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => {
                localStorage.setItem('aluminia_module_mode', 'dian');
                setMode('dian');
              }}
              style={{
                padding: '5px 12px',
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 500,
                background: mode === 'dian' ? '#fff' : 'transparent',
                color: mode === 'dian' ? '#1d1d1f' : '#6e6e73',
                boxShadow: mode === 'dian' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              Módulo DIAN
            </button>
            <button
              onClick={() => {
                localStorage.setItem('aluminia_module_mode', 'gerencial');
                setMode('gerencial');
              }}
              style={{
                padding: '5px 12px',
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 500,
                background: mode === 'gerencial' ? '#fff' : 'transparent',
                color: mode === 'gerencial' ? BRAND : '#6e6e73',
                boxShadow: mode === 'gerencial' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              Módulo Gerencial
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
          onClick={toggleTheme}
          title={isDark ? 'Modo claro' : 'Modo oscuro'}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 p-0">
              <Avatar
                className="h-9 w-9"
                style={{ border: '2px solid rgba(0,0,0,0.07)' }}
              >
                <AvatarFallback
                  style={{
                    background: BRAND_DIM,
                    color: BRAND,
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
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
