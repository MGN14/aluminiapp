import { useEffect, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
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
  Zap,
  Wallet,
  ListChecks,
  Coins,
  CreditCard,
  Sparkles,
  Calculator,
  Boxes,
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
import NicoLogo from '@/components/nico/NicoLogo';
import PlanBadge from '@/components/subscription/PlanBadge';
import { useModuleContext } from '@/hooks/useModuleContext';
import { useSubscription } from '@/hooks/useSubscription';
import { useDataOwner } from '@/hooks/useDataOwner';
import { usePermissions } from '@/hooks/usePermissions';
import type { ModuleKey } from '@/hooks/useCollaborators';

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<any>;
  highlight?: boolean;
  comingSoon?: boolean;
  /** El ítem SOLO existe en Modo Gerencial (ej: Movimientos en efectivo) */
  gerencial?: boolean;
  /** El ítem existe siempre, pero su contenido cambia en Modo Gerencial
   *  (ej: Dashboard, Remisiones, Estado de resultados) */
  hasGerencialVariant?: boolean;
  /** El ítem se OCULTA en Modo Gerencial porque otro item gerencial lo reemplaza */
  hideInGerencial?: boolean;
  /** SOLO visible para el founder (niko14_gomez@hotmail.com). El RLS
   *  bloquea acceso a otros admins igual, pero esconderlo del menú evita
   *  confusión. */
  founderOnly?: boolean;
  /** Key del permiso de colaborador. Si está seteado y el user es colaborador
   *  sin acceso al módulo, el ítem se oculta del sidebar. Admin bypassea. */
  permKey?: ModuleKey;
}

const documentItems: NavItem[] = [
  { title: 'Extractos Bancarios', url: '/statement-upload', icon: FileUp, highlight: true, permKey: 'extractos' },
  { title: 'Facturas de Venta', url: '/invoices/venta', icon: FileText, permKey: 'facturas_venta' },
  { title: 'Facturas de Compra', url: '/invoices/compra', icon: FileDown, permKey: 'facturas_compra' },
];

const documentItemsGerencial: NavItem[] = [];

const movementItems: NavItem[] = [
  { title: 'Conciliación bancaria', url: '/transactions', icon: ArrowLeftRight, highlight: true, permKey: 'conciliacion' },
  { title: 'Caja Menor', url: '/caja-menor', icon: Banknote, hideInGerencial: true, permKey: 'caja_menor' },
  { title: 'Inventarios', url: '/inventarios', icon: Package, permKey: 'inventarios' },
  { title: 'Remisiones', url: '/remisiones', icon: ClipboardList, hasGerencialVariant: true, permKey: 'remisiones' },
  { title: 'Cotizaciones', url: '/cotizaciones', icon: Calculator, permKey: 'cotizaciones' },
  { title: 'Productos terminados', url: '/productos-terminados', icon: Boxes, permKey: 'cotizaciones' },
];

const movementItemsGerencial: NavItem[] = [
  { title: 'Movimientos en efectivo', url: '/cash-movements', icon: Banknote, gerencial: true },
];

const reportItems: NavItem[] = [
  { title: 'Estado de resultados', url: '/reportes/estado-resultados', icon: BarChart3, hasGerencialVariant: true, permKey: 'estado_resultados' },
  { title: 'Anticipos', url: '/reportes/anticipos', icon: Receipt, permKey: 'anticipos' },
  { title: 'Lo que me deben', url: '/reportes/cuentas-por-cobrar', icon: Users, hideInGerencial: true, permKey: 'cuentas_por_cobrar' },
  { title: 'Lo que debo', url: '/reportes/cuentas-por-pagar', icon: HandCoins, permKey: 'cuentas_por_pagar' },
  { title: 'Flujo de caja', url: '/reportes/flujo-caja', icon: Wallet, permKey: 'flujo_caja' },
  { title: 'Relación de pagos', url: '/reportes/relacion-pagos', icon: ListChecks, permKey: 'relacion_pagos' },
  { title: 'Informe para Banco', url: '/informe-banco', icon: Building2, highlight: true, permKey: 'informe_banco' },
];

const reportItemsGerencial: NavItem[] = [
  { title: 'Cartera Operativa', url: '/reportes/cartera-operativa', icon: Coins, gerencial: true },
  { title: 'Cabina Founder', url: '/founder', icon: Sparkles, gerencial: true, founderOnly: true },
];

const exportItems: NavItem[] = [
  { title: 'Exportar movimientos', url: '/export', icon: Download, permKey: 'exportar' },
  { title: 'Ojo, viene la DIAN', url: '/financial-health', icon: ShieldCheck, highlight: true, permKey: 'informe_dian' },
];

const logisticaItemsGerencial: NavItem[] = [];

const BRAND = 'oklch(0.43 0.14 155)';
const BRAND_DIM = 'oklch(0.43 0.14 155 / 0.10)';
const BRAND_BORDER = 'oklch(0.43 0.14 155 / 0.22)';

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

function navItemStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? BRAND : '#6e6e73',
    background: active ? BRAND_DIM : 'transparent',
    border: `1px solid ${active ? BRAND_BORDER : 'transparent'}`,
    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
  };
}

