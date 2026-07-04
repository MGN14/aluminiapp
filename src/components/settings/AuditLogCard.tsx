import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { History, ChevronDown } from 'lucide-react';

const TABLE_LABEL: Record<string, string> = {
  transactions: 'Movimiento bancario',
  invoices: 'Factura',
  imports: 'Importación',
  import_payments: 'Abono importación',
  payroll_employees: 'Empleado',
  payroll_entries: 'Nómina mensual',
  inventory_products: 'Producto inventario',
  reconciliation_rules: 'Regla',
  production_orders: 'Orden de producción',
};

interface AuditRow {
  id: number;
  user_id: string | null;
  table_name: string;
  row_id: string;
  action: 'UPDATE' | 'DELETE';
  changes: Record<string, { old: unknown; new: unknown }> | null;
  created_at: string;
}

/** Auditoría: quién cambió qué (diff por campo) en las tablas sensibles. */
export default function AuditLogCard() {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);

  const { data: rows = [] } = useQuery<AuditRow[]>({
    queryKey: ['audit-log', user?.id],
    enabled: !!user && expanded,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const fmtVal = (v: unknown) => {
    if (v === null || v === undefined) return '—';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <button className="flex items-center justify-between w-full text-left" onClick={() => setExpanded(v => !v)}>
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Auditoría de cambios
            </CardTitle>
            <CardDescription className="text-xs">
              Quién cambió qué en movimientos, facturas, importaciones, nómina, inventario y reglas.
            </CardDescription>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              Sin cambios registrados todavía (la auditoría arranca desde que se activó).
            </p>
          ) : (
            <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
              {rows.map(r => (
                <div key={r.id} className="py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{TABLE_LABEL[r.table_name] ?? r.table_name}</span>
                    <span className={r.action === 'DELETE' ? 'text-destructive font-semibold' : 'text-muted-foreground'}>
                      {r.action === 'DELETE' ? 'eliminado' : 'editado'}
                    </span>
                    <span className="text-muted-foreground ml-auto shrink-0">
                      {new Date(r.created_at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {r.changes && (
                    <div className="mt-0.5 text-muted-foreground font-mono text-[10px] space-y-0.5">
                      {Object.entries(r.changes).slice(0, 4).map(([campo, d]) => (
                        <div key={campo} className="truncate">
                          {campo}: {fmtVal(d.old)} → <span className="text-foreground">{fmtVal(d.new)}</span>
                        </div>
                      ))}
                      {Object.keys(r.changes).length > 4 && (
                        <div>… y {Object.keys(r.changes).length - 4} campos más</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <Button
            variant="ghost" size="sm" className="w-full mt-2 h-7 text-xs text-muted-foreground"
            onClick={() => setExpanded(false)}
          >
            Cerrar
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
