import { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Calculator,
  Plus,
  BookOpen,
  Search,
  FileText,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useQuotations } from '@/hooks/useQuotations';
import type { QuotationStatus } from '@/types/quotation';
import AluminumCatalogModal from '@/components/quotes/AluminumCatalogModal';
import NewQuoteModal from '@/components/quotes/NewQuoteModal';
import QuoteDetailModal from '@/components/quotes/QuoteDetailModal';

const STATUS_LABELS: Record<
  QuotationStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  draft: { label: 'Borrador', variant: 'outline' },
  sent: { label: 'Enviada', variant: 'secondary' },
  accepted: { label: 'Aceptada', variant: 'default' },
  rejected: { label: 'Rechazada', variant: 'destructive' },
  expired: { label: 'Vencida', variant: 'destructive' },
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export default function Cotizaciones() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QuotationStatus | 'all'>('all');
  const [showCatalog, setShowCatalog] = useState(false);
  const [showNewQuote, setShowNewQuote] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: quotes = [], isLoading } = useQuotations({
    status: statusFilter,
    search,
  });

  const handleNewQuote = () => setShowNewQuote(true);

  const isEmpty = !isLoading && quotes.length === 0 && !search && statusFilter === 'all';

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Calculator className="h-6 w-6 text-muted-foreground" />
              Cotizaciones
            </h1>
            <p className="text-sm text-muted-foreground">
              Cotizá ventanas y puertas a partir de tus productos terminados. Envialas por email o WhatsApp.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowCatalog(true)}>
              <BookOpen className="h-4 w-4 mr-1.5" />
              Productos terminados
            </Button>
            <Button size="sm" onClick={handleNewQuote}>
              <Plus className="h-4 w-4 mr-1.5" />
              Nueva cotización
            </Button>
          </div>
        </div>

        {/* Empty state */}
        {isEmpty ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-4">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                <Sparkles className="h-7 w-7 text-muted-foreground" />
              </div>
              <div className="space-y-1.5 max-w-md">
                <h3 className="text-lg font-medium">Aún no tenés cotizaciones</h3>
                <p className="text-sm text-muted-foreground">
                  Empezá cargando tu catálogo de productos (sistema + color + precio por m²).
                  Después armás cotizaciones en 2 minutos y las enviás directo al cliente.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => setShowCatalog(true)}>
                  <BookOpen className="h-4 w-4 mr-1.5" />
                  Cargar catálogo
                </Button>
                <Button size="sm" onClick={handleNewQuote}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Nueva cotización
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Filters */}
            <Card>
              <CardContent className="py-4 flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por número o cliente..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8"
                  />
                </div>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as QuotationStatus | 'all')}
                >
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="draft">Borradores</SelectItem>
                    <SelectItem value="sent">Enviadas</SelectItem>
                    <SelectItem value="accepted">Aceptadas</SelectItem>
                    <SelectItem value="rejected">Rechazadas</SelectItem>
                    <SelectItem value="expired">Vencidas</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* Table */}
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : quotes.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No hay cotizaciones que coincidan con los filtros.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Número</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Emisión</TableHead>
                        <TableHead>Vence</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="w-[50px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quotes.map((q) => {
                        const statusInfo = STATUS_LABELS[q.status];
                        return (
                          <TableRow
                            key={q.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => setDetailId(q.id)}
                          >
                            <TableCell className="font-mono text-xs">{q.quote_number}</TableCell>
                            <TableCell>{q.responsible_name ?? '—'}</TableCell>
                            <TableCell className="text-xs">{formatDate(q.issue_date)}</TableCell>
                            <TableCell className="text-xs">{formatDate(q.valid_until)}</TableCell>
                            <TableCell>
                              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {formatCurrency(
                                q.apply_iva
                                  ? Number(q.total_with_iva)
                                  : Number(q.total),
                              )}
                              {q.apply_iva && (
                                <span className="text-[9px] text-muted-foreground ml-1">
                                  c/IVA
                                </span>
                              )}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDetailId(q.id)}
                              >
                                <FileText className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <AluminumCatalogModal open={showCatalog} onOpenChange={setShowCatalog} />
      <NewQuoteModal
        open={showNewQuote}
        onOpenChange={setShowNewQuote}
        onCreated={(id) => {
          setShowNewQuote(false);
          setDetailId(id);
        }}
      />
      <QuoteDetailModal
        quoteId={detailId}
        open={!!detailId}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
        onDeleted={() => setDetailId(null)}
      />
    </AppLayout>
  );
}
