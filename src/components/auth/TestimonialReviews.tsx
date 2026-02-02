import { Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface Testimonial {
  id: string;
  name: string;
  role: string;
  rating: number;
  comment: string;
}

// Mock data - ready to be replaced with real data from database
const mockTestimonials: Testimonial[] = [
  {
    id: '1',
    name: 'María G.',
    role: 'Gerente - Distribuidora',
    rating: 5,
    comment: 'En 5 minutos ya entiendo cuánto entra y cuánto sale. Antes era puro desorden.',
  },
  {
    id: '2',
    name: 'Carlos P.',
    role: 'Dueño PyME',
    rating: 4,
    comment: 'Me gustó exportar a Excel y revisar pendientes por conciliar.',
  },
  {
    id: '3',
    name: 'Andrea L.',
    role: 'Contadora - Consultora',
    rating: 5,
    comment: 'La interfaz es simple, justo lo que necesitaba para el día a día.',
  },
  {
    id: '4',
    name: 'Roberto M.',
    role: 'Director Financiero',
    rating: 5,
    comment: 'Automatizó el proceso de clasificación de transacciones. Ahorro horas cada semana.',
  },
];

interface TestimonialReviewsProps {
  testimonials?: Testimonial[];
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`w-4 h-4 ${
            star <= rating
              ? 'text-yellow-500 fill-yellow-500'
              : 'text-muted-foreground/30'
          }`}
        />
      ))}
    </div>
  );
}

export default function TestimonialReviews({ testimonials = mockTestimonials }: TestimonialReviewsProps) {
  const averageRating = (
    testimonials.reduce((acc, t) => acc + t.rating, 0) / testimonials.length
  ).toFixed(1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-foreground">
          Lo que dicen nuestros usuarios
        </h3>
        <Badge variant="secondary" className="text-xs">
          Demo
        </Badge>
      </div>
      
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <StarRating rating={Math.round(Number(averageRating))} />
        <span>{averageRating} promedio</span>
      </div>

      <div className="space-y-3">
        {testimonials.map((testimonial) => (
          <div
            key={testimonial.id}
            className="p-4 rounded-lg bg-card border border-border"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="font-medium text-foreground text-sm">
                  {testimonial.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {testimonial.role}
                </p>
              </div>
              <StarRating rating={testimonial.rating} />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              "{testimonial.comment}"
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
