/**
 * CreditCardCsvUploader — sube el CSV de movimientos de una TARJETA DE CRÉDITO
 * Bancolombia. Formato distinto al de cuenta bancaria (ver bancolombiaCardCsvParser).
 *
 * Decisión contable (confirmada con Nico): "Solo compras = gasto".
 *   - Importamos SOLO las COMPRAS como egresos categorizables.
 *   - NO importamos el pago/abono a la tarjeta (lo maneja como traslado en su
 *     cuenta bancaria) → evita inflar ingresos y doble-contar con el "PAGO
 *     TARJETA" que ya figura como egreso en el banco.
 *
 * Reusa el pipeline existente: crea un `bank_statements` y manda las compras al
 * edge function `parse-bancolombia-csv` (que deriva type/debit/credit del signo).
 * Nuestro `toTransactionAmount()` invierte el signo: compra (VALOR>0) → egreso.
 */

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useReconciliationRules } from "@/hooks/useReconciliationRules";
import { fetchWithAuthRetry } from "@/lib/authRetry";
import {
  parseBancolombiaCardCsv,
  toTransactionAmount,
  buildCardDescription,
  type CardParseResult,
} from "@/lib/bancolombiaCardCsvParser";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { logEvent } from "@/lib/analytics";
import {
  CreditCard,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  X,
} from "lucide-react";

interface Props {
  onUploadComplete?: () => void;
}

type Phase = "idle" | "parsing" | "preview" | "uploading" | "done";

