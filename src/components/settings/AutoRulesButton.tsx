import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Wand2 } from 'lucide-react';
import { AUTO_RULES, findMatchingRule } from '@/lib/autoRules';

interface ApplyResult {
  total: number;
  updated: number;
  skipped: number;
  errors: number;
}

export default function AutoRulesButton() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const applyAutoRules = async () => {
    if (!user) return;

    setApplying(true);
    setProgress(0);
    setResult(null);

    try {
      // 1. Fetch user's profile for ReteICA rate
      const { data: profile } = await supabase
        .from('profiles')
        .select('reteica_rate')
        .eq('user_id', user.id)
        .maybeSingle();
      
      const reteicaRate = profile?.reteica_rate || 0;

      // 2. Fetch all transactions for this user
      const { data: transactions, error: fetchError } = await supabase
        .from('transactions')
        .select('id, description, amount, type, category_id, responsible_id, has_iva, has_retefuente, has_reteica')
        .eq('user_id', user.id)
        .is('deleted_at', null);

      if (fetchError) throw fetchError;
      if (!transactions || transactions.length === 0) {
        toast({
          title: 'Sin transacciones',
          description: 'No hay transacciones para procesar.',
        });
        setApplying(false);
        return;
      }

      // 3. Fetch/create categories and responsibles we need
      const categoriesMap = await getOrCreateCategories(user.id);
      const responsiblesMap = await getOrCreateResponsibles(user.id);

      // 4. Apply rules to each transaction
      const total = transactions.length;
      let updated = 0;
      let skipped = 0;
      let errors = 0;

      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        const rule = findMatchingRule(tx.description);

        if (!rule) {
          skipped++;
          setProgress(Math.round(((i + 1) / total) * 100));
          continue;
        }

        try {
          // Get category ID
          const categoryId = categoriesMap[rule.categoryName.toLowerCase()] || null;
          
          // Get responsible ID (null if rule says null)
          const responsibleId = rule.responsibleName 
            ? (responsiblesMap[rule.responsibleName.toLowerCase()] || null)
            : null;

          // Calculate tax amounts
          const absAmount = Math.abs(tx.amount || 0);
          const ivaAmount = rule.hasIva ? absAmount * 0.19 : 0;
          const retefuenteAmount = rule.hasRetefuente && rule.type === 'egreso' ? absAmount * 0.025 : 0;
          const reteicaAmount = rule.hasReteica && reteicaRate > 0 && rule.type === 'ingreso' 
            ? Math.round(absAmount * (reteicaRate / 100)) 
            : 0;

          // Update the transaction
          const { error: updateError } = await supabase
            .from('transactions')
            .update({
              type: rule.type,
              category_id: categoryId,
              category: rule.categoryName.toLowerCase(),
              responsible_id: responsibleId,
              has_iva: rule.hasIva,
              has_retefuente: rule.hasRetefuente,
              has_reteica: rule.hasReteica && reteicaRate > 0,
              iva_amount: ivaAmount,
              retefuente_amount: retefuenteAmount,
              reteica_amount: reteicaAmount,
            })
            .eq('id', tx.id);

          if (updateError) {
            console.error('Error updating transaction:', updateError);
            errors++;
          } else {
            updated++;
          }
        } catch (err) {
          console.error('Error processing transaction:', err);
          errors++;
        }

        setProgress(Math.round(((i + 1) / total) * 100));
      }

      setResult({ total, updated, skipped, errors });

      toast({
        title: 'Reglas aplicadas',
        description: `${updated} transacciones actualizadas, ${skipped} sin cambios${errors > 0 ? `, ${errors} errores` : ''}.`,
      });

    } catch (error) {
      console.error('Error applying auto-rules:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron aplicar las reglas automáticas.',
        variant: 'destructive',
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Aplica reglas automáticas de categorización basadas en la descripción de cada transacción.
          Esto clasificará automáticamente transacciones como intereses, impuestos (GMF, IVA), 
          consignaciones de ventas, y servicios bancarios.
        </p>
        <p className="text-xs text-muted-foreground">
          <strong>Reglas incluidas:</strong> {AUTO_RULES.map(r => r.name).join(', ')}.
        </p>
      </div>

      <Button 
        onClick={applyAutoRules} 
        disabled={applying}
        variant="outline"
        className="w-full sm:w-auto"
      >
        {applying ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Aplicando reglas...
          </>
        ) : (
          <>
            <Wand2 className="h-4 w-4 mr-2" />
            Aplicar reglas a transacciones existentes
          </>
        )}
      </Button>

      {applying && (
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">{progress}%</p>
        </div>
      )}

      {result && !applying && (
        <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
          <p><strong>Resultado:</strong></p>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>{result.total} transacciones procesadas</li>
            <li>{result.updated} actualizadas con reglas</li>
            <li>{result.skipped} sin coincidencia de regla</li>
            {result.errors > 0 && <li className="text-destructive">{result.errors} errores</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

// Helper to get or create required categories
async function getOrCreateCategories(userId: string): Promise<Record<string, string>> {
  const categoryNames = ['Otros', 'Impuestos', 'Ventas', 'Gastos Operativos'];
  const map: Record<string, string> = {};

  for (const name of categoryNames) {
    const { data: existing } = await supabase
      .from('categories')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', name)
      .maybeSingle();

    if (existing) {
      map[name.toLowerCase()] = existing.id;
    } else {
      const { data: newCat } = await supabase
        .from('categories')
        .insert({ user_id: userId, name, sort_order: 999 })
        .select('id')
        .single();
      
      if (newCat) {
        map[name.toLowerCase()] = newCat.id;
      }
    }
  }

  return map;
}

// Helper to get or create required responsibles
async function getOrCreateResponsibles(userId: string): Promise<Record<string, string>> {
  const responsibleNames = ['Banco', 'DIAN'];
  const map: Record<string, string> = {};

  for (const name of responsibleNames) {
    const { data: existing } = await supabase
      .from('responsibles')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', name)
      .maybeSingle();

    if (existing) {
      map[name.toLowerCase()] = existing.id;
    } else {
      const { data: newResp } = await supabase
        .from('responsibles')
        .insert({ user_id: userId, name })
        .select('id')
        .single();
      
      if (newResp) {
        map[name.toLowerCase()] = newResp.id;
      }
    }
  }

  return map;
}
