// Banner compacto del Centro de migración para el Dashboard.
//
// Reemplaza al viejo OnboardingGuide (3 pasos genéricos): ahora el camino
// completo vive en /migracion y este banner solo muestra el progreso real
// y el próximo paso. Se oculta solo cuando la migración obligatoria está
// completa — sin botón de dismiss: si falta algo, se muestra.

import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Rocket, ArrowRight } from 'lucide-react';
import { useDataOwner } from '@/hooks/useDataOwner';
import { useMigrationStatus, migrationProgress, MIGRATION_REQUIRED_KEYS } from '@/hooks/useMigrationStatus';

const STEP_LABELS: Record<(typeof MIGRATION_REQUIRED_KEYS)[number], string> = {
  fiscal_done: 'completar tu perfil fiscal',
  initial_done: 'cargar los saldos iniciales',
  products_done: 'traer tus productos',
  invoices_done: 'subir tus facturas',
  bank_done: 'subir el extracto del banco',
};

export default function MigrationBanner() {
  const navigate = useNavigate();
  const { isCollaborator } = useDataOwner();
  const statusQ = useMigrationStatus();

  if (isCollaborator || !statusQ.data) return null;

  const s = statusQ.data;
  const { done, total, pct } = migrationProgress(s);
  if (done === total) return null;

  const nextKey = MIGRATION_REQUIRED_KEYS.find((k) => !s[k]);

  return (
    <Card className="border-primary/30 bg-primary/5 animate-fade-in">
      <CardContent className="py-4 px-5">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Rocket className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-medium">
              Montá tu negocio en AluminIA — {done}/{total} pasos
            </p>
            <p className="text-xs text-muted-foreground">
              {nextKey ? `Siguiente: ${STEP_LABELS[nextKey]}.` : ''} Cada paso te lleva directo a donde se sube.
            </p>
          </div>
          <div className="w-28 hidden sm:block">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => navigate('/migracion')}>
            Continuar <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
