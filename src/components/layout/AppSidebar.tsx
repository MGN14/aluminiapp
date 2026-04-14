import { useLocation } from 'react-router-dom';
import { NavLink } from '@/components/NavLink';
import {
  LayoutDashboard,
  FileText,
  FileDown,
  FileUp,
  ArrowLeftRight,
  Package,
  BarChart3,
  Receipt,
  Users,
  HandCoins,
  ShieldCheck,
  Download,
  Building2,
  Landmark,
  Settings,
  UsersRound,
  Banknote,
  ClipboardList,
  PackageSearch,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar';
import nicoAvatar from '@/assets/nico-avatar.png';
import PlanBadge from '@/components/subscription/PlanBadge';
import { useModuleContext } from '@/hooks/useModuleContext';

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<any>;
  highlight?: boolean;
  comingSoon?: boolean;
}

const documentItems: NavItem[] = [
  { title: 'Extractos Bancarios', url: '/statement-upload', icon: FileUp, highlight: true },
  { title: 'Facturas de Venta', url: '/invoices/venta', icon: FileText },
  { title: 'Facturas de Compra', url: '/invoices/compra', icon: FileDown },
];

const movementItems: NavItem[] = [
  { title: 'Conciliación bancaria', url: '/transactions', icon: ArrowLeftRight, highlight: true },
  { title: 'Inventarios', url: '/inventarios', icon: Package },
];

const reportItems: NavItem[] = [
  { title: 'Estado de resultados', url: '/reportes/estado-resultados', icon: BarChart3 },
  { title: 'Anticipos', url: '/reportes/anticipos', icon: Receipt },
  { title: 'Cuentas por cobrar', url: '/reportes/cuentas-por-cobrar', icon: Users },
  { title: 'Cuentas por pagar', url: '/reportes/cuentas-por-pagar', icon: HandCoins },
  { title: 'Visita DIAN', url: '/financial-health', icon: ShieldCheck, highlight: true },
];

const exportItems: NavItem[] = [
  { title: 'Exportar movimientos', url: '/export', icon: Download },
  { title: 'Informe para banco', url: '/export?tipo=banco', icon: Building2 },
  { title: 'Informe para DIAN', url: '/export?tipo=dian', icon: Landmark },
];

const gerencialModules: NavItem[] = [
  { title: 'Movimientos en efectivo', url: '/coming-soon?mod=movimientos-efectivo', icon: Banknote, comingSoon: true },
  { title: 'Remisiones', url: '/coming-soon?mod=remisiones', icon: ClipboardList, comingSoon: true },
  { title: 'Inventario real', url: '/coming-soon?mod=inventario-real', icon: PackageSearch, comingSoon: true },
  { title: 'PYG Real', url: '/coming-soon?mod=pyg-real', icon: TrendingUp, comingSoon: true },
];

function isItemActive(itemUrl: string, currentPath: string, currentSearch: string) {
  const [basePath, query] = itemUrl.split('?');
  if (currentPath !== basePath) return false;
  if (!query) return !currentSearch || currentSearch === '?';
  const itemParams = new URLSearchParams(query);
  const currentParams = new URLSearchParams(currentSearch);
  for (const [key, value] of itemParams.entries()) {
    if (currentParams.get(key) !== value) return false;
  }
  return true;
}

interface SectionProps {
  label: string;
  items: NavItem[];
  collapsed: boolean;
  currentPath: string;
  currentSearch: string;
}

