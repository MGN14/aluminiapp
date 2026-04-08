import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { SubscriptionProvider } from "@/hooks/useSubscription";
import ProtectedRoute from "@/components/ProtectedRoute";
import SessionExpiredModal from "@/components/auth/SessionExpiredModal";
import AuthDebugPanel from "@/components/auth/AuthDebugPanel";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import StatementUpload from "./pages/StatementUpload";
import Transactions from "./pages/Transactions";
import Export from "./pages/Export";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Pricing from "./pages/Pricing";
import Contact from "./pages/Contact";
import Settings from "./pages/Settings";
import Reports from "./pages/Reports";
import Nico from "./pages/Nico";
import Invoices from "./pages/Invoices";
import FinancialHealth from "./pages/FinancialHealth";
import Inventory from "./pages/Inventory";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <SubscriptionProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <SessionExpiredModal />
            <AuthDebugPanel />
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
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
                path="/invoices"
                element={<ProtectedRoute><Invoices /></ProtectedRoute>}
              />
              <Route
                path="/financial-health"
                element={<ProtectedRoute><FinancialHealth /></ProtectedRoute>}
              />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </SubscriptionProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
