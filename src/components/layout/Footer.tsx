import { Link } from 'react-router-dom';
import { FileSpreadsheet } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-border bg-muted/30 py-10">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded gradient-brand flex items-center justify-center">
                <FileSpreadsheet className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold text-foreground">AluminIA</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              Claridad financiera para PyMEs colombianas.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-medium text-foreground mb-3 text-sm">Producto</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">
                  Precios
                </Link>
              </li>
              <li>
                <Link to="/signup" className="text-muted-foreground hover:text-foreground transition-colors">
                  Crear cuenta
                </Link>
              </li>
              <li>
                <Link to="/login" className="text-muted-foreground hover:text-foreground transition-colors">
                  Iniciar sesión
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-medium text-foreground mb-3 text-sm">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/terms" className="text-muted-foreground hover:text-foreground transition-colors">
                  Términos y condiciones
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
                  Política de privacidad
                </Link>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="font-medium text-foreground mb-3 text-sm">Soporte</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/contact" className="text-muted-foreground hover:text-foreground transition-colors">
                  Contacto
                </Link>
              </li>
              <li>
                <a
                  href="mailto:soporte@aluminiapp.com"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  soporte@aluminiapp.com
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border mt-8 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} AluminIA (aluminiapp.com). Hecho con ❤️ en Colombia 🇨🇴
          </p>
          <p className="text-xs text-muted-foreground">
            AluminIA no es software de contabilidad y no reemplaza a un contador certificado.
          </p>
        </div>
      </div>
    </footer>
  );
}
