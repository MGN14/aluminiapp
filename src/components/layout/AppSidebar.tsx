import { useLocation } from 'react-router-dom';
import { NavLink } from '@/components/NavLink';
import {
  LayoutDashboard,
  FileText,
  FileDown,
  ArrowLeftRight,
  Link2,
  BarChart3,
  Receipt,
  Users,
  HandCoins,
  ShieldCheck,
  Download,
  Building2,
  Landmark,
  Bot,
  Settings,
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

const documentItems = [
  { title: 'Facturas de Venta', url: '/invoices?type=venta', icon: FileText },
  { title: 'Facturas de Venta', url: '/invoices?type=venta', icon: FileText },
  { title: 'Facturas de Compra', url: '/invoices?type=compra', icon: FileDown },
];

const movementItems = [
  { title: 'Transacciones', url: '/transactions', icon: ArrowLeftRight, highlight: true },
  { title: 'Conciliación bancaria', url: '/transactions?view=conciliacion', icon: Link2 },
];

const reportItems = [
  { title: 'Estado de resultados', url: '/reports?tab=pyg', icon: BarChart3 },
  { title: 'Anticipos', url: '/reports?tab=anticipos', icon: Receipt },
  { title: 'Cuentas por cobrar', url: '/reports?tab=cxc', icon: Users },
  { title: 'Cuentas por pagar', url: '/reports?tab=cxp', icon: HandCoins },
  { title: 'Visita DIAN', url: '/financial-health', icon: ShieldCheck, highlight: true },
];

const exportItems = [
  { title: 'Exportar movimientos', url: '/export', icon: Download },
  { title: 'Informe para banco', url: '/export?tipo=banco', icon: Building2 },
  { title: 'Informe para DIAN', url: '/export?tipo=dian', icon: Landmark },
];

interface SectionProps {
  label: string;
  items: { title: string; url: string; icon: React.ComponentType<any>; highlight?: boolean }[];
  collapsed: boolean;
  currentPath: string;
  currentSearch: string;
}

function isItemActive(itemUrl: string, currentPath: string, currentSearch: string) {
  const [basePath, query] = itemUrl.split('?');
  if (currentPath !== basePath) return false;
  if (!query) return !currentSearch || currentSearch === '?';
  // Match the specific query param key=value pair anywhere in the search string
  const itemParams = new URLSearchParams(query);
  const currentParams = new URLSearchParams(currentSearch);
  for (const [key, value] of itemParams.entries()) {
    if (currentParams.get(key) !== value) return false;
  }
  return true;
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
                    className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] transition-colors ${
                      item.highlight && !active
                        ? 'font-medium text-sidebar-foreground'
                        : 'text-sidebar-foreground/70'
                    }`}
                    activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
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

export default function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const currentPath = location.pathname;
  const currentSearch = location.search;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      {/* Brand header */}
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
        {/* Nico IA – primary CTA */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === '/nico'}>
                  <NavLink
                    to="/nico"
                    className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-semibold border border-success/25 bg-success/8 text-success hover:bg-success/15 transition-colors"
                    activeClassName="bg-success/20 border-success/40 text-success"
                  >
                    <div className="w-5 h-5 rounded-md overflow-hidden shrink-0 ring-1 ring-success/30">
                      <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
                    </div>
                    {!collapsed && <span>Nico IA</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Dashboard */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === '/dashboard'}>
                  <NavLink
                    to="/dashboard"
                    className="flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] text-sidebar-foreground/70 transition-colors"
                    activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
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
      </SidebarContent>

      <SidebarFooter className="px-3 py-3 border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={currentPath === '/settings'}>
              <NavLink
                to="/settings"
                className="flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] text-sidebar-foreground/70 transition-colors"
                activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
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
