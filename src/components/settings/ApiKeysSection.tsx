import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Copy, Check, KeyRound, Loader2, Plus, Trash2, Bot, Terminal, Eraser } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useDataOwner } from "@/hooks/useDataOwner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const MCP_URL = `${SUPABASE_URL}/functions/v1/mcp`;

type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Ahora mismo";
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `Hace ${d} d`;
  return formatDate(iso);
}

async function callManage(body: Record<string, unknown>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sesión expirada, refrescá la página.");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-api-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="gap-1.5"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copiado" : label}
    </Button>
  );
}

export default function ApiKeysSection() {
  const { user } = useAuth();
  const { isCollaborator, loading: ownerLoading } = useDataOwner();
  const { toast } = useToast();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [revealedKey, setRevealedKey] = useState<{ key: string; name: string } | null>(null);
  // Key plaintext que el usuario pegó para personalizar los snippets de conexión.
  // sessionStorage (no localStorage): se borra al cerrar el tab por seguridad.
  const [pastedKey, setPastedKey] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("aluminia.mcp.keyForSnippets") ?? "";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (pastedKey) sessionStorage.setItem("aluminia.mcp.keyForSnippets", pastedKey);
    else sessionStorage.removeItem("aluminia.mcp.keyForSnippets");
  }, [pastedKey]);

  // Cuando se crea una key nueva la usamos automáticamente en los snippets.
  useEffect(() => {
    if (revealedKey?.key) setPastedKey(revealedKey.key);
  }, [revealedKey?.key]);

  const visibleKeys = keys.filter((k) => !k.revoked_at);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await callManage({ action: "list" });
      setKeys(res.keys ?? []);
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && !ownerLoading && !isCollaborator) refresh();
    else if (!ownerLoading) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, ownerLoading, isCollaborator]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast({ title: "Falta nombre", description: "Ponele un nombre, e.g. 'Claude Desktop'.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await callManage({ action: "create", name });
      setRevealedKey({ key: res.key, name: res.name });
      setNewName("");
      await refresh();
    } catch (err) {
      toast({ title: "No se pudo crear", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await callManage({ action: "revoke", id });
      toast({ title: "Key revocada", description: "Ya no puede usarse." });
      await refresh();
    } catch (err) {
      toast({ title: "No se pudo revocar", description: (err as Error).message, variant: "destructive" });
    }
  };

  if (ownerLoading) return null;
  if (isCollaborator) return null; // colaboradores no ven esta sección

  // Key a inyectar en los snippets. Si el usuario no pegó nada, mostramos
  // placeholder visible en mayúsculas para que se note que debe reemplazar.
  const snippetKey = pastedKey.trim() || "alm_live_PEGÁ_TU_KEY_ARRIBA";
  const hasRealKey = !!pastedKey.trim() && pastedKey.startsWith("alm_live_");

  // Claude Desktop NO soporta type:http directo todavía — usamos mcp-remote
  // como bridge stdio→HTTP. Se descarga solo la primera vez vía npx.
  // ${"$"}{AUTH_HEADER} es un trick para que el ${ literal sobreviva al template literal.
  const envPlaceholder = "${AUTH_HEADER}";
  const claudeConfig = `{
  "mcpServers": {
    "aluminia": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "${MCP_URL}",
        "--header",
        "Authorization:${envPlaceholder}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer ${snippetKey}"
      }
    }
  }
}`;

  const curlSnippet = `curl -X POST "${MCP_URL}" \\
  -H "Authorization: Bearer ${snippetKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  const curlOneLiner = `curl -X POST "${MCP_URL}" -H "Authorization: Bearer ${snippetKey}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  const macOpenConfig = `open -e ~/Library/Application\\ Support/Claude/claude_desktop_config.json`;
  const macCreateConfig = `mkdir -p ~/Library/Application\\ Support/Claude && touch ~/Library/Application\\ Support/Claude/claude_desktop_config.json && open -e ~/Library/Application\\ Support/Claude/claude_desktop_config.json`;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot className="h-5 w-5 text-primary" />
            Conectar con tu IA (MCP / API)
            <Badge variant="outline" className="ml-2 text-xs">Nuevo</Badge>
          </CardTitle>
          <CardDescription className="space-y-2">
            <p>
              Generá API keys para que <strong>Claude</strong>, <strong>ChatGPT</strong> o cualquier cliente MCP
              consulte tus datos en vivo: facturas, saldos por cliente, KPIs, gastos, top clientes y más.
            </p>
            <p className="text-xs flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" />
              Read-only. Tu data sigue siendo tuya. Podés revocar la key en cualquier momento.
            </p>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Crear nueva key */}
          <div className="space-y-2">
            <Label htmlFor="new-key-name" className="text-sm font-medium">
              Generar nueva API key
            </Label>
            <div className="flex gap-2">
              <Input
                id="new-key-name"
                placeholder="Ej: Claude Desktop, Cursor, mi script…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !creating && handleCreate()}
                maxLength={80}
                disabled={creating}
              />
              <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-1.5">Crear</span>
              </Button>
            </div>
          </div>

          {/* Lista de keys activas */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Keys activas</Label>
            {loading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Cargando…
              </div>
            ) : visibleKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3 px-4 rounded-lg bg-muted/40 border border-border">
                Todavía no tenés ninguna API key. Crea una arriba para empezar.
              </p>
            ) : (
              <div className="space-y-2">
                {visibleKeys.map((k) => (
                  <div
                    key={k.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
                  >
                    <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{k.name}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {k.key_prefix}…
                      </p>
                    </div>
                    <div className="hidden sm:flex flex-col items-end text-xs text-muted-foreground shrink-0">
                      <span>Creada: {formatDate(k.created_at)}</span>
                      <span>Último uso: {timeAgo(k.last_used_at)}</span>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Revocar "{k.name}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            La key dejará de funcionar inmediatamente. Si la estás usando en Claude / ChatGPT, esos clientes perderán acceso. Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleRevoke(k.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Revocar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Instrucciones de conexión */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-sm font-medium">Cómo conectarla</Label>
              {hasRealKey && (
                <Badge variant="outline" className="text-[10px] gap-1 border-success/40 text-success">
                  <Check className="h-3 w-3" />
                  Key cargada — snippets listos para copiar
                </Badge>
              )}
            </div>

            {/* Input para pegar key existente (cuando ya cerraste el modal de revelación) */}
            <div className="space-y-1.5">
              <Label htmlFor="paste-key" className="text-xs text-muted-foreground">
                Pegá tu API key acá para que los snippets de abajo la incluyan automáticamente.
                {!hasRealKey && <span className="text-warning"> Sin esto, los snippets traen un placeholder y tenés que editar a mano.</span>}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="paste-key"
                  value={pastedKey}
                  onChange={(e) => setPastedKey(e.target.value.trim())}
                  placeholder="alm_live_..."
                  className="font-mono text-xs"
                  spellCheck={false}
                  autoComplete="off"
                />
                {pastedKey && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPastedKey("")} title="Borrar del navegador">
                    <Eraser className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Se guarda solo en este navegador (sessionStorage). Se borra al cerrar el tab.
              </p>
            </div>

            <Tabs defaultValue="claude" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="claude">Claude Desktop</TabsTrigger>
                <TabsTrigger value="cursor">Cursor</TabsTrigger>
                <TabsTrigger value="curl">cURL / script</TabsTrigger>
              </TabsList>

              <TabsContent value="claude" className="space-y-3">
                <div className="text-xs text-muted-foreground space-y-1.5">
                  <p>
                    <strong>1.</strong> En Mac, corré este comando en terminal (te crea/abre el archivo de config):
                  </p>
                  <div className="relative">
                    <pre className="text-[11px] bg-muted/60 p-2 pr-16 rounded font-mono border border-border overflow-x-auto">
{macCreateConfig}
                    </pre>
                    <div className="absolute top-1 right-1">
                      <CopyButton value={macCreateConfig} />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Si ya lo tenés abierto: <code className="font-mono bg-muted px-1 rounded">{macOpenConfig}</code>
                  </p>
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                  <p><strong>2.</strong> Pegá este JSON adentro y guardá con <kbd className="px-1 rounded bg-muted text-[10px]">⌘S</kbd>:</p>
                  <p className="text-[11px] text-warning">
                    ⚠️ Si ya tenías otros servers en <code className="font-mono">mcpServers</code>, agregá "aluminia" como entrada más sin reemplazar los otros (cuidado con las comas).
                  </p>
                </div>
                <div className="relative">
                  <pre className="text-xs bg-muted/60 p-3 pr-20 rounded-lg overflow-x-auto font-mono border border-border">
{claudeConfig}
                  </pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton value={claudeConfig} />
                  </div>
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                  <p><strong>3.</strong> Reiniciá Claude Desktop completo (no solo cerrar la ventana):</p>
                  <div className="relative">
                    <pre className="text-[11px] bg-muted/60 p-2 pr-16 rounded font-mono border border-border">killall Claude</pre>
                    <div className="absolute top-1 right-1">
                      <CopyButton value="killall Claude" />
                    </div>
                  </div>
                  <p className="pt-1">
                    <strong>4.</strong> Abrí Claude Desktop de nuevo. Vas a ver "aluminia" en el menú 🛠️ con 11 tools.
                    Probá: <em>"Usando aluminia, dame mi resumen financiero del año"</em>
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="cursor" className="space-y-3">
                <div className="text-xs text-muted-foreground space-y-1">
                  <p><strong>1.</strong> Cursor → Settings → MCP → "Add new MCP server".</p>
                  <p><strong>2.</strong> Pegá la misma config JSON:</p>
                </div>
                <div className="relative">
                  <pre className="text-xs bg-muted/60 p-3 pr-20 rounded-lg overflow-x-auto font-mono border border-border">
{claudeConfig}
                  </pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton value={claudeConfig} />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="curl" className="space-y-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Terminal className="h-3 w-3" />
                  Llamada directa al endpoint MCP (JSON-RPC). Útil para scripts.
                </p>

                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">Listar tools disponibles (legible):</p>
                  <div className="relative">
                    <pre className="text-xs bg-muted/60 p-3 pr-20 rounded-lg overflow-x-auto font-mono border border-border">
{curlSnippet}
                    </pre>
                    <div className="absolute top-2 right-2">
                      <CopyButton value={curlSnippet} />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">Versión one-liner (para zsh sin saltos de línea):</p>
                  <div className="relative">
                    <pre className="text-xs bg-muted/60 p-3 pr-20 rounded-lg overflow-x-auto font-mono border border-border">
{curlOneLiner}
                    </pre>
                    <div className="absolute top-2 right-2">
                      <CopyButton value={curlOneLiner} />
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Para ejecutar una tool específica reemplazá el body por:<br />
                  <code className="font-mono bg-muted px-1 rounded text-[10px] break-all">{`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"financial_summary","arguments":{"from":"2026-01-01","to":"2026-12-31"}}}`}</code>
                </p>
              </TabsContent>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* Modal que muestra la key plaintext UNA VEZ */}
      <Dialog open={!!revealedKey} onOpenChange={(open) => !open && setRevealedKey(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Tu nueva API key: {revealedKey?.name}
            </DialogTitle>
            <DialogDescription>
              <strong className="text-foreground">Copiala ahora.</strong> No vamos a volver a mostrártela. Si la perdés tenés que crear una nueva.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="relative">
              <pre className="text-sm bg-muted/60 p-3 pr-20 rounded-lg font-mono break-all border border-border select-all">
                {revealedKey?.key}
              </pre>
              {revealedKey && (
                <div className="absolute top-2 right-2">
                  <CopyButton value={revealedKey.key} label="Copiar key" />
                </div>
              )}
            </div>
            <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-1.5">
              <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-success" />
                Listo, ya la cargué en los snippets de abajo
              </p>
              <p className="text-[11px] text-muted-foreground">
                Cerrá este aviso y andá al tab <strong>"Claude Desktop"</strong> de la sección "Cómo conectarla". El JSON ya viene con tu key embebida — solo copialo, pegalo en el archivo de config y reiniciá Claude.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedKey(null)} className="gap-1.5">
              <Check className="h-4 w-4" />
              Entendido, ya la guardé
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
