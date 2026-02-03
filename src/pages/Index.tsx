import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, Upload, TableProperties, Download, ArrowRight, Shield, Zap, CheckCircle } from 'lucide-react';
import MobileNav from '@/components/layout/MobileNav';
import Footer from '@/components/layout/Footer';

export default function Index() {
  return <div className="min-h-screen bg-background flex flex-col">
      {/* Navigation */}
      <nav className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">AluminIA</span>
          </div>
          
          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-4">
            <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Precios
            </Link>
            <Link to="/contact" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Contacto
            </Link>
            <Link to="/login">
              <Button variant="ghost" size="sm">
                Iniciar Sesión
              </Button>
            </Link>
            <Link to="/signup">
              <Button size="sm">
                Crear Cuenta
              </Button>
            </Link>
          </div>

          {/* Mobile nav */}
          <MobileNav isAuthenticated={false} />
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 gradient-brand opacity-5" />
        <div className="container mx-auto px-4 py-20 md:py-32 relative">
          <div className="max-w-3xl mx-auto text-center animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 text-accent text-sm font-medium mb-6">
              <Shield className="w-4 h-4" />
              Para empresarios colombianos
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 text-balance">
              Convierte tus extractos de{' '}
              <span className="text-success">Bancolombia</span>{' '}
              en datos organizados
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Sube tu PDF, extrae las transacciones automáticamente, categoriza y exporta a Excel. 
              Simple, rápido y seguro.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/signup">
                <Button size="lg" className="h-12 px-8 text-base">
                  Comenzar gratis
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="outline" size="lg" className="h-12 px-8 text-base">
                  Ya tengo cuenta
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16 animate-fade-in">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Cómo funciona
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              En tres simples pasos, transforma tu extracto bancario en información útil.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Step 1 */}
            <div className="bg-card rounded-xl p-8 border border-border shadow-sm hover:shadow-md transition-shadow animate-slide-up">
              <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center mb-6">
                <Upload className="w-7 h-7 text-accent" />
              </div>
              <div className="text-sm font-medium text-accent mb-2">Paso 1</div>
              <h3 className="text-xl font-semibold text-foreground mb-3">
                Sube tu PDF
              </h3>
              <p className="text-muted-foreground">
                Arrastra y suelta el extracto bancario de Bancolombia directamente en la plataforma.
              </p>
            </div>

            {/* Step 2 */}
            <div className="bg-card rounded-xl p-8 border border-border shadow-sm hover:shadow-md transition-shadow animate-slide-up" style={{
            animationDelay: '0.1s'
          }}>
              <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center mb-6">
                <TableProperties className="w-7 h-7 text-accent" />
              </div>
              <div className="text-sm font-medium text-accent mb-2">Paso 2</div>
              <h3 className="text-xl font-semibold text-foreground mb-3">
                Revisa y categoriza
              </h3>
              <p className="text-muted-foreground">
                Visualiza todas tus transacciones en una tabla limpia y asigna categorías manualmente.
              </p>
            </div>

            {/* Step 3 */}
            <div className="bg-card rounded-xl p-8 border border-border shadow-sm hover:shadow-md transition-shadow animate-slide-up" style={{
            animationDelay: '0.2s'
          }}>
              <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center mb-6">
                <Download className="w-7 h-7 text-accent" />
              </div>
              <div className="text-sm font-medium text-accent mb-2">Paso 3</div>
              <h3 className="text-xl font-semibold text-foreground mb-3">
                Exporta a Excel
              </h3>
              <p className="text-muted-foreground">
                Descarga tus transacciones categorizadas en un archivo Excel listo para usar.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="animate-fade-in">
                <h2 className="text-3xl font-bold text-foreground mb-6">
                  Diseñado para empresarios que valoran su tiempo
                </h2>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-6 h-6 text-success flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-foreground">Ahorra horas de trabajo manual</h4>
                      <p className="text-muted-foreground text-sm">No más copiar y pegar transacción por transacción.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-6 h-6 text-success flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-foreground">Información precisa</h4>
                      <p className="text-muted-foreground text-sm">Extracción automática reduce errores humanos.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-6 h-6 text-success flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-foreground">Tus datos, tu control</h4>
                      <p className="text-muted-foreground text-sm">Información almacenada de forma segura y privada.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-6 h-6 text-success flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-foreground">Fácil de usar</h4>
                      <p className="text-muted-foreground text-sm">Sin configuración compleja, empieza en minutos.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-muted/50 rounded-2xl p-8 border border-border animate-slide-up text-warning-foreground">
                <div className="flex items-center gap-3 mb-6">
                  <Zap className="w-8 h-8 text-foreground" />
                  <div>
                    <div className="text-2xl font-bold text-foreground">MVP</div>
                    <div className="text-sm text-muted-foreground">Primera versión</div>
                  </div>
                </div>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                    <span className="text-foreground">Soporte para extractos Bancolombia</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                    <span className="text-foreground">Extracción de fecha, descripción, débito, crédito</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                    <span className="text-foreground">Categorización manual</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                    <span className="text-foreground">Exportación a Excel (.xlsx)</span>
                  </li>
                </ul>
                <div className="mt-6 pt-6 border-t border-border">
                  <Link to="/signup">
                    <Button className="w-full">
                      Probar ahora
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>;
}