import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { SubscriptionProvider } from "@/hooks/useSubscription";
import { ModuleProvider, useModuleContext } from "@/hooks/useModuleContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import RequireModule from "@/components/RequireModule";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import SessionExpiredModal from "@/components/auth/SessionExpiredModal";
import AuthDebugPanel from "@/components/auth/AuthDebugPanel";
import TourOverlay from "@/components/tour/TourOverlay";
import UpdateNotifier from "@/components/UpdateNotifier";
import { usePageViewTracking } from "@/hooks/useTrackEvent";

/** Mount global de tracking de page views — debe estar dentro de BrowserRouter */
function PageViewTracker() {
  usePageViewTracking();
  return null;
}

const Index = lazy(() => import("./pages/Index"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const StatementUpload = lazy(() => import("./pages/StatementUpload"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Export = lazy(() => import("./pages/Export"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Contact = lazy(() => import("./pages/Contact"));
const Settings = lazy(() => import("./pages/Settings"));
const Reports = lazy(() => import("./pages/Reports"));
const Nico = lazy(() => import("./pages/Nico"));
const InvoicesVenta = lazy(() => import("./pages/InvoicesVenta"));
const InvoicesCompra = lazy(() => import("./pages/InvoicesCompra"));
const FinancialHealth = lazy(() => import("./pages/FinancialHealth"));
const VisitaDIAN = lazy(() => import("./pages/VisitaDIAN"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Founder = lazy(() => import("./pages/Founder"));
const Collaborators = lazy(() => import("./pages/Collaborators"));
const ComingSoon = lazy(() => import("./pages/ComingSoon"));
const Remisiones = lazy(() => import("./pages/Remisiones"));
const Cotizaciones = lazy(() => import("./pages/Cotizaciones"));
const ProductosTerminados = lazy(() => import("./pages/ProductosTerminados"));
const CashMovements = lazy(() => import("./pages/CashMovements"));
const CarteraOperativa = lazy(() => import("./pages/CarteraOperativa"));
const CajaMenor = lazy(() => import("./pages/CajaMenor"));
const InformeBanco = lazy(() => import("./pages/InformeBanco"));
const Creditos = lazy(() => import("./pages/Creditos"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Admin = lazy(() => import("./pages/Admin"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Defaults amigables para sesiones largas:
//   - refetchOnWindowFocus: false → cuando el usuario vuelve a la pestaña
//     después de un rato, NO refrescamos las queries. Antes esto causaba
//     que se reseteara la UI (filtros que se "perdían" visualmente, parpadeos).
//     Los filtros locales (useState) se mantienen intactos.
//   - staleTime: 5min → la data se considera fresca por 5 minutos. Mientras
//     esté fresca, useQuery NO refetchea al remount — cambiar de tab y
//     volver no dispara spinners ni parpadeos. Las mutaciones que cambian
//     algo invalidan explícitamente las queries afectadas, así que el
//     usuario ve sus cambios al instante después de actuar.
//   - gcTime: 30min → mantenemos el cache 30 min después de unmount. Si
//     volvés de hablar conmigo o de otra pestaña, los datos están listos.
//   - retry: 1 → un solo reintento ante fallo de red, en vez de 3 (default).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      retry: 1,
    },
  },
});

const RouteFallback = () => (
  <div className="flex h-screen w-full items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
  </div>
);

// En Modo Gerencial, "Lo que me deben" se reemplaza por Cartera Operativa.
// Si el admin entra por URL directa estando en Gerencial, lo redirigimos.
function CuentasPorCobrarGuard() {
  const { isGerencial } = useModuleContext();
  if (isGerencial) return <Navigate to="/reportes/cartera-operativa" replace />;
  return <Reports tab="cxc" />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <SubscriptionProvider>
        <ModuleProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <SessionExpiredModal />
            <AuthDebugPanel />
            <UpdateNotifier />
            <PageViewTracker />
            <RouteErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route
                path="/change-password"
                element={<ProtectedRoute><ChangePassword /></ProtectedRoute>}
              />
              <Route
                path="/onboarding"
                element={<ProtectedRoute><Onboarding /></ProtectedRoute>}
              />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/contact" element={<Contact />} />
              <Route
                path="/dashboard"
                element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
              />
              <Route
                path="/admin"
                element={<ProtectedRoute><Admin /></ProtectedRoute>}
              />
              <Route
                path="/upload"
                element={<RequireModule moduleKey="extractos"><StatementUpload /></RequireModule>}
              />
              <Route
                path="/statement-upload"
                element={<RequireModule moduleKey="extractos"><StatementUpload /></RequireModule>}
              />
              <Route
                path="/transactions"
                element={<RequireModule moduleKey="conciliacion"><Transactions /></RequireModule>}
              />
              <Route
                path="/export"
                element={<RequireModule moduleKey="exportar"><Export /></RequireModule>}
              />
              <Route
                path="/settings"
                element={<AdminRoute><Settings /></AdminRoute>}
              />
              {/* Report routes */}
              <Route
                path="/reportes"
                element={<Navigate to="/reportes/estado-resultados" replace />}
              />
              <Route
                path="/reportes/estado-resultados"
                element={<RequireModule moduleKey="estado_resultados"><Reports tab="pyg" /></RequireModule>}
              />
              <Route
                path="/reportes/anticipos"
                element={<RequireModule moduleKey="anticipos"><Reports tab="anticipos" /></RequireModule>}
              />
              <Route
                path="/reportes/cuentas-por-cobrar"
                element={<RequireModule moduleKey="cuentas_por_cobrar"><CuentasPorCobrarGuard /></RequireModule>}
              />
              <Route
                path="/reportes/cuentas-por-pagar"
                element={<RequireModule moduleKey="cuentas_por_pagar"><Reports tab="cxp" /></RequireModule>}
              />
              <Route
                path="/reportes/flujo-caja"
                element={<RequireModule moduleKey="flujo_caja"><Reports tab="caja" /></RequireModule>}
              />
              <Route
                path="/reportes/relacion-pagos"
                element={<RequireModule moduleKey="relacion_pagos"><Reports tab="pagos" /></RequireModule>}
              />
              <Route
                path="/reportes/cartera-operativa"
                element={<AdminRoute><CarteraOperativa /></AdminRoute>}
              />
              <Route
                path="/caja-menor"
                element={<RequireModule moduleKey="caja_menor"><CajaMenor /></RequireModule>}
              />
              <Route
                path="/informe-banco"
                element={<RequireModule moduleKey="informe_banco"><InformeBanco /></RequireModule>}
              />
              <Route
                path="/creditos"
                element={<RequireModule moduleKey="creditos"><Creditos /></RequireModule>}
              />
              {/* Legacy redirect */}
              <Route
                path="/reports"
                element={<Navigate to="/reportes/estado-resultados" replace />}
              />
              <Route
                path="/nico"
                element={<RequireModule moduleKey="nico_ia"><Nico /></RequireModule>}
              />
              <Route
                path="/nico/reglas"
                element={<RequireModule moduleKey="nico_ia"><Nico /></RequireModule>}
              />
              <Route
                path="/invoices/venta"
                element={<RequireModule moduleKey="facturas_venta"><InvoicesVenta /></RequireModule>}
              />
              <Route
                path="/invoices/compra"
                element={<RequireModule moduleKey="facturas_compra"><InvoicesCompra /></RequireModule>}
              />
              {/* Legacy redirect */}
              <Route
                path="/invoices"
                element={<Navigate to="/invoices/venta" replace />}
              />
              <Route
                path="/financial-health"
                element={<RequireModule moduleKey="informe_dian"><VisitaDIAN /></RequireModule>}
              />
              <Route
                path="/visita-dian"
                element={<RequireModule moduleKey="informe_dian"><VisitaDIAN /></RequireModule>}
              />
              <Route
                path="/financial-health-legacy"
                element={<RequireModule moduleKey="informe_dian"><FinancialHealth /></RequireModule>}
              />
              <Route
                path="/inventarios"
                element={<RequireModule moduleKey="inventarios"><Inventory /></RequireModule>}
              />
              <Route
                path="/colaboradores"
                element={<AdminRoute><Collaborators /></AdminRoute>}
              />
              <Route
                path="/cash-movements"
                element={<AdminRoute><CashMovements /></AdminRoute>}
              />
              <Route
                path="/founder"
                element={<AdminRoute><Founder /></AdminRoute>}
              />
              {/* Rutas viejas redirigen a tabs del Founder (deep-link compat) */}
              <Route path="/admin/analytics" element={<Navigate to="/founder?tab=analytics" replace />} />
              <Route path="/nico/evolution" element={<Navigate to="/founder?tab=evolution" replace />} />
              <Route
                path="/coming-soon"
                element={<ProtectedRoute><ComingSoon /></ProtectedRoute>}
              />
              <Route
                path="/remisiones"
                element={<RequireModule moduleKey="remisiones"><Remisiones /></RequireModule>}
              />
              <Route
                path="/cotizaciones"
                element={<RequireModule moduleKey="cotizaciones"><Cotizaciones /></RequireModule>}
              />
              <Route
                path="/productos-terminados"
                element={<RequireModule moduleKey="cotizaciones"><ProductosTerminados /></RequireModule>}
              />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            </RouteErrorBoundary>
            <TourOverlay />
          </BrowserRouter>
        </TooltipProvider>
        </ModuleProvider>
      </SubscriptionProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
