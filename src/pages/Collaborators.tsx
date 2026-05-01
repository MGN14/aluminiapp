import { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCollaborators } from '@/hooks/useCollaborators';
import InviteCollaboratorModal from '@/components/collaborators/InviteCollaboratorModal';
import CollaboratorCard from '@/components/collaborators/CollaboratorCard';
import { Users, UserPlus, Loader2, Crown, Shield, UserX } from 'lucide-react';

export default function Collaborators() {
  const {
    collaborators,
    loading,
    inviteCollaborator,
    updatePermission,
    updateAllPermissions,
    deleteCollaborator,
    canInvite,
    hasRoleAvailable,
  } = useCollaborators();
  const [showInvite, setShowInvite] = useState(false);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  const totalUsers = collaborators.length + 1; // +1 for admin/owner
  const slotsRemaining = Math.max(0, 2 - collaborators.length);

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Colaboradores</h1>
              <p className="text-muted-foreground text-xs mt-0.5">
                {totalUsers}/3 usuarios · {slotsRemaining > 0 ? `${slotsRemaining} cupo${slotsRemaining === 1 ? '' : 's'} disponible${slotsRemaining === 1 ? '' : 's'}` : 'límite alcanzado'}
              </p>
            </div>
          </div>
          <Button onClick={() => setShowInvite(true)} disabled={!canInvite} className="gap-2">
            <UserPlus className="h-4 w-4" />
            Invitar colaborador
          </Button>
        </div>

        {/* Resumen de roles activos — compacto */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-3 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <Crown className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Admin</p>
                <p className="text-xs font-medium truncate">Tú (propietario)</p>
              </div>
            </CardContent>
          </Card>

          {(['contadora', 'colaborador'] as const).map(role => {
            const collab = collaborators.find(c => c.role === role);
            const isAssigned = !!collab;
            return (
              <Card key={role} className={isAssigned ? 'border-success/20 bg-success/5' : 'border-dashed'}>
                <CardContent className="p-3 flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isAssigned ? 'bg-success/15' : 'bg-muted'}`}>
                    {isAssigned
                      ? <Shield className="h-4 w-4 text-success" />
                      : <UserX className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground capitalize">{role}</p>
                    <p className="text-xs font-medium truncate">
                      {collab ? collab.name || collab.collaborator_email : 'Sin asignar'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Lista de colaboradores con cards expansibles */}
        {collaborators.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">No tenés colaboradores invitados</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Invitá a tu contadora o a un colaborador para que accedan con permisos personalizados.
                </p>
              </div>
              <Button onClick={() => setShowInvite(true)} size="sm" className="gap-1.5">
                <UserPlus className="h-3.5 w-3.5" />
                Invitar primero
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Permisos por colaborador
            </p>
            {collaborators.map((c) => (
              <CollaboratorCard
                key={c.id}
                collaborator={c}
                onUpdatePermission={updatePermission}
                onUpdateAllPermissions={updateAllPermissions}
                onDelete={deleteCollaborator}
              />
            ))}
            <p className="text-[10px] text-muted-foreground italic px-1">
              Click en cada colaborador para ver y editar sus permisos. Los cambios se guardan al instante.
            </p>
          </div>
        )}

        <InviteCollaboratorModal
          open={showInvite}
          onOpenChange={setShowInvite}
          onInvite={inviteCollaborator}
          hasRoleAvailable={hasRoleAvailable}
        />
      </div>
    </AppLayout>
  );
}
