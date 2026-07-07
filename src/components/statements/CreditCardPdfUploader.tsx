/**
 * CreditCardPdfUploader — sube el extracto PDF de una TARJETA DE CRÉDITO
 * Bancolombia y lo parsea con IA (edge function parse-bancolombia-card-pdf).
 *
 * ¿Por qué PDF además del CSV? El CSV del portal NO trae el comercio — el
 * auxiliar ve "Compra TC *2047" y no puede categorizar. El PDF del extracto SÍ
 * trae la descripción de cada compra ("HOMECENTER CALLE 80", etc.).
 *
 * Misma decisión contable del CSV ("solo compras = gasto"): la edge function
 * importa compras/intereses/comisiones como egresos y EXCLUYE los abonos/pagos
 * (traslado desde el banco — evita doble conteo con el "PAGO TARJETA").
 */

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useReconciliationRules } from "@/hooks/useReconciliationRules";
import { fetchWithAuthRetry } from "@/lib/authRetry";
import { Card, CardContent } from "@/components/ui/card";
import { logEvent } from "@/lib/analytics";
import { CreditCard, Loader2, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";

interface Props {
  onUploadComplete?: () => void;
}

type Phase = "idle" | "processing" | "done";

export default function CreditCardPdfUploader({ onUploadComplete }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { applyRulesToStatement } = useReconciliationRules();

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file || !user) return;
      if (file.type !== "application/pdf") {
        setErrorMsg("Solo se permiten archivos PDF");
        return;
      }
      setErrorMsg("");
      setPhase("processing");

      let statementId: string | null = null;
      try {
        // 1. Subir el PDF original a storage
        const filePath = `${user.id}/${Date.now()}-${file.name}`;
        const { error: uploadErr } = await supabase.storage
          .from("bank-statements")
          .upload(filePath, file);
        if (uploadErr) throw new Error(`Storage: ${uploadErr.message}`);

        // 2. Crear el bank_statements (grupo tarjeta: bank_name empieza con "Tarjeta")
        const { data: stmt, error: stmtErr } = await supabase
          .from("bank_statements")
          .insert({
            user_id: user.id,
            file_name: file.name,
            file_path: filePath,
            bank_name: "Tarjeta de crédito Bancolombia",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            period_type: "weekly" as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
          .select("id")
          .single();
        if (stmtErr || !stmt) {
          throw new Error(`No se pudo crear el extracto: ${stmtErr?.message || "sin respuesta"}`);
        }
        statementId = stmt.id;

        // 3. Parsear con IA (la función excluye abonos y setea periodo/producto)
        const res = await fetchWithAuthRetry(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-bancolombia-card-pdf`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ statement_id: stmt.id, file_path: filePath }),
          },
          "parse-bancolombia-card-pdf",
        );

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          // Rollback del statement zombie (mismo patrón del CSV de tarjeta).
          await supabase
            .from("bank_statements")
            .update({ deleted_at: new Date().toISOString() } as never)
            .eq("id", stmt.id);
          throw new Error(errData.error || `Edge function falló con status ${res.status}`);
        }

        const result = await res.json();

        // 4. Aplicar reglas de Nico sobre las compras recién insertadas
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
            source: "pdf_tarjeta_credito",
          },
        });
        toast({
          title: "¡Compras de la tarjeta cargadas!",
          description:
            `${result.transactions_count} compras con el nombre del comercio` +
            (rulesApplied > 0 ? `. Nico aplicó ${rulesApplied} regla${rulesApplied > 1 ? "s" : ""}. 🎉` : "."),
        });
        onUploadComplete?.();
        setTimeout(() => setPhase("idle"), 2500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        logEvent("flow_error", {
          user_id: user?.id ?? null,
          user_email: user?.email ?? null,
          props: { flow: "pdf_tarjeta_credito", error: msg.slice(0, 200), statement_id: statementId },
        });
        setErrorMsg(msg);
        setPhase("idle");
        toast({ title: "Error al procesar", description: msg, variant: "destructive" });
      }
    },
    [user, toast, applyRulesToStatement, onUploadComplete],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    disabled: phase === "processing",
  });

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

  return (
    <Card className="border-2 border-dashed border-border hover:border-accent transition-colors h-full">
      <CardContent className="p-8 flex flex-col items-center justify-center text-center h-full">
        <div {...getRootProps()} className="cursor-pointer w-full">
          <input {...getInputProps()} />
          <div className="relative w-fit mx-auto mb-3">
            <CreditCard className="h-10 w-10 text-muted-foreground" />
            <Sparkles className="h-4 w-4 text-primary absolute -top-1 -right-2" />
          </div>
          {phase === "processing" ? (
            <>
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Procesando con IA…
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Extrayendo comercios del extracto (puede tardar ~1 min)
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">
                {isDragActive ? "Soltá el PDF acá" : "Arrastrá el PDF del extracto de tu tarjeta"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Trae el <strong>nombre del comercio</strong> de cada compra — descargalo de la
                Sucursal Virtual (sin clave). Solo importa las compras.
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
