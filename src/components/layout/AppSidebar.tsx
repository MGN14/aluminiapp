import { useLocation } from 'react-router-dom';
import { NavLink } from '@/components/NavLink';
import {
  LayoutDashboard,
  FileText,
  FileUp,
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
  Sparkles,
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
  useSidebar,
} from '@/components/ui/sidebar';
import aluminiaAvatar from '@/assets/aluminia-avatar.png';
import nicoAvatar from '@/assets/nico-avatar.png';
import PlanBadge from '@/components/subscription/PlanBadge';

const mainItems = [
  {
    title: 'Nico IA',
    url: '/nico',
    icon: Sparkles,
    highlight: true,
  },
  {
    title: 'Dashboard',
    url: '/dashboard',
    icon: LayoutDashboard,
  },
];

const documentItems = [
  { title: 'Extractos', url: '/statement-upload', icon: FileUp },
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
  label?: string;
  items: { title: string; url: string; icon: React.ComponentType<any>; highlight?: boolean }[];
  collapsed: boolean;
  currentPath: string;
}

function SidebarSection({ label, items, collapsed, currentPath }: SectionProps) {
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-sidebar-foreground/50 font-semibold px-3">{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const basePath = item.url.split('?')[0];
            const isActive = currentPath === basePath || (basePath === '/invoices' && currentPath === '/invoices');
            return (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton asChild isActive={isActive}>
                  <NavLink
                    to={item.url}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                      item.highlight && !isActive
                        ? 'text-sidebar-foreground font-semibold'
                        : ''
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

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="px-3 py-4">
        <NavLink to="/dashboard" className="flex items-center gap-2.5 px-1">
          <div className="w-8 h-8 rounded-full overflow-hidden border border-sidebar-border shrink-0">
            <img src={aluminiaAvatar} alt="AluminIA" className="w-full h-full object-cover" />
          </div>
          {!collapsed && (
            <span className="text-lg font-bold text-sidebar-foreground tracking-tight">AluminIA</span>
          )}
        </NavLink>
      </SidebarHeader>

      <SidebarContent className="px-2 gap-1">
        {/* Nico IA highlight */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === '/nico'}>
                  <NavLink
                    to="/nico"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 hover:from-emerald-500/20 hover:to-teal-500/20 transition-all"
                    activeClassName="from-emerald-500/25 to-teal-500/25 border-emerald-500/40"
                  >
                    <div className="w-6 h-6 rounded-lg overflow-hidden shrink-0">
                      <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
                    </div>
                    {!collapsed && <span className="text-sidebar-foreground">Nico IA</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === '/dashboard'}>
                  <NavLink
                    to="/dashboard"
                    className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
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

        <SidebarSection label="Documentos" items={documentItems} collapsed={collapsed} currentPath={currentPath} />
        <SidebarSection label="Movimientos" items={movementItems} collapsed={collapsed} currentPath={currentPath} />
        <SidebarSection label="Reportes" items={reportItems} collapsed={collapsed} currentPath={currentPath} />
        <SidebarSection label="Exportar / Compartir" items={exportItems} collapsed={collapsed} currentPath={currentPath} />
      </SidebarContent>

      <SidebarFooter className="px-3 py-3">
        {!collapsed && <PlanBadge />}
      </SidebarFooter>
    </Sidebar>
  );
}
