import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { SubscriptionProvider } from "@/hooks/useSubscription";
import { ModuleProvider } from "@/hooks/useModuleContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import SessionExpiredModal from "@/components/auth/SessionExpiredModal";
import AuthDebugPanel from "@/components/auth/AuthDebugPanel";

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
const Collaborators = lazy(() => import("./pages/Collaborators"));
const ComingSoon = lazy(() => import("./pages/ComingSoon"));
const Remisiones = lazy(() => import("./pages/Remisiones"));
const CashMovements = lazy(() => import("./pages/CashMovements"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="flex h-screen w-full items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
  </div>
);

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
                path="/upload"
                element={<ProtectedRoute><StatementUpload /></ProtectedRoute>}
              />
              <Route
                path="/statement-upload"
                element={<ProtectedRoute><StatementUpload /></ProtectedRoute>}
              />
              <Route
                path="/transactions"
                element={<ProtectedRoute><Transactions /></ProtectedRoute>}
              />
              <Route
                path="/export"
                element={<ProtectedRoute><Export /></ProtectedRoute>}
              />
              <Route
                path="/settings"
                element={<ProtectedRoute><Settings /></ProtectedRoute>}
              />
              {/* Report routes */}
              <Route
                path="/reportes"
                element={<Navigate to="/reportes/estado-resultados" replace />}
              />
              <Route
                path="/reportes/estado-resultados"
                element={<ProtectedRoute><Reports tab="pyg" /></ProtectedRoute>}
              />
              <Route
                path="/reportes/anticipos"
                element={<ProtectedRoute><Reports tab="anticipos" /></ProtectedRoute>}
              />
              <Route
                path="/reportes/cuentas-por-cobrar"
                element={<ProtectedRoute><Reports tab="cxc" /></ProtectedRoute>}
              />
              <Route
                path="/reportes/cuentas-por-pagar"
                element={<ProtectedRoute><Reports tab="cxp" /></ProtectedRoute>}
              />
              {/* Legacy redirect */}
              <Route
                path="/reports"
                element={<Navigate to="/reportes/estado-resultados" replace />}
              />
              <Route
                path="/nico"
                element={<ProtectedRoute><Nico /></ProtectedRoute>}
              />
              <Route
                path="/nico/reglas"
                element={<ProtectedRoute><Nico /></ProtectedRoute>}
              />
              <Route
                path="/invoices/venta"
                element={<ProtectedRoute><InvoicesVenta /></ProtectedRoute>}
              />
              <Route
                path="/invoices/compra"
                element={<ProtectedRoute><InvoicesCompra /></ProtectedRoute>}
              />
              {/* Legacy redirect */}
              <Route
                path="/invoices"
                element={<Navigate to="/invoices/venta" replace />}
              />
              <Route
                path="/financial-health"
                element={<ProtectedRoute><VisitaDIAN /></ProtectedRoute>}
              />
              <Route
                path="/visita-dian"
                element={<ProtectedRoute><VisitaDIAN /></ProtectedRoute>}
              />
              <Route
                path="/financial-health-legacy"
                element={<ProtectedRoute><FinancialHealth /></ProtectedRoute>}
              />
              <Route
                path="/inventarios"
                element={<ProtectedRoute><Inventory /></ProtectedRoute>}
              />
              <Route
                path="/colaboradores"
                element={<ProtectedRoute><Collaborators /></ProtectedRoute>}
              />
              <Route
                path="/cash-movements"
                element={<AdminRoute><CashMovements /></AdminRoute>}
              />
              <Route
                path="/coming-soon"
                element={<ProtectedRoute><ComingSoon /></ProtectedRoute>}
              />
              <Route
                path="/remisiones"
                element={<ProtectedRoute><Remisiones /></ProtectedRoute>}
              />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
        </ModuleProvider>
      </SubscriptionProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
