import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface FixDatesButtonProps {
  statementId: string;
  statementMonth: number | null;
  statementYear: number | null;
  onFixed?: () => void;
}

export function FixDatesButton({ statementId, statementMonth, statementYear, onFixed }: FixDatesButtonProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ fixed: number } | null>(null);
  const { toast } = useToast();

  const handleFixDates = async () => {
    if (!statementMonth || !statementYear) {
      toast({
        title: "Periodo no definido",
        description: "Este extracto no tiene mes/año asignado. Edítalo primero.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.rpc('fix_transaction_dates_for_statement', {
        p_statement_id: statementId,
      });

      if (error) throw error;

      const fixedCount = data as number;
      setResult({ fixed: fixedCount });

      toast({
        title: "Fechas corregidas",
        description: `Se actualizaron ${fixedCount} transacciones al año ${statementYear}.`,
      });

      onFixed?.();
    } catch (error) {
      console.error('Error fixing dates:', error);
      toast({
        title: "Error",
        description: "No se pudieron corregir las fechas.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!statementMonth || !statementYear) {
    return null;
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleFixDates}
      disabled={loading}
      className="gap-2"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : result ? (
        <CheckCircle className="h-4 w-4 text-success" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
      {loading ? 'Corrigiendo...' : result ? `${result.fixed} corregidas` : 'Corregir fechas'}
    </Button>
  );
}

interface StatementPeriodEditorProps {
  statementId: string;
  currentMonth: number | null;
  currentYear: number | null;
  onUpdate?: () => void;
}

export function StatementPeriodEditor({ statementId, currentMonth, currentYear, onUpdate }: StatementPeriodEditorProps) {
  const [month, setMonth] = useState(currentMonth?.toString() || '');
  const [year, setYear] = useState(currentYear?.toString() || '');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    if (!monthNum || monthNum < 1 || monthNum > 12) {
      toast({ title: "Mes inválido", variant: "destructive" });
      return;
    }

    if (!yearNum || yearNum < 2020 || yearNum > 2030) {
      toast({ title: "Año inválido", variant: "destructive" });
      return;
    }

    setLoading(true);

    try {
      const periodStart = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
      const periodEnd = new Date(yearNum, monthNum, 0).toISOString().split('T')[0];

      const { error } = await supabase
        .from('bank_statements')
        .update({
          statement_month: monthNum,
          statement_year: yearNum,
          period_start: periodStart,
          period_end: periodEnd,
        })
        .eq('id', statementId);

      if (error) throw error;

      toast({
        title: "Periodo actualizado",
        description: `Extracto configurado para ${monthNum}/${yearNum}.`,
      });

      onUpdate?.();
    } catch (error) {
      console.error('Error updating period:', error);
      toast({
        title: "Error",
        description: "No se pudo actualizar el periodo.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Periodo del Extracto</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="Mes (1-12)"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-24 px-3 py-2 border rounded-md text-sm"
            min={1}
            max={12}
          />
          <input
            type="number"
            placeholder="Año"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="w-24 px-3 py-2 border rounded-md text-sm"
            min={2020}
            max={2030}
          />
          <Button onClick={handleSave} disabled={loading} size="sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
          </Button>
        </div>
        {currentMonth && currentYear && (
          <div className="flex items-center gap-2">
            <FixDatesButton
              statementId={statementId}
              statementMonth={parseInt(month) || currentMonth}
              statementYear={parseInt(year) || currentYear}
              onFixed={onUpdate}
            />
            <span className="text-xs text-muted-foreground">
              Corrige transacciones con año incorrecto
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
