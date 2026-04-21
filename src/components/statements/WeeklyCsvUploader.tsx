/**
 * WeeklyCsvUploader — Fase 2 de conciliación semanal.
 *
 * Flujo:
 *   1. Usuario arrastra un CSV o ZIP descargado del portal de Bancolombia.
 *   2. El componente extrae (si es ZIP) y parsea el CSV en el browser.
 *   3. Muestra preview: #movimientos, rango de fechas, totales.
 *   4. Usuario confirma (o edita rango + display name).
 *   5. Se sube el archivo original a storage, se crea `bank_statements` con
 *      `period_type='weekly'`, y se llama al edge function para insertar
 *      los transactions.
 *
 * No toca el flujo PDF existente — vive en paralelo.
 */

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { fetchWithAuthRetry } from "@/lib/authRetry";
import {
  readBancolombiaFile,
  BancolombiaZipError,
} from "@/lib/bancolombiaZipReader";
import {
  parseBancolombiaCsv,
  type BancolombiaMovement,
  type ParseResult,
} from "@/lib/bancolombiaCsvParser";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  X,
} from "lucide-react";

const BANKS = ["Bancolombia"]; // extensible — en Fase 2 solo Bancolombia

interface Props {
  onUploadComplete?: () => void;
}

type Phase = "idle" | "parsing" | "preview" | "uploading" | "done";