function handleHoverEnter(active: boolean) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (active) return;
    e.currentTarget.style.background = '#f5f5f7';
  };
}
function handleHoverLeave(active: boolean) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (active) return;
    e.currentTarget.style.background = 'transparent';
  };
}

function GerencialChip() {
  return (
    <span
      style={{
        fontSize: 8,
        padding: '2px 6px',
        borderRadius: 99,
        fontWeight: 700,
        letterSpacing: '0.6px',
        background: BRAND,
        color: '#fff',
        flexShrink: 0,
        textTransform: 'uppercase',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
      }}
      title="Este módulo cambia su contenido en Modo Gerencial"
    >
      <Zap style={{ width: 8, height: 8 }} />
      Gerencial
    </span>
  );
}

function SidebarNavItem({
  item,
  collapsed,
  currentPath,
  currentSearch,
  isGerencial,
}: {
  item: NavItem;
  collapsed: boolean;
  currentPath: string;
  currentSearch: string;
  isGerencial: boolean;
}) {
  const active = isItemActive(item.url, currentPath, currentSearch);

  if (item.gerencial) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={active}>
          <NavLink
            to={item.url}
            end
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              color: BRAND,
              background: active ? BRAND_DIM : 'oklch(0.43 0.14 155 / 0.06)',
              border: `1px solid ${BRAND_BORDER}`,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = BRAND_DIM;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = active ? BRAND_DIM : 'oklch(0.43 0.14 155 / 0.06)';
            }}
          >
            <Zap style={{ width: 14, height: 14, color: BRAND, flexShrink: 0 }} />
            {!collapsed && (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </span>
                <GerencialChip />
                {item.comingSoon && (
                  <span
                    style={{
                      fontSize: 9,
                      padding: '2px 6px',
                      borderRadius: 99,
                      fontWeight: 600,
                      background: BRAND_DIM,
                      color: BRAND,
                      flexShrink: 0,
                    }}
                  >
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

  const Icon = item.icon;
  const showVariantChip = isGerencial && item.hasGerencialVariant && !collapsed;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active}>
        <NavLink
          to={item.url}
          end
          style={navItemStyle(active)}
          onMouseEnter={handleHoverEnter(active)}
          onMouseLeave={handleHoverLeave(active)}
        >
          <Icon style={{ width: 15, height: 15, flexShrink: 0 }} />
          {!collapsed && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.title}
              </span>
              {showVariantChip && <GerencialChip />}
            </span>
          )}
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
  isFounder: boolean;
  hasModule: (key: ModuleKey) => boolean;
}

