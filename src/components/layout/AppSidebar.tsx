import { useEffect } from 'react';
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
  gerencial?: boolean;
}

const documentItems: NavItem[] = [
  { title: 'Extractos Bancarios', url: '/statement-upload', icon: FileUp, highlight: true },
  { title: 'Facturas de Venta', url: '/invoices/venta', icon: FileText },
  { title: 'Facturas de Compra', url: '/invoices/compra', icon: FileDown },
];

const documentItemsGerencial: NavItem[] = [
  { title: 'Movimientos en efectivo', url: '/coming-soon?mod=movimientos-efectivo', icon: Banknote, comingSoon: true, gerencial: true },
];

const movementItems: NavItem[] = [
  { title: 'Conciliación bancaria', url: '/transactions', icon: ArrowLeftRight, highlight: true },
  { title: 'Inventarios', url: '/inventarios', icon: Package },
];

const movementItemsGerencial: NavItem[] = [
  { title: 'Inventario real', url: '/coming-soon?mod=inventario-real', icon: PackageSearch, comingSoon: true, gerencial: true },
];

const reportItems: NavItem[] = [
  { title: 'Estado de resultados', url: '/reportes/estado-resultados', icon: BarChart3 },
  { title: 'Anticipos', url: '/reportes/anticipos', icon: Receipt },
  { title: 'Cuentas por cobrar', url: '/reportes/cuentas-por-cobrar', icon: Users },
  { title: 'Cuentas por pagar', url: '/reportes/cuentas-por-pagar', icon: HandCoins },
  { title: 'Visita DIAN', url: '/financial-health', icon: ShieldCheck, highlight: true },
];

const reportItemsGerencial: NavItem[] = [
  { title: 'PYG Real', url: '/coming-soon?mod=pyg-real', icon: TrendingUp, comingSoon: true, gerencial: true },
];

const exportItems: NavItem[] = [
  { title: 'Exportar movimientos', url: '/export', icon: Download },
  { title: 'Informe para banco', url: '/export?tipo=banco', icon: Building2 },
  { title: 'Informe para DIAN', url: '/export?tipo=dian', icon: Landmark },
];

const logisticaItemsGerencial: NavItem[] = [
  { title: 'Remisiones', url: '/coming-soon?mod=remisiones', icon: ClipboardList, comingSoon: true, gerencial: true },
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

function SidebarNavItem({ item, collapsed, currentPath, currentSearch }: {
  item: NavItem;
  collapsed: boolean;
  currentPath: string;
  currentSearch: string;
}) {
  const active = isItemActive(item.url, currentPath, currentSearch);

  if (item.gerencial) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={active}>
          <NavLink
            to={item.url}
            end
            className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors border
              ${active
                ? 'bg-primary/15 border-primary/40 text-primary'
                : 'border-primary/20 bg-primary/5 text-primary/80 hover:bg-primary/10 hover:border-primary/30'
              }`}
          >
            <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
            {!collapsed && (
              <span className="flex items-center gap-2 flex-1 min-w-0">
                <span className="truncate">{item.title}</span>
                {item.comingSoon && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium leading-none bg-primary/15 text-primary shrink-0">
                    Próximamente
                  </span>
                )}
              </span>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active}>
        <NavLink
          to={item.url}
          end
          className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] transition-colors ${
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
}

interface SectionProps {
  label: string;
  items: NavItem[];
  gerencialItems?: NavItem[];
  collapsed: boolean;
  currentPath: string;
  currentSearch: string;
  isGerencial: boolean;
}

function SidebarSection({ label, items, gerencialItems, collapsed, currentPath, currentSearch, isGerencial }: SectionProps) {
  const allItems = isGerencial && gerencialItems ? [...items, ...gerencialItems] : items;

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.08em] text-sidebar-foreground/40 font-semibold px-3 mb-0.5">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {allItems.map((item) => (
            <SidebarNavItem
              key={item.url}
              item={item}
              collapsed={collapsed}
              currentPath={currentPath}
              currentSearch={currentSearch}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export default function AppSidebar() {
  const { state, setOpen } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const currentPath = location.pathname;
  const currentSearch = location.search;
  const { isGerencial } = useModuleContext();

  // Force sidebar open when gerencial mode is active so gerencial items are always visible
  useEffect(() => {
    if (isGerencial && state === 'collapsed') {
      setOpen(true);
    }
  }, [isGerencial, state, setOpen]);

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
        {/* Principal */}
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

        <SidebarSection label="Documentos" items={documentItems} gerencialItems={documentItemsGerencial} collapsed={collapsed} currentPath={currentPath} currentSearch={currentSearch} isGerencial={isGerencial} />
        <SidebarSection label="Movimientos" items={movementItems} gerencialItems={movementItemsGerencial} collapsed={collapsed} currentPath={currentPath} currentSearch={currentSearch} isGerencial={isGerencial} />
        <SidebarSection label="Reportes" items={reportItems} gerencialItems={reportItemsGerencial} collapsed={collapsed} currentPath={currentPath} currentSearch={currentSearch} isGerencial={isGerencial} />
        <SidebarSection label="Exportar" items={exportItems} collapsed={collapsed} currentPath={currentPath} currentSearch={currentSearch} isGerencial={isGerencial} />

        {/* Logística – only in gerencial mode */}
        {isGerencial && (
          <SidebarSection label="Logística" items={[]} gerencialItems={logisticaItemsGerencial} collapsed={collapsed} currentPath={currentPath} currentSearch={currentSearch} isGerencial={isGerencial} />
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
