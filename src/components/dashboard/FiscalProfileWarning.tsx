import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ClipboardList } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function FiscalProfileWarning() {
  const { isLoading, completed } = useOnboardingStatus();
  const navigate = useNavigate();

  if (isLoading || completed) return null;

  return (
    <Alert className="border-accent/40 bg-accent/5">
      <ClipboardList className="h-4 w-4 text-accent" />
      <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-2">
        <span className="text-foreground">
          Configura tu perfil fiscal para que los cálculos de impuestos sean precisos.
        </span>
        <Button
          size="sm"
          variant="outline"
          className="w-fit border-accent/40 text-accent hover:bg-accent/10"
          onClick={() => navigate('/onboarding')}
        >
          Configurar ahora
        </Button>
      </AlertDescription>
    </Alert>
  );
}
