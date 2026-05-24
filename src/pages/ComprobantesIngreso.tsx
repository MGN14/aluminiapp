import { useState, useMemo } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FileText, Plus, Search, Loader2, ReceiptText, Sparkles } from 'lucide-react';
import { useIncomeReceipts, type IncomeReceiptRow } from '@/hooks/useIncomeReceipts';
import IncomeReceiptModal from '@/components/income-receipts/IncomeReceiptModal';

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const fmtDate = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function ComprobantesIngreso() {
  const { receipts, isLoading } = useIncomeReceipts();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IncomeReceiptRow | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return receipts;
    return receipts.filter((r) =>
      r.payer_name.toLowerCase().includes(q)
      || (r.numero_consecutivo ?? '').toLowerCase().includes(q)
      || r.concept.toLowerCase().includes(q)
      || (r.reference_doc ?? '').toLowerCase().includes(q)
    );
  }, [receipts, search]);

  const totalMes = useMemo(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = now.getMonth();
    return receipts
      .filter((r) => {
        const d = new Date(r.fecha + 'T00:00:00');
        return d.getFullYear() === yyyy && d.getMonth() === mm;
      })
      .reduce((s, r) => s + Number(r.amount), 0);
  }, [receipts]);

  const handleNew = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const handleEdit = (r: IncomeReceiptRow) => {
    setEditing(r);
    setModalOpen(true);
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ReceiptText className="h-6 w-6 text-success" />
              Comprobantes de ingreso
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Recibos de caja que le entregás al cliente cuando recibís un pago. Numeración automática <span className="font-mono">RC-YYYY-NNNN</span>.
            </p>
          </div>
          <Button onClick={handleNew} size="lg" className="gap-2">
            <Plus className="h-4 w-4" />
            Nuevo comprobante
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">Comprobantes este mes</p>
              <p className="text-2xl font-bold mt-1 font-mono">
                {receipts.filter((r) => {
                  const d = new Date(r.fecha + 'T00:00:00');
                  const now = new Date();
                  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
                }).length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">Ingreso recibido este mes</p>
              <p className="text-2xl font-bold mt-1 font-mono text-success">{fmtMoney(totalMes)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">Total histórico</p>
              <p className="text-2xl font-bold mt-1 font-mono">{receipts.length}</p>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por pagador, número, concepto o factura..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Lista */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Historial
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {filtered.length} de {receipts.length}
              </span>
            </CardTitle>
            <CardDescription className="text-xs flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-primary" />
              Tocá una fila para editar o re-generar el PDF.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Cargando…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {search ? 'No hay resultados para esta búsqueda.' : 'Todavía no creaste ningún comprobante. Empezá con "Nuevo comprobante".'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-left py-2 pr-3 font-medium">N°</th>
                      <th className="text-left py-2 pr-3 font-medium">Fecha</th>
                      <th className="text-left py-2 pr-3 font-medium">Pagador</th>
                      <th className="text-left py-2 pr-3 font-medium">Concepto</th>
                      <th className="text-right py-2 pr-3 font-medium">Monto</th>
                      <th className="text-left py-2 pr-3 font-medium">Método</th>
                      <th className="text-center py-2 pr-2 font-medium">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => handleEdit(r)}
                        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                      >
                        <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                          {r.numero_consecutivo ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-xs">{fmtDate(r.fecha)}</td>
                        <td className="py-2 pr-3 font-medium truncate max-w-[200px]">{r.payer_name}</td>
                        <td className="py-2 pr-3 text-muted-foreground text-xs truncate max-w-[260px]">{r.concept}</td>
                        <td className="py-2 pr-3 text-right font-mono font-semibold">{fmtMoney(Number(r.amount))}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{r.payment_method ?? '—'}</td>
                        <td className="py-2 pr-2 text-center">
                          {r.use_letterhead ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">Membrete</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">Limpio</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <IncomeReceiptModal
        open={modalOpen}
        onOpenChange={(o) => { setModalOpen(o); if (!o) setEditing(null); }}
        editing={editing}
      />
    </AppLayout>
  );
}