interface PreviewState {
  file: File;
  csvText: string;
  parsed: CardParseResult;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function CreditCardCsvUploader({ onUploadComplete }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { applyRulesToStatement } = useReconciliationRules();

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [preview, setPreview] = useState<PreviewState | null>(null);

  // Campos editables en preview
  const [displayName, setDisplayName] = useState<string>("");

  const reset = () => {
    setPhase("idle");
    setErrorMsg("");
    setPreview(null);
    setDisplayName("");
  };

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file || !user) return;
      setErrorMsg("");
      setPhase("parsing");
      try {
        const csvText = await file.text();
        const parsed = parseBancolombiaCardCsv(csvText);
        if (parsed.movements.length === 0) {
          setErrorMsg(
            parsed.errors.length > 0
              ? `No se pudo leer ningún movimiento. Primer error: ${parsed.errors[0].reason}`
              : "El archivo no tiene movimientos.",
          );
          setPhase("idle");
          return;
        }
        const product = parsed.summary.products[0] ?? "";
        setDisplayName(`Tarjeta ${product}`.trim());
        setPreview({ file, csvText, parsed });
        setPhase("preview");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Error leyendo el archivo");
        setPhase("idle");
      }
    },
    [user],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"], "text/plain": [".csv", ".txt"] },
    maxFiles: 1,
    disabled: phase === "uploading",
  });

  const proceedUpload = async () => {
    if (!preview || !user) return;
    setPhase("uploading");
    setErrorMsg("");
    try {
      const { parsed, file } = preview;
      // Solo COMPRAS (decisión "solo compras = gasto"). Los abonos quedan fuera.
      const charges = parsed.movements.filter((m) => m.isCharge);
      if (charges.length === 0) {
        throw new Error("El extracto no tiene compras para importar (solo abonos).");
      }

      // 1. Subir archivo original a storage
      const filePath = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("bank-statements")
        .upload(filePath, file);
      if (uploadErr) throw new Error(`Storage: ${uploadErr.message}`);

      // 2. Crear bank_statements (tarjeta). Reusamos columnas existentes;
      // el bank_name distingue que es una tarjeta.
      const product = parsed.summary.products[0] ?? null;
      const range = parsed.summary.dateRange;
      const { data: stmt, error: stmtErr } = await supabase
        .from("bank_statements")
        .insert({
          user_id: user.id,
          file_name: file.name,
          file_path: filePath,
          bank_name: "Tarjeta de crédito Bancolombia",
          display_name: displayName.trim() || null,
          account_number: product,
          period_start: range?.start ?? null,
          period_end: range?.end ?? null,
          statement_month: null,
          statement_year: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          period_type: "weekly" as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .select("id")
        .single();
      if (stmtErr || !stmt) {
        throw new Error(`No se pudo crear el extracto: ${stmtErr?.message || "sin respuesta"}`);
      }

      // 3. Mandar SOLO las compras al edge function (reusa el insert de transactions).
      const payload = {
        statement_id: stmt.id,
        movements: charges.map((m) => {
          const description = buildCardDescription(m);
          return {
            date: m.date,
            amount: toTransactionAmount(m), // compra → negativo (egreso)
            description,
            normalizedDescription: description.toUpperCase(),
            dcto: null,
            sucursal: null,
            rawLine: m.rawLine,
          };
        }),
      };

      const res = await fetchWithAuthRetry(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-bancolombia-csv`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        "parse-bancolombia-csv",
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        // Rollback del statement zombie (igual que WeeklyCsvUploader).
        await supabase
          .from("bank_statements")
          .update({ deleted_at: new Date().toISOString() } as never)
          .eq("id", stmt.id);
        throw new Error(errData.error || `Edge function falló con status ${res.status}`);
      }

      const result = await res.json();

      let rulesApplied = 0;
      try {
        rulesApplied = await applyRulesToStatement(stmt.id);
      } catch (e) {
        console.warn("applyRulesToStatement failed:", e);
      }

      setPhase("done");
      logEvent("extracto_uploaded", {
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        props: {
          statement_id: stmt.id,
          transactions_count: result.transactions_count ?? 0,
          source: "csv_tarjeta_credito",
        },
      });
      toast({
        title: "¡Compras de la tarjeta cargadas!",
        description:
          rulesApplied > 0
            ? `Se importaron ${result.transactions_count} compras. Nico aplicó ${rulesApplied} regla${rulesApplied > 1 ? "s" : ""}. 🎉`
            : `Se importaron ${result.transactions_count} compras como gasto.`,
      });
      onUploadComplete?.();
      setTimeout(reset, 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      logEvent("flow_error", {
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        props: { flow: "csv_tarjeta_credito", error: msg.slice(0, 200) },
      });
      setErrorMsg(msg);
      setPhase("preview");
      toast({ title: "Error al cargar", description: msg, variant: "destructive" });
    }
  };

  // ── Render ──
  if (phase === "idle" || phase === "parsing") {
    return (
      <Card className="border-2 border-dashed border-border hover:border-accent transition-colors h-full">
        <CardContent className="p-8 flex flex-col items-center justify-center text-center h-full">
          <div {...getRootProps()} className="cursor-pointer w-full">
            <input {...getInputProps()} />
            <CreditCard className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            {phase === "parsing" ? (
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Leyendo CSV…
              </p>
            ) : (
              <>
                <p className="text-sm font-medium">
                  {isDragActive ? "Soltá el CSV acá" : "Arrastrá el CSV de tu tarjeta"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Extracto de tarjeta de crédito Bancolombia (.csv). Solo importa las compras.
                </p>
              </>
            )}
          </div>
          {errorMsg && (
            <p className="text-xs text-destructive mt-3 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {errorMsg}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  if (phase === "done") {
    return (
      <Card className="border-success/40 bg-success/[0.04] h-full">
        <CardContent className="p-8 flex flex-col items-center justify-center text-center h-full">
          <CheckCircle2 className="h-10 w-10 text-success mb-2" />
          <p className="text-sm font-medium">¡Compras cargadas!</p>
        </CardContent>
      </Card>
    );
  }

  // preview / uploading
  const summary = preview!.parsed.summary;
  const chargesCount = preview!.parsed.movements.filter((m) => m.isCharge).length;
  const paymentsCount = preview!.parsed.movements.filter((m) => !m.isCharge).length;
  const uploading = phase === "uploading";

  return (
    <Card className="h-full">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" /> Revisá antes de cargar
          </p>
          {!uploading && (
            <button onClick={reset} className="text-muted-foreground hover:text-foreground" title="Cancelar">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded bg-muted/40 border border-border">
            <p className="text-muted-foreground">Compras a importar</p>
            <p className="font-semibold text-base">{chargesCount}</p>
            <p className="font-mono">{formatCurrency(summary.totalCharges)}</p>
          </div>
          <div className="p-2 rounded bg-muted/40 border border-border">
            <p className="text-muted-foreground">Abonos/pagos (excluidos)</p>
            <p className="font-semibold text-base">{paymentsCount}</p>
            <p className="font-mono">{formatCurrency(summary.totalPayments)}</p>
          </div>
        </div>

        {summary.dateRange && (
          <p className="text-xs text-muted-foreground">
            Periodo: {formatDate(summary.dateRange.start)} → {formatDate(summary.dateRange.end)}
          </p>
        )}

        <div className="space-y-1">
          <Label className="text-[11px]">Nombre para identificarla</Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Ej: Tarjeta Visa *2047"
            className="h-8 text-xs"
            disabled={uploading}
          />
        </div>

        {preview!.parsed.errors.length > 0 && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {preview!.parsed.errors.length} línea(s) no se pudieron leer y se omitirán.
          </p>
        )}

        <p className="text-[11px] text-muted-foreground bg-muted/30 rounded p-2 border border-border">
          Solo se importan las <strong>compras como gasto</strong>. El pago a la tarjeta no se
          importa — recordá marcarlo como traslado en tu cuenta bancaria para no contar doble.
        </p>

        {errorMsg && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> {errorMsg}
          </p>
        )}

        <Button onClick={proceedUpload} disabled={uploading || chargesCount === 0} className="w-full" size="sm">
          {uploading ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Cargando…</>
          ) : (
            <>Importar {chargesCount} compra{chargesCount === 1 ? "" : "s"} <ArrowRight className="h-4 w-4 ml-1" /></>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