function SidebarSection({
  label,
  items,
  gerencialItems,
  collapsed,
  currentPath,
  currentSearch,
  isGerencial,
  isFounder,
  hasModule,
}: SectionProps) {
  const baseItems = isGerencial ? items.filter((item) => !item.hideInGerencial) : items;
  const merged = isGerencial && gerencialItems ? [...baseItems, ...gerencialItems] : baseItems;
  const allItems = merged
    .filter((item) => !item.founderOnly || isFounder)
    .filter((item) => !item.permKey || hasModule(item.permKey));

  if (allItems.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '1.2px',
          textTransform: 'uppercase',
          color: '#a1a1a6',
          padding: '0 12px',
          marginBottom: 4,
        }}
      >
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
              isGerencial={isGerencial}
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
  const { isAdmin, isFounder } = useSubscription();
  const { isCollaborator } = useDataOwner();
  const { hasModule } = usePermissions();

  // Auto-abrir el sidebar SOLO cuando se entra a Modo Gerencial (transición
  // false→true). Antes este effect tenía `state` en deps, lo que causaba que
  // re-abriera el sidebar cada vez que el user lo colapsaba manualmente.
  // Ahora solo dispara una vez al activar gerencial.
  const wasGerencialRef = useRef(false);
  useEffect(() => {
    if (isGerencial && !wasGerencialRef.current) {
      setOpen(true);
    }
    wasGerencialRef.current = isGerencial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGerencial]);

  const nicoActive = currentPath === '/nico';

  return (
    <Sidebar
      collapsible="icon"
      style={{
        background: '#ffffff',
        borderRight: isGerencial ? `1px solid ${BRAND_BORDER}` : '1px solid rgba(0,0,0,0.07)',
      }}
    >
      {isGerencial && (
        <div
          style={{
            height: 3,
            background: BRAND,
            flexShrink: 0,
            width: '100%',
          }}
        />
      )}
      <SidebarHeader style={{ padding: '16px 12px 8px' }}>
        <NavLink to="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px' }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: BRAND,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>A</span>
          </div>
          {!collapsed && (
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1d1d1f', letterSpacing: '-0.3px' }}>
              AluminIA
            </span>
          )}
        </NavLink>
        {isGerencial && !collapsed && (
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-start', paddingLeft: 4 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.8px',
                padding: '3px 8px',
                borderRadius: 99,
                background: BRAND,
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                textTransform: 'uppercase',
              }}
            >
              <Zap style={{ width: 10, height: 10 }} />
              Modo Gerencial
            </span>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent style={{ padding: '0 8px', gap: 2 }}>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {hasModule('nico_ia') && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={nicoActive}>
                  <NavLink
                    to="/nico"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 600,
                      color: BRAND,
                      background: nicoActive ? BRAND_DIM : 'oklch(0.43 0.14 155 / 0.06)',
                      border: `1px solid ${BRAND_BORDER}`,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = BRAND_DIM;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = nicoActive
                        ? BRAND_DIM
                        : 'oklch(0.43 0.14 155 / 0.06)';
                    }}
                  >
                    <NicoLogo size={18} />
                    {!collapsed && <span>Nico IA</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              )}

              {hasModule('dashboard') && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={currentPath === '/dashboard'}>
                  <NavLink
                    to="/dashboard"
                    style={navItemStyle(currentPath === '/dashboard')}
                    onMouseEnter={handleHoverEnter(currentPath === '/dashboard')}
                    onMouseLeave={handleHoverLeave(currentPath === '/dashboard')}
                  >
                    <LayoutDashboard style={{ width: 15, height: 15, flexShrink: 0 }} />
                    {!collapsed && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          Dashboard
                        </span>
                        {isGerencial && <GerencialChip />}
                      </span>
                    )}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator style={{ margin: '6px 0', background: 'rgba(0,0,0,0.07)' }} />

        <SidebarSection
          label="Documentos"
          items={documentItems}
          gerencialItems={documentItemsGerencial}
          collapsed={collapsed}
          currentPath={currentPath}
          currentSearch={currentSearch}
          isGerencial={isGerencial}
          isFounder={isFounder}
          hasModule={hasModule}
        />
        <SidebarSection
          label="Movimientos"
          items={movementItems}
          gerencialItems={movementItemsGerencial}
          collapsed={collapsed}
          currentPath={currentPath}
          currentSearch={currentSearch}
          isGerencial={isGerencial}
          isFounder={isFounder}
          hasModule={hasModule}
        />
        <SidebarSection
          label="Reportes"
          items={reportItems}
          gerencialItems={reportItemsGerencial}
          collapsed={collapsed}
          currentPath={currentPath}
          currentSearch={currentSearch}
          isGerencial={isGerencial}
          isFounder={isFounder}
          hasModule={hasModule}
        />
        <SidebarSection
          label="Exportar"
          items={exportItems}
          collapsed={collapsed}
          currentPath={currentPath}
          currentSearch={currentSearch}
          isGerencial={isGerencial}
          isFounder={isFounder}
          hasModule={hasModule}
        />

        {isGerencial && (
          <SidebarSection
            label="Logística"
            items={[]}
            gerencialItems={logisticaItemsGerencial}
            collapsed={collapsed}
            currentPath={currentPath}
            currentSearch={currentSearch}
            isGerencial={isGerencial}
            isFounder={isFounder}
            hasModule={hasModule}
          />
        )}

        <SidebarSeparator style={{ margin: '6px 0', background: 'rgba(0,0,0,0.07)' }} />

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {hasModule('creditos') && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === '/creditos'}>
                    <NavLink
                      to="/creditos"
                      style={navItemStyle(currentPath === '/creditos')}
                      onMouseEnter={handleHoverEnter(currentPath === '/creditos')}
                      onMouseLeave={handleHoverLeave(currentPath === '/creditos')}
                    >
                      <CreditCard style={{ width: 15, height: 15, flexShrink: 0 }} />
                      {!collapsed && <span>Créditos</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === '/colaboradores'}>
                    <NavLink
                      to="/colaboradores"
                      style={navItemStyle(currentPath === '/colaboradores')}
                      onMouseEnter={handleHoverEnter(currentPath === '/colaboradores')}
                      onMouseLeave={handleHoverLeave(currentPath === '/colaboradores')}
                    >
                      <UsersRound style={{ width: 15, height: 15, flexShrink: 0 }} />
                      {!collapsed && <span>Colaboradores</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter
        style={{
          padding: '12px',
          borderTop: '1px solid rgba(0,0,0,0.07)',
        }}
      >
        {isAdmin && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={currentPath === '/settings'}>
                <NavLink
                  to="/settings"
                  style={navItemStyle(currentPath === '/settings')}
                  onMouseEnter={handleHoverEnter(currentPath === '/settings')}
                  onMouseLeave={handleHoverLeave(currentPath === '/settings')}
                >
                  <Settings style={{ width: 15, height: 15, flexShrink: 0 }} />
                  {!collapsed && <span>Ajustes</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        {!collapsed && !isCollaborator && (
          <Link
            to="/pricing"
            title="Gestionar suscripción"
            style={{
              marginTop: 8,
              background: 'oklch(0.43 0.14 155 / 0.08)',
              border: `1px solid ${BRAND_BORDER}`,
              borderRadius: 10,
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              transition: 'background 0.15s, border-color 0.15s',
              textDecoration: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'oklch(0.43 0.14 155 / 0.14)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'oklch(0.43 0.14 155 / 0.08)';
            }}
          >
            <PlanBadge />
            <span style={{ fontSize: 10, color: 'oklch(0.43 0.14 155)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              Cambiar →
            </span>
          </Link>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
