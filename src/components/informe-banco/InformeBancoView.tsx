import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Building2, FileDown, Loader2, AlertCircle, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { useInformeBancoData, type SemaforoColor } from '@/hooks/useInformeBancoData';
import { generateInformeBancoPdf } from '@/lib/informeBancoPdf';
import { useToast } from '@/hooks/use-toast';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value);
}

function semaforoIcon(color: SemaforoColor) {
  if (color === 'green') return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (color === 'yellow') return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  return <XCircle className="h-4 w-4 text-destructive" />;
}

function semaforoLabel(color: SemaforoColor) {
  if (color === 'green') return { text: 'Bueno', cls: 'bg-success/10 text-success border-success/30' };
  if (color === 'yellow') return { text: 'Revisar', cls: 'bg-amber-100 text-amber-700 border-amber-300' };
  return { text: 'Crítico', cls: 'bg-destructive/10 text-destructive border-destructive/30' };
}

export default function InformeBancoView() {
  const { data, isLoading, error } = useInformeBancoData();
  const { toast } = useToast();

  const handleDownloadPdf = () => {
    if (!data) return;
    try {
      const pdf = generateInformeBancoPdf(data);
      const slug = data.empresa.nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      pdf.save(`informe-banco-${slug}-${data.thisYear}.pdf`);
      toast({ title: 'PDF generado' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Cargando datos del informe...</span>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">Error al cargar el informe.</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Datos de empresa */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            Datos de la empresa
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Razón social</span>
              <p className="font-semibold">{data.empresa.nombre}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">NIT</span>
              <p className="font-semibold">{data.empresa.nit ?? '— editar en Ajustes'}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Ciudad</span>
              <p>{data.empresa.ciudad ?? '—'}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Dirección</span>
              <p>{data.empresa.direccion ?? '—'}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Teléfono</span>
              <p>{data.empresa.telefono ?? '—'}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Antigüedad</span>
              <p>
                {data.empresa.antiguedadMeses === 0
                  ? '—'
                  : data.empresa.antiguedadMeses < 12
                    ? `${data.empresa.antiguedadMeses} meses`
                    : `${Math.floor(data.empresa.antiguedadMeses / 12)} años y ${data.empresa.antiguedadMeses % 12} meses`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs financieros del año */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ingresos {data.thisYear}</p>
            <p className="text-xl font-bold text-success mt-1">{formatCurrency(data.ingresosBancoAno)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Promedio mensual: {formatCurrency(data.promedioVentasMensual)}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Egresos {data.thisYear}</p>
            <p className="text-xl font-bold text-destructive mt-1">{formatCurrency(data.egresosBancoAno)}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Utilidad estimada</p>
            <p className={`text-xl font-bold mt-1 ${data.utilidadEstimada >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatCurrency(data.utilidadEstimada)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Margen: {data.margenOperativoPct.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Inventario</p>
            <p className="text-xl font-bold mt-1">{formatCurrency(data.valorInventario)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Top clientes */}
      {data.topClientes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top clientes (facturación {data.thisYear})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.topClientes.map((c, i) => (
              <div key={c.name} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-xs text-muted-foreground w-5">#{i + 1}</span>
                  <span className="text-sm font-medium truncate">{c.name}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="w-32 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.min(100, c.pct)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-12 text-right">{c.pct.toFixed(1)}%</span>
                  <span className="text-sm font-semibold tabular-nums w-32 text-right">{formatCurrency(c.total)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Lo que el banco va a preguntar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lo que el banco va a preguntar</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Respuestas calculadas con tus datos reales. Llevá esto preparado a la reunión.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.metricas.map((m, idx) => {
            const lbl = semaforoLabel(m.semaforo);
            return (
              <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20">
                <div className="mt-0.5">{semaforoIcon(m.semaforo)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{m.pregunta}</p>
                  <p className="text-sm font-semibold mt-1">{m.respuesta}</p>
                  {m.detalle && <p className="text-[11px] text-muted-foreground mt-1">{m.detalle}</p>}
                </div>
                <Badge variant="outline" className={`text-[10px] ${lbl.cls}`}>{lbl.text}</Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Botón descarga PDF */}
      <div className="flex justify-end">
        <Button onClick={handleDownloadPdf} className="gap-2">
          <FileDown className="h-4 w-4" />
          Descargar PDF para Banco
        </Button>
      </div>
    </div>
  );
}