function SidebarSection({ label, items, collapsed, currentPath, currentSearch }: SectionProps) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.08em] text-sidebar-foreground/40 font-semibold px-3 mb-0.5">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active = isItemActive(item.url, currentPath, currentSearch);
            return (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton asChild isActive={active}>
                  <NavLink
                    to={item.url}
                    end
                    className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] transition-all duration-200 ${
                      active
                        ? 'font-semibold'
                        : item.highlight
                          ? 'font-medium text-sidebar-foreground'
                          : 'text-sidebar-foreground/70'
                    }`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>{item.title}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function GerencialSection({ collapsed, currentPath, currentSearch }: { collapsed: boolean; currentPath: string; currentSearch: string }) {
  return (
    <>
      <SidebarSeparator className="my-1.5" />
      <SidebarGroup>
        <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.08em] font-semibold px-3 mb-1 flex items-center gap-1.5">
          <Zap className="h-3 w-3 text-accent" />
          <span className="text-accent/80">Módulo Gerencial</span>
        </SidebarGroupLabel>
        {!collapsed && (
          <p className="px-3 text-[10px] text-accent/50 -mt-0.5 mb-1.5 leading-tight">
            La realidad operativa de tu negocio
          </p>
        )}
        <SidebarGroupContent>
          <SidebarMenu>
            {gerencialModules.map((item) => {
              const active = isItemActive(item.url, currentPath, currentSearch);
              return (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={active}>
                    <NavLink
                      to={item.url}
                      end
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 border
                        ${active
                          ? 'bg-accent/20 border-accent/40 text-accent shadow-sm'
                          : 'border-accent/15 bg-accent/5 text-accent/90 hover:bg-accent/12 hover:border-accent/30 hover:scale-[1.02] hover:shadow-sm hover:shadow-accent/10'
                        }`}
                    >
                      <Zap className="h-3.5 w-3.5 shrink-0 text-accent" />
                      {!collapsed && (
                        <span className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="truncate">{item.title}</span>
                          {item.comingSoon && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium leading-none bg-accent/15 text-accent shrink-0">
                              Próximamente
                            </span>
                          )}
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

export default function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const currentPath = location.pathname;
  const currentSearch = location.search;
  const { isGerencial } = useModuleContext();

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="px-3 pt-4 pb-2">
        <NavLink to="/dashboard" className="flex items-center gap-2.5 px-1">
          <div className="w-7 h-7 rounded-lg bg-success flex items-center justify-center shrink-0">
            <span className="text-success-foreground font-bold text-sm">A</span>
          </div>
          {!collapsed && (
            <span className="text-base font-bold text-sidebar-foreground tracking-tight">AluminIA</span>
          )}
        </NavLink>
      </SidebarHeader>

      <SidebarContent className="px-2 gap-0.5">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === '/nico'}>
                  <NavLink
                    to="/nico"
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-semibold border transition-colors ${
                      currentPath === '/nico'
                        ? 'bg-success/20 border-success/40 text-success'
                        : 'border-success/25 bg-success/8 text-success hover:bg-success/15'
                    }`}
                  >
                    <div className="w-5 h-5 rounded-md overflow-hidden shrink-0 ring-1 ring-success/30">
                      <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
                    </div>
                    {!collapsed && <span>Nico IA</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === '/dashboard'}>
                  <NavLink
                    to="/dashboard"
                    className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] transition-colors ${
                      currentPath === '/dashboard' ? 'font-semibold' : 'text-sidebar-foreground/70'
                    }`}
                  >
                    <LayoutDashboard className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>Dashboard</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="my-1" />

        <SidebarSection label="Documentos" items={documentItems} collapsed={collapsed} currentPath={currentPath} currentSearch={currentSearch} />
        <SidebarSection label="Movimientos" items={movementItems} collapsed={collapsed} currentPath={currentPath} currentSearch={currentSearch} />
        <SidebarSection label="Reportes" items={reportItems} collapsed={collapsed} currentPath={currentPath} currentSearch={currentSearch} />
        <SidebarSection label="Exportar" items={exportItems} collapsed={collapsed} currentPath={currentPath} currentSearch={currentSearch} />

        {/* Gerencial section – only rendered in gerencial mode */}
        {isGerencial && (
          <GerencialSection collapsed={collapsed} currentPath={currentPath} currentSearch={currentSearch} />
        )}

        <SidebarSeparator className="my-1" />

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === '/colaboradores'}>
                  <NavLink
                    to="/colaboradores"
                    className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] transition-colors ${
                      currentPath === '/colaboradores' ? 'font-semibold' : 'text-sidebar-foreground/70'
                    }`}
                  >
                    <UsersRound className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>Colaboradores</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-3 py-3 border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={currentPath === '/settings'}>
              <NavLink
                to="/settings"
                className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] transition-colors ${
                  currentPath === '/settings' ? 'font-semibold' : 'text-sidebar-foreground/70'
                }`}
              >
                <Settings className="h-4 w-4 shrink-0" />
                {!collapsed && <span>Ajustes</span>}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {!collapsed && <PlanBadge />}
      </SidebarFooter>
    </Sidebar>
  );
}
