import { useMemo, useState, useEffect } from 'react';
import { Invoice } from '@/types/invoice';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

interface Props {
  invoices: Invoice[];
}

interface MonthSummary {
  month: string;
  monthLabel: string;
  ventasBase: number;
  ventasIva: number;
  ventasReteica: number;
  ventasAutoretefuente: number;
  comprasBase: number;
  comprasIva: number;
  comprasRetefuente: number;
}

export default function DIANSummary({ invoices }: Props) {
  const [retefuenteCompraRate, setRetefuenteCompraRate] = useState(0);

  useEffect(() => {
    supabase.from('tax_settings').select('retefuente_compra_rate').limit(1).maybeSingle()
      .then(({ data }) => {
        if (data) setRetefuenteCompraRate(data.retefuente_compra_rate || 0);
      });
  }, []);
  const summaryByMonth = useMemo(() => {
    const map = new Map<string, MonthSummary>();

    for (const inv of invoices) {
      const d = parseISO(inv.issue_date);
      const key = format(d, 'yyyy-MM');
      const label = format(d, 'MMMM yyyy', { locale: es });

      if (!map.has(key)) {
        map.set(key, {
          month: key,
          monthLabel: label.charAt(0).toUpperCase() + label.slice(1),
          ventasBase: 0,
          ventasIva: 0,
          ventasReteica: 0,
          ventasAutoretefuente: 0,
          comprasBase: 0,
          comprasIva: 0,
          comprasRetefuente: 0,
        });
      }

      const s = map.get(key)!;
      if (inv.type === 'venta') {
        s.ventasBase += inv.subtotal_base;
        s.ventasIva += inv.iva_amount;
        s.ventasReteica += inv.reteica_amount || 0;
        s.ventasAutoretefuente += inv.autoretefuente_amount || 0;
      } else {
        s.comprasBase += inv.subtotal_base;
        s.comprasIva += inv.iva_amount;
        s.comprasRetefuente += Math.round(inv.subtotal_base * retefuenteCompraRate);
      }
    }

    return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month));
  }, [invoices, retefuenteCompraRate]);

  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="font-medium">Sin datos para el resumen DIAN</p>
          <p className="text-sm mt-1">Confirma al menos una factura para ver el resumen fiscal mensual.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {summaryByMonth.map((s) => (
        <Card key={s.month}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{s.monthLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Ventas */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="text-xs">Ventas</Badge>
                </div>
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-sm text-muted-foreground">Base gravable</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(s.ventasBase)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm text-muted-foreground">IVA generado</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(s.ventasIva)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm text-muted-foreground">ReteICA estimado</TableCell>
                      <TableCell className="text-right font-medium">
                        {s.ventasReteica > 0 ? formatCurrency(s.ventasReteica) : (
                          <span className="text-xs text-muted-foreground">Pendiente configurar</span>
                        )}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm text-muted-foreground">Autorretefuente estimada</TableCell>
                      <TableCell className="text-right font-medium">
                        {s.ventasAutoretefuente > 0 ? formatCurrency(s.ventasAutoretefuente) : (
                          <span className="text-xs text-muted-foreground">Pendiente configurar</span>
                        )}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {/* Compras */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">Compras</Badge>
                </div>
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-sm text-muted-foreground">Base gravable</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(s.comprasBase)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm text-muted-foreground">IVA descontable</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(s.comprasIva)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm text-muted-foreground">Retefuente en compras</TableCell>
                      <TableCell className="text-right font-medium">
                        {s.comprasRetefuente > 0 ? formatCurrency(s.comprasRetefuente) : (
                          <span className="text-xs text-muted-foreground">Configurar en Ajustes</span>
                        )}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
