import { Navigate } from 'react-router-dom';

// Compat: /cotizaciones se unificó dentro del hub /productos-terminados.
// La pestaña 'cotizaciones' es la default cuando se entra sin ?tab=.
export default function Cotizaciones() {
  return <Navigate to="/productos-terminados?tab=cotizaciones" replace />;
}
