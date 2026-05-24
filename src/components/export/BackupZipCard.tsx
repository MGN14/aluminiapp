import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Archive, Download, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

type Preset = "all" | "ytd" | "12m" | "3m" | "custom";

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function presetRange(preset: Preset): { from: string; to: string } | null {
  if (preset === "all") return null;
  const now = new Date();
  const to = ymd(now);
  if (preset === "ytd") return { from: `${now.getFullYear()}-01-01`, to };
  if (preset === "12m") {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - 1);
    return { from: ymd(d), to };
  }
  if (preset === "3m") {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    return { from: ymd(d), to };
  }
  return null;
}

export default function BackupZipCard() {
  const { toast } = useToast();
  const [preset, setPreset] = useState<Preset>("ytd");
  const [from, setFrom] = useState<string>(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState<string>(ymd(new Date()));
  const [loading, setLoading] = useState(false);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p === "custom") return;
    const range = presetRange(p);
    if (range) {
      setFrom(range.from);
      setTo(range.to);
    } else {
      // all → vacíos (sin filtro)
      setFrom("");
      setTo("");
    }
  };

  const handleDownload = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Sesión expirada", description: "Refrescá la página y volvé a intentar.", variant: "destructive" });
        return;
      }

      const body: Record<string, string> = {};
      if (preset !== "all") {
        if (from) body.from = from;
        if (to) body.to = to;
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/export-zip`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = cd.match(/filename="?([^";]+)"?/);
      const fileName = match?.[1] || `aluminia-export-${ymd(new Date())}.zip`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Descarga lista",
        description: `Se descargó ${fileName}. Revisá manifest.json para ver totales.`,
      });
    } catch (err) {
      console.error("Backup ZIP error:", err);
      toast({
        title: "No se pudo generar el ZIP",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const presets: { key: Preset; label: string }[] = [
    { key: "3m", label: "Últimos 3 meses" },
    { key: "ytd", label: "Este año" },
    { key: "12m", label: "Últimos 12 meses" },
    { key: "all", label: "Todo (sin filtro)" },
    { key: "custom", label: "Personalizado" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="h-5 w-5 text-primary" />
          Backup completo en ZIP
        </CardTitle>
        <CardDescription>
          Descargá <span className="font-medium">toda tu data</span> en CSVs comprimidos: facturas, remisiones,
          movimientos, créditos, inventario y más. Filtrable por rango de fechas.
          <span className="block mt-2 text-xs flex items-center gap-1 text-primary">
            <Sparkles className="h-3 w-3" />
            Subilo a Claude / ChatGPT / Gemini y analizá tu negocio con la IA que prefieras.
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Rango de fechas</Label>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <Button
                key={p.key}
                type="button"
                variant={preset === p.key ? "default" : "outline"}
                size="sm"
                onClick={() => applyPreset(p.key)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {preset !== "all" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="export-from" className="text-xs text-muted-foreground">Desde</Label>
              <Input
                id="export-from"
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }}
                max={to || undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="export-to" className="text-xs text-muted-foreground">Hasta</Label>
              <Input
                id="export-to"
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); setPreset("custom"); }}
                min={from || undefined}
              />
            </div>
          </div>
        )}

        <div className="p-3 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground text-sm">El ZIP incluye:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li><span className="font-medium">Facturas y items</span>, remisiones, pagos</li>
            <li><span className="font-medium">Transacciones bancarias</span> y extractos</li>
            <li><span className="font-medium">Caja menor</span> y movimientos de efectivo</li>
            <li><span className="font-medium">Créditos</span>, inventario, pagos esperados</li>
            <li><span className="font-medium">manifest.json</span> con metadata y totales</li>
            <li><span className="font-medium">README.txt</span> con instrucciones de uso</li>
          </ul>
        </div>

        <Button onClick={handleDownload} disabled={loading} size="lg" className="w-full">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generando ZIP…
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Descargar ZIP completo
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
