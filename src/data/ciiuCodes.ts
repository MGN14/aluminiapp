// Códigos CIIU Rev 4 A.C. (DANE/DIAN) — selección de los ~100 más comunes
// en pymes colombianas. Cada código está taggeado con la actividad principal
// a la que suele pertenecer para poder pre-filtrar la lista en el combobox.

export type ActividadTag = 'distribuidor' | 'fabricante' | 'servicios' | 'construccion' | 'mixto';

export interface CiiuCode {
  code: string;          // 4 dígitos (CIIU Rev 4)
  label: string;         // nombre de la actividad
  tags: ActividadTag[];  // actividades en las que se muestra
  seccion: string;       // letra de sección DANE (A-U)
}

export const CIIU_CODES: CiiuCode[] = [
  // ── SECCIÓN C — Industrias manufactureras (fabricante) ─────────────────
  { code: '1011', label: 'Procesamiento y conservación de carne', tags: ['fabricante'], seccion: 'C' },
  { code: '1040', label: 'Elaboración de aceites y grasas', tags: ['fabricante'], seccion: 'C' },
  { code: '1051', label: 'Elaboración de productos lácteos', tags: ['fabricante'], seccion: 'C' },
  { code: '1081', label: 'Elaboración de azúcar y panela', tags: ['fabricante'], seccion: 'C' },
  { code: '1084', label: 'Elaboración de comidas y platos preparados', tags: ['fabricante'], seccion: 'C' },
  { code: '1089', label: 'Elaboración de otros productos alimenticios', tags: ['fabricante'], seccion: 'C' },
  { code: '1090', label: 'Elaboración de alimentos para animales', tags: ['fabricante'], seccion: 'C' },
  { code: '1104', label: 'Elaboración de bebidas no alcohólicas y aguas', tags: ['fabricante'], seccion: 'C' },
  { code: '1311', label: 'Preparación e hilatura de fibras textiles', tags: ['fabricante'], seccion: 'C' },
  { code: '1410', label: 'Confección de prendas de vestir', tags: ['fabricante'], seccion: 'C' },
  { code: '1512', label: 'Fabricación de artículos de cuero', tags: ['fabricante'], seccion: 'C' },
  { code: '1521', label: 'Fabricación de calzado de cuero', tags: ['fabricante'], seccion: 'C' },
  { code: '1610', label: 'Aserrado, acepillado e impregnación de madera', tags: ['fabricante'], seccion: 'C' },
  { code: '1811', label: 'Actividades de impresión', tags: ['fabricante', 'servicios'], seccion: 'C' },
  { code: '2011', label: 'Fabricación de sustancias químicas básicas', tags: ['fabricante'], seccion: 'C' },
  { code: '2023', label: 'Fabricación de jabones, detergentes y cosméticos', tags: ['fabricante'], seccion: 'C' },
  { code: '2100', label: 'Fabricación de productos farmacéuticos', tags: ['fabricante'], seccion: 'C' },
  { code: '2211', label: 'Fabricación de llantas y neumáticos', tags: ['fabricante'], seccion: 'C' },
  { code: '2229', label: 'Fabricación de artículos de plástico', tags: ['fabricante'], seccion: 'C' },
  { code: '2395', label: 'Fabricación de artículos de hormigón y cemento', tags: ['fabricante', 'construccion'], seccion: 'C' },
  { code: '2410', label: 'Industrias básicas de hierro y acero', tags: ['fabricante'], seccion: 'C' },
  { code: '2511', label: 'Fabricación de productos metálicos para uso estructural', tags: ['fabricante', 'construccion'], seccion: 'C' },
  { code: '2592', label: 'Tratamiento y revestimiento de metales', tags: ['fabricante', 'servicios'], seccion: 'C' },
  { code: '2599', label: 'Fabricación de otros productos elaborados de metal', tags: ['fabricante'], seccion: 'C' },
  { code: '2732', label: 'Fabricación de hilos y cables eléctricos', tags: ['fabricante'], seccion: 'C' },
  { code: '2750', label: 'Fabricación de aparatos de uso doméstico', tags: ['fabricante'], seccion: 'C' },
  { code: '2811', label: 'Fabricación de motores y equipos industriales', tags: ['fabricante'], seccion: 'C' },
  { code: '3110', label: 'Fabricación de muebles', tags: ['fabricante'], seccion: 'C' },
  { code: '3290', label: 'Otras industrias manufactureras n.c.p.', tags: ['fabricante', 'mixto'], seccion: 'C' },
  { code: '3311', label: 'Mantenimiento y reparación de productos metálicos', tags: ['servicios', 'fabricante'], seccion: 'C' },

  // ── SECCIÓN F — Construcción ───────────────────────────────────────────
  { code: '4111', label: 'Construcción de edificios residenciales', tags: ['construccion'], seccion: 'F' },
  { code: '4112', label: 'Construcción de edificios no residenciales', tags: ['construccion'], seccion: 'F' },
  { code: '4210', label: 'Construcción de carreteras y vías férreas', tags: ['construccion'], seccion: 'F' },
  { code: '4220', label: 'Construcción de proyectos de servicio público', tags: ['construccion'], seccion: 'F' },
  { code: '4290', label: 'Construcción de otras obras de ingeniería civil', tags: ['construccion'], seccion: 'F' },
  { code: '4311', label: 'Demolición', tags: ['construccion', 'servicios'], seccion: 'F' },
  { code: '4312', label: 'Preparación del terreno', tags: ['construccion'], seccion: 'F' },
  { code: '4321', label: 'Instalaciones eléctricas', tags: ['construccion', 'servicios'], seccion: 'F' },
  { code: '4322', label: 'Instalaciones de fontanería, calefacción y aire', tags: ['construccion', 'servicios'], seccion: 'F' },
  { code: '4330', label: 'Terminación y acabado de edificios', tags: ['construccion', 'servicios'], seccion: 'F' },
  { code: '4390', label: 'Otras actividades especializadas de construcción', tags: ['construccion', 'servicios'], seccion: 'F' },

  // ── SECCIÓN G — Comercio al por mayor y al por menor (distribuidor) ────
  { code: '4511', label: 'Comercio de vehículos automotores nuevos', tags: ['distribuidor'], seccion: 'G' },
  { code: '4512', label: 'Comercio de vehículos automotores usados', tags: ['distribuidor'], seccion: 'G' },
  { code: '4520', label: 'Mantenimiento y reparación de vehículos automotores', tags: ['servicios'], seccion: 'G' },
  { code: '4530', label: 'Comercio de partes y accesorios de vehículos', tags: ['distribuidor'], seccion: 'G' },
  { code: '4541', label: 'Comercio de motocicletas y sus partes', tags: ['distribuidor'], seccion: 'G' },
  { code: '4610', label: 'Comercio al por mayor a cambio de retribución', tags: ['distribuidor', 'servicios'], seccion: 'G' },
  { code: '4620', label: 'Comercio al por mayor de materias primas agropecuarias', tags: ['distribuidor'], seccion: 'G' },
  { code: '4631', label: 'Comercio al por mayor de productos alimenticios', tags: ['distribuidor'], seccion: 'G' },
  { code: '4641', label: 'Comercio al por mayor de productos textiles y prendas', tags: ['distribuidor'], seccion: 'G' },
  { code: '4644', label: 'Comercio al por mayor de productos farmacéuticos', tags: ['distribuidor'], seccion: 'G' },
  { code: '4645', label: 'Comercio al por mayor de artículos de perfumería y cosméticos', tags: ['distribuidor'], seccion: 'G' },
  { code: '4651', label: 'Comercio al por mayor de computadores y equipos periféricos', tags: ['distribuidor'], seccion: 'G' },
  { code: '4652', label: 'Comercio al por mayor de electrodomésticos', tags: ['distribuidor'], seccion: 'G' },
  { code: '4653', label: 'Comercio al por mayor de maquinaria y equipo agropecuario', tags: ['distribuidor'], seccion: 'G' },
  { code: '4659', label: 'Comercio al por mayor de otros tipos de maquinaria y equipo', tags: ['distribuidor'], seccion: 'G' },
  { code: '4663', label: 'Comercio al por mayor de materiales de construcción', tags: ['distribuidor', 'construccion'], seccion: 'G' },
  { code: '4664', label: 'Comercio al por mayor de productos químicos', tags: ['distribuidor'], seccion: 'G' },
  { code: '4690', label: 'Comercio al por mayor no especializado', tags: ['distribuidor', 'mixto'], seccion: 'G' },
  { code: '4711', label: 'Comercio al por menor en establecimientos no especializados (víveres)', tags: ['distribuidor'], seccion: 'G' },
  { code: '4719', label: 'Comercio al por menor en otros establecimientos no especializados', tags: ['distribuidor', 'mixto'], seccion: 'G' },
  { code: '4721', label: 'Comercio al por menor de productos agrícolas', tags: ['distribuidor'], seccion: 'G' },
  { code: '4722', label: 'Comercio al por menor de carnes, pescados y mariscos', tags: ['distribuidor'], seccion: 'G' },
  { code: '4724', label: 'Comercio al por menor de bebidas y productos del tabaco', tags: ['distribuidor'], seccion: 'G' },
  { code: '4731', label: 'Comercio al por menor de combustibles', tags: ['distribuidor'], seccion: 'G' },
  { code: '4741', label: 'Comercio al por menor de computadores y software', tags: ['distribuidor'], seccion: 'G' },
  { code: '4751', label: 'Comercio al por menor de productos textiles', tags: ['distribuidor'], seccion: 'G' },
  { code: '4752', label: 'Comercio al por menor de artículos de ferretería y pinturas', tags: ['distribuidor', 'construccion'], seccion: 'G' },
  { code: '4753', label: 'Comercio al por menor de tapices, alfombras y cubrimientos', tags: ['distribuidor'], seccion: 'G' },
  { code: '4754', label: 'Comercio al por menor de electrodomésticos y muebles', tags: ['distribuidor'], seccion: 'G' },
  { code: '4762', label: 'Comercio al por menor de artículos deportivos', tags: ['distribuidor'], seccion: 'G' },
  { code: '4771', label: 'Comercio al por menor de prendas de vestir y accesorios', tags: ['distribuidor'], seccion: 'G' },
  { code: '4772', label: 'Comercio al por menor de calzado y artículos de cuero', tags: ['distribuidor'], seccion: 'G' },
  { code: '4773', label: 'Comercio al por menor de productos farmacéuticos (droguerías)', tags: ['distribuidor'], seccion: 'G' },
  { code: '4774', label: 'Comercio al por menor de productos cosméticos', tags: ['distribuidor'], seccion: 'G' },
  { code: '4775', label: 'Comercio al por menor de productos para mascotas', tags: ['distribuidor'], seccion: 'G' },
  { code: '4791', label: 'Comercio al por menor por internet', tags: ['distribuidor', 'mixto'], seccion: 'G' },

  // ── SECCIÓN H — Transporte y almacenamiento (servicios) ────────────────
  { code: '4921', label: 'Transporte urbano y suburbano de pasajeros', tags: ['servicios'], seccion: 'H' },
  { code: '4923', label: 'Transporte de carga por carretera', tags: ['servicios'], seccion: 'H' },
  { code: '5210', label: 'Almacenamiento y depósito', tags: ['servicios'], seccion: 'H' },
  { code: '5320', label: 'Actividades postales y de mensajería', tags: ['servicios'], seccion: 'H' },

  // ── SECCIÓN I — Alojamiento y comida (servicios) ──────────────────────
  { code: '5511', label: 'Alojamiento en hoteles', tags: ['servicios'], seccion: 'I' },
  { code: '5611', label: 'Restaurantes, cafeterías y servicios móviles de comidas', tags: ['servicios', 'mixto'], seccion: 'I' },
  { code: '5630', label: 'Expendio de bebidas alcohólicas para consumo dentro del establecimiento', tags: ['servicios'], seccion: 'I' },

  // ── SECCIÓN J — Información y comunicaciones (servicios) ──────────────
  { code: '5811', label: 'Edición de libros', tags: ['servicios', 'fabricante'], seccion: 'J' },
  { code: '5820', label: 'Edición de programas de informática (software)', tags: ['servicios'], seccion: 'J' },
  { code: '6110', label: 'Actividades de telecomunicaciones alámbricas', tags: ['servicios'], seccion: 'J' },
  { code: '6201', label: 'Desarrollo de sistemas informáticos y software', tags: ['servicios'], seccion: 'J' },
  { code: '6202', label: 'Consultoría informática y gestión de instalaciones', tags: ['servicios'], seccion: 'J' },
  { code: '6209', label: 'Otras actividades de tecnologías de información', tags: ['servicios'], seccion: 'J' },
  { code: '6311', label: 'Procesamiento de datos y hosting', tags: ['servicios'], seccion: 'J' },

  // ── SECCIÓN K — Financieras y seguros (servicios) ─────────────────────
  { code: '6411', label: 'Banco central', tags: ['servicios'], seccion: 'K' },
  { code: '6810', label: 'Actividades inmobiliarias con bienes propios', tags: ['servicios', 'construccion'], seccion: 'L' },
  { code: '6820', label: 'Actividades inmobiliarias a cambio de retribución', tags: ['servicios'], seccion: 'L' },

  // ── SECCIÓN M — Actividades profesionales y técnicas (servicios) ──────
  { code: '6910', label: 'Actividades jurídicas', tags: ['servicios'], seccion: 'M' },
  { code: '6920', label: 'Actividades de contabilidad, auditoría fiscal', tags: ['servicios'], seccion: 'M' },
  { code: '7010', label: 'Actividades de administración empresarial', tags: ['servicios'], seccion: 'M' },
  { code: '7020', label: 'Consultoría de gestión', tags: ['servicios'], seccion: 'M' },
  { code: '7110', label: 'Actividades de arquitectura e ingeniería', tags: ['servicios', 'construccion'], seccion: 'M' },
  { code: '7310', label: 'Publicidad', tags: ['servicios'], seccion: 'M' },
  { code: '7410', label: 'Actividades especializadas de diseño', tags: ['servicios'], seccion: 'M' },
  { code: '7420', label: 'Actividades de fotografía', tags: ['servicios'], seccion: 'M' },

  // ── SECCIÓN N — Actividades administrativas y de apoyo (servicios) ────
  { code: '7710', label: 'Alquiler de vehículos automotores', tags: ['servicios'], seccion: 'N' },
  { code: '7911', label: 'Actividades de agencias de viajes', tags: ['servicios'], seccion: 'N' },
  { code: '8121', label: 'Limpieza general de edificios', tags: ['servicios'], seccion: 'N' },
  { code: '8211', label: 'Actividades combinadas de servicios administrativos', tags: ['servicios'], seccion: 'N' },
  { code: '8299', label: 'Otras actividades de servicios de apoyo empresarial', tags: ['servicios', 'mixto'], seccion: 'N' },

  // ── SECCIÓN P — Educación (servicios) ─────────────────────────────────
  { code: '8530', label: 'Establecimientos de enseñanza superior', tags: ['servicios'], seccion: 'P' },
  { code: '8551', label: 'Formación para el trabajo', tags: ['servicios'], seccion: 'P' },

  // ── SECCIÓN Q — Salud humana (servicios) ──────────────────────────────
  { code: '8610', label: 'Actividades de hospitales y clínicas', tags: ['servicios'], seccion: 'Q' },
  { code: '8621', label: 'Actividades de la práctica médica general', tags: ['servicios'], seccion: 'Q' },
  { code: '8622', label: 'Actividades de la práctica médica especializada', tags: ['servicios'], seccion: 'Q' },
  { code: '8623', label: 'Actividades de la práctica odontológica', tags: ['servicios'], seccion: 'Q' },

  // ── SECCIÓN R — Entretenimiento ───────────────────────────────────────
  { code: '9311', label: 'Gestión de instalaciones deportivas', tags: ['servicios'], seccion: 'R' },
  { code: '9319', label: 'Otras actividades deportivas', tags: ['servicios'], seccion: 'R' },

  // ── SECCIÓN S — Otras actividades de servicios ────────────────────────
  { code: '9602', label: 'Peluquería y otros tratamientos de belleza', tags: ['servicios'], seccion: 'S' },
  { code: '9609', label: 'Otras actividades de servicios personales n.c.p.', tags: ['servicios', 'mixto'], seccion: 'S' },

  // ── Escape genérico ───────────────────────────────────────────────────
  { code: '0000', label: 'Prefiero no decirlo / no aplica por ahora', tags: ['distribuidor', 'fabricante', 'servicios', 'construccion', 'mixto'], seccion: '—' },
];

export function searchCiiuCodes(query: string, actividad: ActividadTag | null): CiiuCode[] {
  const filtered = actividad
    ? CIIU_CODES.filter(c => c.tags.includes(actividad))
    : CIIU_CODES;

  if (!query.trim()) return filtered;

  const q = query.toLowerCase().trim();
  return filtered.filter(
    c => c.code.includes(q) || c.label.toLowerCase().includes(q),
  );
}

export function findCiiuByCode(code: string): CiiuCode | undefined {
  return CIIU_CODES.find(c => c.code === code);
}
