import { Link } from 'react-router-dom';
import { FileSpreadsheet, ArrowLeft, Shield, Lock, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Privacy() {
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
        <h1 className="text-3xl font-bold text-foreground mb-2">Política de Privacidad</h1>
        <p className="text-muted-foreground mb-8">Última actualización: Febrero 2026</p>

        {/* Trust badges */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          <div className="flex flex-col items-center text-center p-4 bg-card rounded-lg border border-border">
            <Shield className="w-6 h-6 text-accent mb-2" />
            <span className="text-xs text-muted-foreground">Datos Protegidos</span>
          </div>
          <div className="flex flex-col items-center text-center p-4 bg-card rounded-lg border border-border">
            <Lock className="w-6 h-6 text-accent mb-2" />
            <span className="text-xs text-muted-foreground">Cifrado SSL</span>
          </div>
          <div className="flex flex-col items-center text-center p-4 bg-card rounded-lg border border-border">
            <Server className="w-6 h-6 text-accent mb-2" />
            <span className="text-xs text-muted-foreground">Servidores Seguros</span>
          </div>
        </div>

        <div className="prose prose-slate dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Información que Recopilamos</h2>
            <p className="text-muted-foreground leading-relaxed">
              Recopilamos la siguiente información para prestar nuestros servicios:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-3">
              <li><strong>Datos de cuenta:</strong> Nombre, correo electrónico y contraseña cifrada</li>
              <li><strong>Documentos financieros:</strong> Extractos bancarios PDF que usted carga voluntariamente</li>
              <li><strong>Datos de transacciones:</strong> Información extraída de sus extractos (fechas, montos, descripciones)</li>
              <li><strong>Datos de uso:</strong> Información técnica sobre cómo utiliza la plataforma</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. Uso de la Información</h2>
            <p className="text-muted-foreground leading-relaxed">Utilizamos su información exclusivamente para:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-3">
              <li>Procesar y organizar sus transacciones financieras</li>
              <li>Generar reportes y estimaciones fiscales</li>
              <li>Mejorar la funcionalidad y experiencia de la plataforma</li>
              <li>Comunicarnos con usted sobre su cuenta o cambios en el servicio</li>
            </ul>
          </section>

          <section className="bg-accent/10 border border-accent/30 rounded-lg p-4">
            <h2 className="text-xl font-semibold text-foreground mb-3">3. Lo que NO Hacemos</h2>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>NO vendemos su información a terceros</li>
              <li>NO compartimos sus datos financieros con anunciantes</li>
              <li>NO utilizamos sus datos para fines distintos al servicio</li>
              <li>NO accedemos a su cuenta bancaria directamente</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Protección de Datos</h2>
            <p className="text-muted-foreground leading-relaxed">
              Implementamos medidas de seguridad para proteger su información:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-3">
              <li>Cifrado SSL/TLS para todas las comunicaciones</li>
              <li>Contraseñas almacenadas con hash seguro (bcrypt)</li>
              <li>Acceso restringido a datos mediante políticas de seguridad (RLS)</li>
              <li>Servidores con certificaciones de seguridad</li>
              <li>Copias de seguridad automáticas cifradas</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. Almacenamiento y Retención</h2>
            <p className="text-muted-foreground leading-relaxed">
              Sus datos se almacenan en servidores seguros. Conservamos su información mientras mantenga una cuenta activa. 
              Los documentos PDF originales se procesan y pueden eliminarse después de la extracción de datos, 
              mientras que los datos estructurados permanecen disponibles para su consulta.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. Sus Derechos</h2>
            <p className="text-muted-foreground leading-relaxed">
              De acuerdo con la Ley 1581 de 2012 (Ley de Protección de Datos Personales de Colombia), usted tiene derecho a:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-3">
              <li><strong>Acceso:</strong> Conocer qué datos tenemos sobre usted</li>
              <li><strong>Rectificación:</strong> Corregir información incorrecta</li>
              <li><strong>Eliminación:</strong> Solicitar la eliminación de sus datos</li>
              <li><strong>Exportación:</strong> Obtener una copia de sus datos en formato portable</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              Para ejercer estos derechos, contáctenos a través de{' '}
              <a href="mailto:soporte@aluminia.app" className="text-primary hover:underline">
                soporte@aluminia.app
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Cookies y Tecnologías Similares</h2>
            <p className="text-muted-foreground leading-relaxed">
              Utilizamos cookies esenciales para mantener su sesión activa y recordar sus preferencias. 
              No utilizamos cookies de seguimiento publicitario ni compartimos información con redes de anuncios.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Menores de Edad</h2>
            <p className="text-muted-foreground leading-relaxed">
              AluminIA está diseñado para uso empresarial y no está dirigido a menores de 18 años. 
              No recopilamos intencionalmente información de menores.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">9. Cambios en esta Política</h2>
            <p className="text-muted-foreground leading-relaxed">
              Podemos actualizar esta política periódicamente. Los cambios significativos serán notificados 
              por correo electrónico y/o mediante un aviso visible en la plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">10. Contacto</h2>
            <p className="text-muted-foreground leading-relaxed">
              Para consultas sobre privacidad o protección de datos:{' '}
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
            <Link to="/terms" className="hover:text-foreground">Términos y Condiciones</Link>
            <Link to="/contact" className="hover:text-foreground">Contacto</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
