import { useInitialFinancialState } from '@/hooks/useInitialFinancialState';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function InitialStateWarning() {
  const { isConfigured, loading } = useInitialFinancialState();
  const navigate = useNavigate();

  if (loading || isConfigured) return null;

  return (
    <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-2">
        <span className="text-amber-800 dark:text-amber-200">
          Algunos reportes pueden ser inexactos hasta que configures tu estado financiero inicial.
        </span>
        <Button
          size="sm"
          variant="outline"
          className="w-fit border-amber-400 text-amber-700 hover:bg-amber-100"
          onClick={() => navigate('/settings')}
        >
          Configurar ahora
        </Button>
      </AlertDescription>
    </Alert>
  );
}