interface PreviewState {
  file: File;
  csvText: string;
  parsed: ParseResult;
  movements: BancolombiaMovement[];
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso: string): string {
  // iso = "YYYY-MM-DD" → "DD/MM/YYYY"
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function WeeklyCsvUploader({ onUploadComplete }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [preview, setPreview] = useState<PreviewState | null>(null);

  // Campos editables en la fase preview
  const [bankName, setBankName] = useState<string>("Bancolombia");
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file || !user) return;

      setErrorMsg("");
      setPhase("parsing");

      try {
        const read = await readBancolombiaFile(file);
        const parsed = parseBancolombiaCsv(read.csvText);

        if (parsed.movements.length === 0) {
          throw new Error(
            parsed.errors.length > 0
              ? `El archivo no contiene movimientos válidos. ${parsed.errors.length} filas fallaron.`
              : "El archivo está vacío."
          );
        }

        setPreview({
          file,
          csvText: read.csvText,
          parsed,
          movements: parsed.movements,
        });
        if (parsed.summary.dateRange) {
          setPeriodStart(parsed.summary.dateRange.start);
          setPeriodEnd(parsed.summary.dateRange.end);
        }
        // Display name autocompleto: "Bancolombia - 01/03 a 31/03"
        if (parsed.summary.dateRange) {
          const start = formatDate(parsed.summary.dateRange.start).slice(0, 5);
          const end = formatDate(parsed.summary.dateRange.end);
          setDisplayName(`Bancolombia - ${start} a ${end}`);
        }
        setPhase("preview");
      } catch (err) {
        console.error("Parse error:", err);
        const msg =
          err instanceof BancolombiaZipError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Error al leer el archivo";
        setErrorMsg(msg);
        setPhase("idle");
      }
    },
    [user]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      "text/csv": [".csv"],
      "application/zip": [".zip"],
      "application/x-zip-compressed": [".zip"],
    },
    disabled: phase === "parsing" || phase === "uploading",
  });

  const reset = () => {
    setPhase("idle");
    setPreview(null);
    setErrorMsg("");
    setBankName("Bancolombia");
    setPeriodStart("");
    setPeriodEnd("");
    setDisplayName("");
  };

  const handleConfirmUpload = async () => {
    if (!preview || !user) return;
    if (!periodStart || !periodEnd) {
      toast({
        title: "Faltan fechas",
        description: "Definí el rango de fechas antes de continuar.",
        variant: "destructive",
      });
      return;
    }
    if (periodStart > periodEnd) {
      toast({
        title: "Rango inválido",
        description: "La fecha de inicio debe ser anterior a la de fin.",
        variant: "destructive",
      });
      return;
    }

    setPhase("uploading");
    setErrorMsg("");

    try {
      // 1. Subir el archivo original (ZIP o CSV) a Supabase Storage
      const filePath = `${user.id}/${Date.now()}-${preview.file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("bank-statements")
        .upload(filePath, preview.file);
      if (uploadErr) throw new Error(`Storage: ${uploadErr.message}`);

      // 2. Crear `bank_statements` con period_type='weekly'.
      // Nota: usamos `as any` porque types.ts todavía no conoce la columna
      // period_type (se regenera por Lovable después). El valor es válido
      // gracias a la migración de Fase 1.
      const account = preview.parsed.summary.accountsSeen[0] || null;
      const { data: stmt, error: stmtErr } = await supabase
        .from("bank_statements")
        .insert({
          user_id: user.id,
          file_name: preview.file.name,
          file_path: filePath,
          bank_name: bankName,
          display_name: displayName.trim() || null,
          account_number: account,
          period_start: periodStart,
          period_end: periodEnd,
          // Las columnas de período mensual quedan nulas — es un upload semanal
          statement_month: null,
          statement_year: null,
          // Campo agregado en Fase 1 — el DB default también es 'monthly_close',
          // así que lo seteamos explícitamente en 'weekly'.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          period_type: "weekly" as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .select("id")
        .single();

      if (stmtErr || !stmt) {
        throw new Error(
          `No se pudo crear el extracto: ${stmtErr?.message || "sin respuesta"}`
        );
      }

      // 3. Llamar al edge function con los movimientos ya parseados
      const payload = {
        statement_id: stmt.id,
        movements: preview.movements.map((m) => ({
          date: m.date,
          amount: m.amount,
          description: m.description,
          normalizedDescription: m.normalizedDescription,
          dcto: m.dcto || null,
          sucursal: m.sucursal || null,
          rawLine: m.rawLine,
        })),
      };

      const res = await fetchWithAuthRetry(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-bancolombia-csv`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        "parse-bancolombia-csv"
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error ||
            `Edge function falló con status ${res.status}`
        );
      }

      const result = await res.json();

      setPhase("done");
      toast({
        title: "¡Movimientos cargados!",
        description: `Se importaron ${result.transactions_count} transacciones.`,
      });
      onUploadComplete?.();

      // Reset después de un momento
      setTimeout(reset, 2500);
    } catch (err) {
      console.error("Upload error:", err);
      const msg = err instanceof Error ? err.message : "Error desconocido";
      setErrorMsg(msg);
      setPhase("preview");
      toast({
        title: "Error al cargar",
        description: msg,
        variant: "destructive",
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (phase === "idle" || phase === "parsing") {
    return (
      <Card>
        <CardContent style={{ padding: 24 }}>
          <div
            {...getRootProps()}
            style={{
              border: isDragActive
                ? "2px dashed hsl(var(--primary))"
                : "2px dashed hsl(var(--border))",
              borderRadius: 8,
              padding: 32,
              textAlign: "center",
              cursor: phase === "parsing" ? "not-allowed" : "pointer",
              backgroundColor: isDragActive
                ? "hsl(var(--primary) / 0.05)"
                : "transparent",
              transition: "all 0.2s",
            }}
          >
            <input {...getInputProps()} />
            <FileSpreadsheet
              size={40}
              style={{
                margin: "0 auto 12px",
                color: "hsl(var(--muted-foreground))",
              }}
            />
            {phase === "parsing" ? (
              <>
                <Loader2
                  size={20}
                  style={{
                    margin: "0 auto 8px",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))" }}>
                  Leyendo archivo…
                </p>
              </>
            ) : (
              <>
                <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
                  Subir movimientos semanales
                </p>
                <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
                  Arrastrá el <strong>ZIP</strong> o <strong>CSV</strong> de
                  Bancolombia, o hacé click para seleccionar
                </p>
              </>
            )}
          </div>
          {errorMsg && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 6,
                backgroundColor: "hsl(var(--destructive) / 0.1)",
                color: "hsl(var(--destructive))",
                fontSize: 13,
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{errorMsg}</span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (phase === "done") {
    return (
      <Card>
        <CardContent
          style={{
            padding: 24,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <CheckCircle2 size={24} style={{ color: "hsl(var(--primary))" }} />
          <div>
            <p style={{ fontWeight: 500 }}>¡Listo!</p>
            <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
              Los movimientos se cargaron correctamente.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // phase === "preview" || "uploading"
  if (!preview) return null;

  const { summary } = preview.parsed;
  const uploading = phase === "uploading";

  return (
    <Card>
      <CardContent style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
              Revisar antes de cargar
            </h3>
            <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
              {preview.file.name} — {(preview.file.size / 1024).toFixed(1)} KB
            </p>
          </div>
          {!uploading && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <X size={16} />
            </Button>
          )}
        </div>

        {/* Preview stats */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
          }}
        >
          <Stat label="Movimientos" value={String(summary.rowCount)} />
          <Stat
            label="Rango"
            value={
              summary.dateRange
                ? `${formatDate(summary.dateRange.start)} → ${formatDate(summary.dateRange.end)}`
                : "—"
            }
          />
          <Stat
            label="Ingresos"
            value={formatCurrency(summary.totalCredits)}
            positive
          />
          <Stat
            label="Egresos"
            value={formatCurrency(summary.totalDebits)}
            negative
          />
        </div>

        {summary.accountsSeen.length > 1 && (
          <div
            style={{
              padding: 10,
              backgroundColor: "hsl(var(--muted))",
              fontSize: 12,
              borderRadius: 6,
            }}
          >
            ⚠️ El archivo tiene movimientos de {summary.accountsSeen.length} cuentas
            distintas ({summary.accountsSeen.join(", ")}). Se importarán todos al
            mismo extracto.
          </div>
        )}

        {preview.parsed.errors.length > 0 && (
          <div
            style={{
              padding: 10,
              backgroundColor: "hsl(var(--destructive) / 0.08)",
              color: "hsl(var(--destructive))",
              fontSize: 12,
              borderRadius: 6,
            }}
          >
            {preview.parsed.errors.length} fila(s) se saltaron por formato
            inválido. Las demás se importarán normalmente.
          </div>
        )}

        {/* Form */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <Label htmlFor="bank-name">Banco</Label>
            <Select
              value={bankName}
              onValueChange={setBankName}
              disabled={uploading}
            >
              <SelectTrigger id="bank-name">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BANKS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="display-name">Nombre para mostrar</Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={uploading}
              placeholder="Bancolombia - 01/03 a 31/03"
            />
          </div>
          <div>
            <Label htmlFor="period-start">Desde</Label>
            <Input
              id="period-start"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              disabled={uploading}
            />
          </div>
          <div>
            <Label htmlFor="period-end">Hasta</Label>
            <Input
              id="period-end"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              disabled={uploading}
            />
          </div>
        </div>

        {errorMsg && (
          <div
            style={{
              padding: 10,
              backgroundColor: "hsl(var(--destructive) / 0.1)",
              color: "hsl(var(--destructive))",
              fontSize: 13,
              borderRadius: 6,
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="outline" onClick={reset} disabled={uploading}>
            Cancelar
          </Button>
          <Button onClick={handleConfirmUpload} disabled={uploading}>
            {uploading ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Cargando…
              </>
            ) : (
              <>
                Cargar movimientos
                <ArrowRight size={16} className="ml-2" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const color = positive
    ? "hsl(142 71% 35%)"
    : negative
      ? "hsl(var(--destructive))"
      : "hsl(var(--foreground))";
  return (
    <div
      style={{
        padding: 12,
        backgroundColor: "hsl(var(--muted) / 0.3)",
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "hsl(var(--muted-foreground))",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}
