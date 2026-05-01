import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, ChevronDown, ChevronUp, Mail, Eye, EyeOff, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MODULE_KEYS,
  MODULE_GROUP_LABELS,
  type Collaborator,
  type ModuleKey,
  type AccessLevel,
  type ModuleGroup,
} from '@/hooks/useCollaborators';

const ACCESS_LABELS: Record<AccessLevel, string> = {
  none: 'Sin acceso',
  view: 'Solo ver',
  edit: 'Editar',
};

const ACCESS_DOT_COLOR: Record<AccessLevel, string> = {
  none: 'bg-muted-foreground/30',
  view: 'bg-primary',
  edit: 'bg-success',
};

interface Props {
  collaborator: Collaborator;
  onUpdatePermission: (collaboratorId: string, moduleKey: ModuleKey, level: AccessLevel) => void;
  onUpdateAllPermissions?: (collaboratorId: string, level: AccessLevel) => void;
  onDelete: (collaboratorId: string) => void;
}

const GROUP_ORDER: ModuleGroup[] = ['general', 'documentos', 'movimientos', 'reportes', 'ia'];

export default function CollaboratorCard({ collaborator: c, onUpdatePermission, onUpdateAllPermissions, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Conteo de permisos para el resumen colapsado
  const counts = (Object.values(c.permissions) as AccessLevel[]).reduce(
    (acc, lvl) => {
      acc[lvl] = (acc[lvl] || 0) + 1;
      return acc;
    },
    {} as Record<AccessLevel, number>,
  );
  const editCount = counts.edit || 0;
  const viewCount = counts.view || 0;
  const noneCount = counts.none || 0;

  // Agrupa los módulos
  const modulesByGroup = MODULE_KEYS.reduce<Record<ModuleGroup, typeof MODULE_KEYS[number][]>>((acc, m) => {
    if (!acc[m.group]) acc[m.group] = [];
    acc[m.group].push(m);
    return acc;
  }, {} as Record<ModuleGroup, typeof MODULE_KEYS[number][]>);

  const initial = (c.name || c.collaborator_email || '?').charAt(0).toUpperCase();

  return (
    <Card className="overflow-hidden border-border/60 shadow-sm">
      {/* Header — siempre visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left hover:bg-muted/30 transition-colors"
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center shrink-0">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-sm truncate">{c.name || 'Sin nombre'}</p>
                <Badge variant="secondary" className="capitalize text-[10px] font-normal">
                  {c.role}
                </Badge>
                {c.status === 'pending' && (
                  <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                    Pendiente
                  </Badge>
                )}
                {c.status === 'active' && (
                  <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">
                    Activo
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                <Mail className="h-3 w-3" />
                {c.collaborator_email}
              </p>
            </div>

            {/* Resumen permisos */}
            <div className="flex items-center gap-3 text-xs shrink-0">
              <div className="flex items-center gap-1.5" title="Sin acceso">
                <span className={cn('w-2 h-2 rounded-full', ACCESS_DOT_COLOR.none)} />
                <span className="text-muted-foreground tabular-nums">{noneCount}</span>
              </div>
              <div className="flex items-center gap-1.5" title="Solo ver">
                <Eye className="h-3 w-3 text-primary" />
                <span className="text-foreground tabular-nums">{viewCount}</span>
              </div>
              <div className="flex items-center gap-1.5" title="Editar">
                <Pencil className="h-3 w-3 text-success" />
                <span className="text-foreground tabular-nums">{editCount}</span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => { e.stopPropagation(); if (confirm(`¿Eliminar ${c.name || c.collaborator_email}?`)) onDelete(c.id); }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardContent>
      </button>

      {/* Permisos detallados — expandible */}
      {expanded && (
        <div className="border-t bg-muted/10">
          {/* Quick actions */}
          {onUpdateAllPermissions && (
            <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap border-b border-border/40 bg-background/40">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Aplicar a todo:
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={() => onUpdateAllPermissions(c.id, 'none')}
              >
                <EyeOff className="h-3 w-3" />Sin acceso
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={() => onUpdateAllPermissions(c.id, 'view')}
              >
                <Eye className="h-3 w-3" />Solo ver
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={() => onUpdateAllPermissions(c.id, 'edit')}
              >
                <Pencil className="h-3 w-3" />Editar todo
              </Button>
            </div>
          )}

          <div className="p-4 grid sm:grid-cols-2 gap-x-6 gap-y-4">
            {GROUP_ORDER.filter((g) => modulesByGroup[g]?.length).map((group) => (
              <div key={group} className="space-y-1.5">
                <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {MODULE_GROUP_LABELS[group]}
                </h4>
                <div className="space-y-1">
                  {modulesByGroup[group].map((m) => {
                    const level = c.permissions[m.key];
                    return (
                      <div
                        key={m.key}
                        className="flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-background/60"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{m.label}</p>
                        </div>
                        <Select
                          value={level}
                          onValueChange={(v) => onUpdatePermission(c.id, m.key, v as AccessLevel)}
                        >
                          <SelectTrigger
                            className={cn(
                              'h-7 text-xs w-[120px] gap-1',
                              level === 'none' && 'text-muted-foreground',
                              level === 'view' && 'text-primary border-primary/30',
                              level === 'edit' && 'text-success border-success/30',
                            )}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{ACCESS_LABELS.none}</SelectItem>
                            <SelectItem value="view">{ACCESS_LABELS.view}</SelectItem>
                            <SelectItem value="edit">{ACCESS_LABELS.edit}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
