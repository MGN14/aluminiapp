import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserRound, Plus, AlertTriangle, CheckCircle2, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePayrollEmployees } from '@/hooks/usePayrollEmployees';
import { computeEmployeePrestaciones, type EmployeeRow } from '@/lib/payrollEmployee';
import EmployeeModal from './EmployeeModal';

const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

/**
 * Empleados con su estado de cumplimiento: cada card responde "¿estoy al día
 * con esta persona?" (dotación, vacaciones, prima) y muestra su pasivo
 * laboral acumulado. Click → modal con el reporte completo y novedades.
 */
export default function EmployeesSection() {
  const { employees, events, params, saveParams } = usePayrollEmployees();
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<EmployeeRow | null>(null);
  const [editParams, setEditParams] = useState(false);
  const [smmlv, setSmmlv] = useState<number | ''>('');
  const [aux, setAux] = useState<number | ''>('');

  const activos = employees.filter(e => e.activo);
  const totalSalarios = activos.reduce((s, e) => s + Number(e.salario_base), 0);
  const prestByEmp = activos.map(e => ({
    emp: e,
    prest: computeEmployeePrestaciones(e, events, params),
  }));
  const pasivoTotal = prestByEmp.reduce((s, { prest }) =>
    s + prest.cesantiasAcum + prest.interesesCesantiasAcum + prest.primaAcum + prest.vacacionesProvisionAcum, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <UserRound className="h-5 w-5 text-primary" />
              Empleados
              {activos.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({activos.length} activo{activos.length !== 1 ? 's' : ''} · {fmtCOP(totalSalarios)}/mes · pasivo acumulado {fmtCOP(pasivoTotal)})
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              Prestaciones, dotación y vacaciones por persona — cada card te dice si estás al día.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost" size="sm" className="h-8 text-xs gap-1 text-muted-foreground"
              onClick={() => {
                setEditParams(v => !v);
                setSmmlv(params.smmlv);
                setAux(params.auxTransporte);
              }}
            >
              <Settings2 className="h-3.5 w-3.5" />
              SMMLV {fmtCOP(params.smmlv)}
            </Button>
            <Button size="sm" className="h-8 gap-1" onClick={() => { setSelected(null); setModalOpen(true); }}>
              <Plus className="h-4 w-4" /> Empleado
            </Button>
          </div>
        </div>
        {editParams && (
          <div className="flex items-end gap-2 pt-2">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">SMMLV vigente</p>
              <Input type="number" value={smmlv} onChange={e => setSmmlv(e.target.value === '' ? '' : +e.target.value)} className="h-8 w-32 text-xs font-mono" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Aux. transporte</p>
              <Input type="number" value={aux} onChange={e => setAux(e.target.value === '' ? '' : +e.target.value)} className="h-8 w-28 text-xs font-mono" />
            </div>
            <Button
              size="sm" className="h-8 text-xs"
              disabled={smmlv === '' || aux === '' || saveParams.isPending}
              onClick={async () => {
                await saveParams.mutateAsync({ smmlv: Number(smmlv), auxTransporte: Number(aux) });
                setEditParams(false);
              }}
            >
              Guardar
            </Button>
            <p className="text-[10px] text-muted-foreground pb-2">Verificá el decreto de cada año.</p>
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {activos.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <UserRound className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Agregá tu primer empleado para llevar cesantías, prima, vacaciones y dotación por persona.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2.5">
            {prestByEmp.map(({ emp, prest }) => {
              const alertas: string[] = [];
              if (prest.dotacionPendientes.length) alertas.push(`dotación ${prest.dotacionPendientes.length} pendiente${prest.dotacionPendientes.length > 1 ? 's' : ''}`);
              if (prest.vacacionesDiasPendientes > 15) alertas.push(`${prest.vacacionesDiasPendientes}d de vacaciones sin tomar`);
              const alDia = alertas.length === 0;
              return (
                <button
                  key={emp.id}
                  className="text-left rounded-xl border border-border bg-card px-4 py-3 hover:border-primary/40 hover:shadow-sm transition-all"
                  onClick={() => { setSelected(emp); setModalOpen(true); }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{emp.nombre}</p>
                    {alDia
                      ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                      : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {emp.cargo || 'Sin cargo'} · {fmtCOP(Number(emp.salario_base))}/mes
                    {prest.tieneAuxTransporte ? ' + aux' : ''}
                  </p>
                  <p className={cn('text-[11px] mt-1.5', alDia ? 'text-success' : 'text-amber-600 dark:text-amber-500 font-medium')}>
                    {alDia
                      ? `Al día · pasivo ${fmtCOP(prest.cesantiasAcum + prest.interesesCesantiasAcum + prest.primaAcum + prest.vacacionesProvisionAcum)}`
                      : alertas.join(' · ')}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>

      <EmployeeModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setSelected(null); }}
        employee={selected}
      />
    </Card>
  );
}
