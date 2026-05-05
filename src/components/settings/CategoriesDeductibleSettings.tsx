import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BadgeCheck, BadgeX, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { formatUvtAsCOP } from '@/lib/uvt';

interface CategoryRow {
  id: string;
  name: string;
  is_tax_deductible: boolean;
}

export default function CategoriesDeductibleSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [updating, setUpdating] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const { data: categories = [] } = useQuery<CategoryRow[]>({
    queryKey: ['categories-deducible-settings', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, is_tax_deductible')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleToggle = async (id: string, current: boolean) => {
    setUpdating(id);
    try {
      const { error } = await supabase
        .from('categories')
        .update({ is_tax_deductible: !current } as never)
        .eq('id', id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['categories-deducible-settings'] });
      // Invalidar otras queries que usen el flag
      await queryClient.invalidateQueries({ queryKey: ['categories-caja-menor'] });
      await queryClient.invalidateQueries({ queryKey: ['petty-cash-movements'] });
      await queryClient.invalidateQueries({ queryKey: ['pyg-fiscal-exposure'] });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setUpdating(null);
    }
  };

  const deducibles = categories.filter((c) => c.is_tax_deductible);
  const noDeducibles = categories.filter((c) => !c.is_tax_deductible);

  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium text-sm flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-muted-foreground" />
          Deducibilidad fiscal por categoría
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Marcá cuáles categorías de gasto son deducibles según DIAN. El flag se aplica a todos
          los movimientos (Caja Menor + Conciliación bancaria) y al cálculo de exposición fiscal en PyG.
        </p>
      </div>

      {/* Guía DIAN 2026 colapsable */}
      <Card className="border-blue-200 bg-blue-50/40 dark:bg-blue-950/10">
        <button
          type="button"
          onClick={() => setShowGuide((v) => !v)}
          className="w-full flex items-center justify-between p-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-blue-900 dark:text-blue-100">
            <Info className="h-4 w-4" />
            Guía rápida DIAN 2026 — qué suele ser deducible
          </span>
          {showGuide ? (
            <ChevronUp className="h-4 w-4 text-blue-700 dark:text-blue-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-blue-700 dark:text-blue-400" />
          )}
        </button>
        {showGuide && (
          <div className="px-3 pb-3 text-xs text-blue-900 dark:text-blue-100 space-y-2">
            <div>
              <strong className="text-success">✓ Típicamente deducibles</strong> (con relación de
              causalidad + factura electrónica/soporte válido):
              <ul className="list-disc list-inside ml-2 mt-1 space-y-0.5">
                <li>Salarios, prestaciones, parafiscales (SENA, ICBF, cajas)</li>
                <li>Arrendamiento de oficinas, bodegas, locales</li>
                <li>Servicios públicos (agua, luz, internet, teléfono)</li>
                <li>Compra de mercancía y materia prima</li>
                <li>Honorarios profesionales</li>
                <li>Mantenimiento, publicidad, papelería</li>
                <li>Transporte y combustible para mercadería</li>
                <li>Depreciación (con métodos del Estatuto Tributario)</li>
                <li>Intereses financieros (con tope 30% EBITDA)</li>
                <li>ICA (al 100% si pagado antes de declarar)</li>
                <li>4x1000 (al 50% — deducción parcial)</li>
              </ul>
            </div>
            <div>
              <strong className="text-destructive">✗ Típicamente NO deducibles</strong>:
              <ul className="list-disc list-inside ml-2 mt-1 space-y-0.5">
                <li>Multas, sanciones, intereses moratorios DIAN</li>
                <li>Gastos sin factura electrónica o documento equivalente</li>
                <li>Gastos personales de socios/empleados sin relación a la actividad</li>
                <li>Pagos a paraísos fiscales (sin retención 33%)</li>
                <li>Donaciones sin certificado válido</li>
                <li>IVA descontable (se cruza con IVA, no en renta)</li>
                <li>Gastos en efectivo &gt; 100 UVT por transacción ({formatUvtAsCOP(100)} en 2026)</li>
              </ul>
            </div>
            <p className="italic text-blue-700 dark:text-blue-300 pt-1">
              Cada caso es distinto. Consultá con tu contador antes de configurar — AluminIA no
              asesora en materia fiscal. Esta guía es solo orientativa basada en reglas generales DIAN 2026.
            </p>
          </div>
        )}
      </Card>

      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tenés categorías creadas aún.</p>
      ) : (
        <>
          {/* Deducibles */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-success border-success/30 bg-success/10 gap-1">
                <BadgeCheck className="h-3 w-3" />
                Deducibles
              </Badge>
              <span className="text-xs text-muted-foreground">{deducibles.length}</span>
            </div>
            {deducibles.length === 0 ? (
              <p className="text-xs text-muted-foreground italic ml-1">Ninguna categoría marcada como deducible.</p>
            ) : (
              <div className="space-y-1">
                {deducibles.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-2 rounded-lg border bg-success/5">
                    <span className="text-sm">{c.name}</span>
                    <Switch
                      checked={c.is_tax_deductible}
                      disabled={updating === c.id}
                      onCheckedChange={() => handleToggle(c.id, c.is_tax_deductible)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* No deducibles */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-muted-foreground gap-1">
                <BadgeX className="h-3 w-3" />
                No deducibles
              </Badge>
              <span className="text-xs text-muted-foreground">{noDeducibles.length}</span>
            </div>
            {noDeducibles.length === 0 ? (
              <p className="text-xs text-muted-foreground italic ml-1">Ninguna.</p>
            ) : (
              <div className="space-y-1">
                {noDeducibles.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-2 rounded-lg border">
                    <span className="text-sm">{c.name}</span>
                    <Switch
                      checked={c.is_tax_deductible}
                      disabled={updating === c.id}
                      onCheckedChange={() => handleToggle(c.id, c.is_tax_deductible)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
