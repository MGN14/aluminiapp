/**
 * Lista de documentos que un banco típicamente pide para evaluar crédito
 * empresarial en Colombia. Solo recordatorios + links a portales oficiales.
 * AluminIA no almacena ni consulta estos documentos automáticamente —
 * el usuario los obtiene por su cuenta.
 */

export type DocCategory = 'antecedentes' | 'fiscales' | 'financieros' | 'personales' | 'operativos';

export interface DocBancario {
  id: string;
  nombre: string;
  descripcion: string;
  category: DocCategory;
  link?: string;
  linkLabel?: string;
  costoLabel?: string;
}

export const CATEGORY_LABELS: Record<DocCategory, string> = {
  antecedentes: 'Antecedentes y certificados',
  fiscales: 'Información fiscal',
  financieros: 'Estados financieros',
  personales: 'Información del representante legal',
  operativos: 'Información operativa',
};

export const DOCUMENTOS_BANCO: DocBancario[] = [
  // Antecedentes (todos gratis, online)
  {
    id: 'cert-camara',
    nombre: 'Certificado de Existencia y Representación Legal',
    descripcion: 'Emitido por la Cámara de Comercio de tu ciudad. Vigencia típica 30-90 días.',
    category: 'antecedentes',
    link: 'https://www.ccb.org.co/Tramites-y-Consultas/Certificados-en-Linea',
    linkLabel: 'CCB · Bogotá',
    costoLabel: 'Pago',
  },
  {
    id: 'antec-procuraduria',
    nombre: 'Antecedentes Procuraduría',
    descripcion: 'Certificado de antecedentes disciplinarios del representante legal.',
    category: 'antecedentes',
    link: 'https://www.procuraduria.gov.co/CertWEB/Certificado.aspx?tpo=2',
    linkLabel: 'Procuraduría',
    costoLabel: 'Gratis',
  },
  {
    id: 'antec-contraloria',
    nombre: 'Antecedentes Contraloría',
    descripcion: 'Certificado de responsabilidad fiscal del representante legal.',
    category: 'antecedentes',
    link: 'https://www.contraloria.gov.co/web/guest/persona-natural-y-juridica',
    linkLabel: 'Contraloría',
    costoLabel: 'Gratis',
  },
  {
    id: 'antec-policia',
    nombre: 'Antecedentes Policía',
    descripcion: 'Certificado judicial del representante legal.',
    category: 'antecedentes',
    link: 'https://antecedentes.policia.gov.co:7005/WebAntecedentes/',
    linkLabel: 'Policía Nacional',
    costoLabel: 'Gratis',
  },
  {
    id: 'rnmc',
    nombre: 'Registro Nacional de Medidas Correctivas (RNMC)',
    descripcion: 'Constancia de medidas correctivas pendientes (Código de Policía).',
    category: 'antecedentes',
    link: 'https://srvcnpc.policia.gov.co/PSC/frm_cnp_consulta.aspx',
    linkLabel: 'RNMC',
    costoLabel: 'Gratis',
  },

  // Fiscales
  {
    id: 'rut',
    nombre: 'RUT actualizado',
    descripcion: 'Registro Único Tributario emitido por DIAN, actualizado.',
    category: 'fiscales',
    link: 'https://muisca.dian.gov.co/WebRutMuisca/DefConsultaEstadoRUT.faces',
    linkLabel: 'DIAN MUISCA',
    costoLabel: 'Gratis',
  },
  {
    id: 'declaracion-renta',
    nombre: 'Declaración de Renta último año',
    descripcion: 'Última declaración presentada ante DIAN. Algunos bancos piden los 2 últimos años.',
    category: 'fiscales',
  },

  // Financieros (firmados por contador)
  {
    id: 'estados-financieros',
    nombre: 'Estados Financieros últimos 2 años',
    descripcion: 'Estado de resultados y balance general firmados por contador público titulado.',
    category: 'financieros',
  },
  {
    id: 'flujo-caja-proyectado',
    nombre: 'Flujo de caja proyectado',
    descripcion: 'Proyección de ingresos y egresos a 12 meses.',
    category: 'financieros',
  },

  // Personales (representante legal)
  {
    id: 'cedula-rep',
    nombre: 'Cédula del representante legal',
    descripcion: 'Copia legible y vigente.',
    category: 'personales',
  },
  {
    id: 'score-datacredito',
    nombre: 'Score Datacrédito',
    descripcion: 'Score crediticio del representante legal y/o de la empresa. Tenés derecho a consulta gratis 1 vez al año.',
    category: 'personales',
    link: 'https://www.midatacredito.com/',
    linkLabel: 'Mi Datacrédito',
    costoLabel: '1 gratis/año',
  },
  {
    id: 'referencias-bancarias',
    nombre: 'Referencias bancarias',
    descripcion: 'Cartas de bancos donde tenés cuentas activas indicando antigüedad y manejo.',
    category: 'personales',
  },
  {
    id: 'referencias-comerciales',
    nombre: 'Referencias comerciales',
    descripcion: 'Cartas de proveedores o clientes principales con plazos de pago y volumen.',
    category: 'personales',
  },

  // Operativos (los tenés en AluminIA)
  {
    id: 'extractos-bancarios',
    nombre: 'Extractos bancarios últimos 3-6 meses',
    descripcion: 'De todas las cuentas bancarias activas de la empresa.',
    category: 'operativos',
  },
  {
    id: 'facturas-recientes',
    nombre: 'Facturas de venta recientes',
    descripcion: 'Últimos 3 meses, idealmente firmadas por el cliente.',
    category: 'operativos',
  },
];

export function groupDocsByCategory(): Record<DocCategory, DocBancario[]> {
  const groups: Record<DocCategory, DocBancario[]> = {
    antecedentes: [],
    fiscales: [],
    financieros: [],
    personales: [],
    operativos: [],
  };
  for (const d of DOCUMENTOS_BANCO) {
    groups[d.category].push(d);
  }
  return groups;
}
