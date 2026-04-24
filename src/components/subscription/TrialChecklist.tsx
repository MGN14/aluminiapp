import { useSubscription, TrialChecklist as ChecklistType } from '@/hooks/useSubscription';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, Upload, FileText, Link2, BarChart3, Sparkles, ArrowRight } from 'lucide-react';

const checklistItems: { key: keyof ChecklistType; label: string; icon: React.ComponentType<{ className?: string }>; link: string }[] = [
  { key: 'statement_uploaded', label: 'Subir un extracto bancario', icon: Upload, link: '/statement-upload' },
  { key: 'invoice_uploaded', label: 'Subir una factura', icon: FileText, link: '/invoices' },
  { key: 'invoice_matched', label: 'Asociar factura a movimiento', icon: Link2, link: '/transactions' },
  { key: 'dian_reviewed', label: 'Revisar las cuentas con la DIAN', icon: BarChart3, link: '/dashboard' },
];

export default function TrialChecklist() {
  const { isTrialing, trialChecklist, loading, isAdmin, isFounder } = useSubscription();

  if (loading || !isTrialing || isAdmin || isFounder || !trialChecklist) return null;

  const completedCount = Object.values(trialChecklist).filter(Boolean).length;
  const allComplete = completedCount === 4;

  return (
    <Card className="border-accent/30 bg-accent/5 animate-fade-in">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-accent" />
          <CardTitle className="text-base">
            {allComplete
              ? '¡Ya estás usando AluminIA como una empresa real!'
              : 'Para aprovechar tu prueba al máximo:'}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {allComplete ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Activa tu plan para continuar con todas las funciones.
            </p>
            <Link to="/pricing">
              <Button className="gap-1">
                Activar Plan
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {checklistItems.map(({ key, label, icon: Icon, link }) => {
              const done = trialChecklist[key];
              return (
                <Link
                  key={key}
                  to={link}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    done
                      ? 'border-success/30 bg-success/5'
                      : 'border-border hover:border-accent/50 hover:bg-accent/5'
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Icon className={`h-4 w-4 flex-shrink-0 ${done ? 'text-success' : 'text-muted-foreground'}`} />
                    <span className={`text-sm ${done ? 'text-success line-through' : 'text-foreground'}`}>
                      {label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>{completedCount}/4 completados</span>
        </div>
      </CardContent>
    </Card>
  );
}
