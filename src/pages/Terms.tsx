import { Link } from 'react-router-dom';
import { FileSpreadsheet, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">AluminIA</span>
          </Link>
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Volver
            </Button>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold text-foreground mb-2">Términos y Condiciones</h1>
        <p className="text-muted-foreground mb-8">Última actualización: Febrero 2026</p>

        <div className="prose prose-slate dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Aceptación de los Términos</h2>
            <p className="text-muted-foreground leading-relaxed">
              Al acceder y utilizar AluminIA ("la Plataforma"), usted acepta estos Términos y Condiciones en su totalidad. 
              Si no está de acuerdo con alguna parte de estos términos, no debe utilizar nuestros servicios.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. Descripción del Servicio</h2>
            <p className="text-muted-foreground leading-relaxed">
              AluminIA es una herramienta de gestión financiera diseñada para pequeñas y medianas empresas colombianas. 
              El servicio permite:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-3">
              <li>Procesar extractos bancarios en formato PDF</li>
              <li>Clasificar y organizar transacciones financieras</li>
              <li>Calcular estimaciones de IVA y retenciones</li>
              <li>Exportar información a formato Excel</li>
            </ul>
          </section>

          <section className="bg-warning/10 border border-warning/30 rounded-lg p-4">
            <h2 className="text-xl font-semibold text-foreground mb-3">3. Limitación Importante</h2>
            <p className="text-foreground leading-relaxed font-medium">
              AluminIA NO es un software de contabilidad y NO reemplaza los servicios de un contador público certificado.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-2">
              Los cálculos de IVA, retenciones y demás estimaciones fiscales son aproximados y tienen fines informativos únicamente. 
              Para obligaciones tributarias oficiales, consulte siempre con un profesional contable autorizado.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Responsabilidades del Usuario</h2>
            <p className="text-muted-foreground leading-relaxed">El usuario se compromete a:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-3">
              <li>Proporcionar información veraz y mantener sus credenciales seguras</li>
              <li>Utilizar la plataforma únicamente para fines legales y comerciales legítimos</li>
              <li>No intentar acceder a datos de otros usuarios o vulnerar la seguridad del sistema</li>
              <li>Verificar la exactitud de los datos procesados antes de tomar decisiones financieras</li>
              <li>Mantener copias de seguridad de sus documentos originales</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. Propiedad de los Datos</h2>
            <p className="text-muted-foreground leading-relaxed">
              Usted mantiene la propiedad total de los documentos y datos que carga en la plataforma. 
              AluminIA no utiliza sus datos financieros para fines distintos a la prestación del servicio. 
              No vendemos, compartimos ni monetizamos su información.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. Disponibilidad del Servicio</h2>
            <p className="text-muted-foreground leading-relaxed">
              Nos esforzamos por mantener la plataforma disponible 24/7, pero no garantizamos disponibilidad ininterrumpida. 
              Podemos realizar mantenimientos programados o de emergencia que afecten temporalmente el acceso al servicio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Limitación de Responsabilidad</h2>
            <p className="text-muted-foreground leading-relaxed">
              AluminIA no será responsable por:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-3">
              <li>Decisiones financieras o tributarias basadas en la información proporcionada</li>
              <li>Errores en el procesamiento derivados de documentos ilegibles o mal formateados</li>
              <li>Pérdidas económicas derivadas del uso o imposibilidad de uso del servicio</li>
              <li>Sanciones o multas impuestas por entidades tributarias</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Modificaciones</h2>
            <p className="text-muted-foreground leading-relaxed">
              Nos reservamos el derecho de modificar estos términos en cualquier momento. 
              Los cambios significativos serán notificados por correo electrónico con al menos 15 días de anticipación. 
              El uso continuado del servicio después de las modificaciones implica su aceptación.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">9. Legislación Aplicable</h2>
            <p className="text-muted-foreground leading-relaxed">
              Estos términos se rigen por las leyes de la República de Colombia. 
              Cualquier disputa será resuelta ante los tribunales competentes de la ciudad de Bogotá D.C.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">10. Contacto</h2>
            <p className="text-muted-foreground leading-relaxed">
              Para preguntas sobre estos términos, contáctenos en:{' '}
              <a href="mailto:soporte@aluminia.app" className="text-primary hover:underline">
                soporte@aluminia.app
              </a>
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30 py-8 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} AluminIA. Hecho en Colombia 🇨🇴</p>
          <div className="flex justify-center gap-4 mt-2">
            <Link to="/privacy" className="hover:text-foreground">Política de Privacidad</Link>
            <Link to="/contact" className="hover:text-foreground">Contacto</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
