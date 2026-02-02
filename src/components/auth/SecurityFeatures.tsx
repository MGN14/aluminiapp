import { Shield, Lock, FileCheck } from 'lucide-react';

const features = [
  {
    icon: Shield,
    title: 'Seguridad Bancaria',
    description: 'Encriptación de nivel bancario para proteger tus datos financieros',
  },
  {
    icon: Lock,
    title: 'Datos Protegidos',
    description: 'Tus estados de cuenta están seguros con encriptación SSL de 256 bits',
  },
  {
    icon: FileCheck,
    title: 'Cumplimiento Fiscal',
    description: 'Cumple con regulaciones fiscales de múltiples países latinoamericanos',
  },
];

export default function SecurityFeatures() {
  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-foreground">
        Tu seguridad es nuestra prioridad
      </h3>
      <div className="space-y-4">
        {features.map((feature) => (
          <div
            key={feature.title}
            className="flex gap-4 p-4 rounded-lg bg-card border border-border"
          >
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <feature.icon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h4 className="font-medium text-foreground">{feature.title}</h4>
              <p className="text-sm text-muted-foreground mt-1">
                {feature.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
