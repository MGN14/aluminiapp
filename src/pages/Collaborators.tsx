import { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCollaborators } from '@/hooks/useCollaborators';
import InviteCollaboratorModal from '@/components/collaborators/InviteCollaboratorModal';
import CollaboratorsTable from '@/components/collaborators/CollaboratorsTable';
import { Users, UserPlus, Loader2, Crown, Shield } from 'lucide-react';

export default function Collaborators() {
  const {
    collaborators,
    loading,
    inviteCollaborator,
    updatePermission,
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

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Users className="h-6 w-6" />
              Colaboradores
            </h1>
            <p className="text-muted-foreground mt-1">
              Gestiona los usuarios que tienen acceso a tu cuenta. Máximo 3 usuarios.
            </p>
          </div>
          <Button onClick={() => setShowInvite(true)} disabled={!canInvite}>
            <UserPlus className="h-4 w-4 mr-2" />
            Invitar
          </Button>
        </div>

        {/* Current users summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Crown className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Administrador</p>
                <p className="text-xs text-muted-foreground">Tú (propietario)</p>
              </div>
            </CardContent>
          </Card>

          {['contadora', 'colaborador'].map(role => {
            const collab = collaborators.find(c => c.role === role);
            return (
              <Card key={role} className={!collab ? 'border-dashed' : ''}>
                <CardContent className="pt-4 pb-3 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${collab ? 'bg-success/10' : 'bg-muted'}`}>
                    <Shield className={`h-5 w-5 ${collab ? 'text-success' : 'text-muted-foreground'}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold capitalize">{role}</p>
                    <p className="text-xs text-muted-foreground">
                      {collab ? collab.name || collab.collaborator_email : 'Sin asignar'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Usage */}
        <p className="text-sm text-muted-foreground">
          {totalUsers}/3 usuarios activos
          {!canInvite && ' — Límite alcanzado'}
        </p>

        {/* Collaborators table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Permisos por módulo</CardTitle>
            <CardDescription>
              Configura qué puede ver o editar cada colaborador. Los cambios aplican inmediatamente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CollaboratorsTable
              collaborators={collaborators}
              onUpdatePermission={updatePermission}
              onDelete={deleteCollaborator}
            />
          </CardContent>
        </Card>

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
