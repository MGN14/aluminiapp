import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Trash2 } from 'lucide-react';
import { MODULE_KEYS, type Collaborator, type ModuleKey, type AccessLevel } from '@/hooks/useCollaborators';

const ACCESS_LABELS: Record<AccessLevel, string> = {
  none: 'Sin acceso',
  view: 'Solo ver',
  edit: 'Editar',
};

const ACCESS_COLORS: Record<AccessLevel, string> = {
  none: 'bg-muted text-muted-foreground',
  view: 'bg-primary/10 text-primary',
  edit: 'bg-success/10 text-success',
};

interface Props {
  collaborators: Collaborator[];
  onUpdatePermission: (collaboratorId: string, moduleKey: ModuleKey, level: AccessLevel) => void;
  onDelete: (collaboratorId: string) => void;
}

export default function CollaboratorsTable({ collaborators, onUpdatePermission, onDelete }: Props) {
  if (collaborators.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No hay colaboradores invitados aún.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[140px]">Nombre</TableHead>
            <TableHead className="w-[180px]">Email</TableHead>
            <TableHead className="w-[100px]">Rol</TableHead>
            {MODULE_KEYS.map(m => (
              <TableHead key={m.key} className="text-center text-xs w-[110px]">{m.label}</TableHead>
            ))}
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {collaborators.map(c => (
            <TableRow key={c.id}>
              <TableCell className="font-medium text-sm">
                {c.name || '—'}
                {c.status === 'pending' && (
                  <Badge variant="outline" className="ml-1.5 text-[10px]">Pendiente</Badge>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{c.collaborator_email}</TableCell>
              <TableCell>
                <Badge variant="secondary" className="capitalize text-xs">
                  {c.role}
                </Badge>
              </TableCell>
              {MODULE_KEYS.map(m => (
                <TableCell key={m.key} className="text-center p-1">
                  <Select
                    value={c.permissions[m.key]}
                    onValueChange={(v) => onUpdatePermission(c.id, m.key, v as AccessLevel)}
                  >
                    <SelectTrigger className="h-7 text-[11px] w-[100px] mx-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{ACCESS_LABELS.none}</SelectItem>
                      <SelectItem value="view">{ACCESS_LABELS.view}</SelectItem>
                      <SelectItem value="edit">{ACCESS_LABELS.edit}</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              ))}
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => onDelete(c.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
