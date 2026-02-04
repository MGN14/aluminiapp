import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, Send, Mail, MessageSquare, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import Footer from '@/components/layout/Footer';
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';

const contactSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(100, 'Nombre muy largo'),
  email: z.string().trim().email('Correo electrónico inválido').max(255, 'Email muy largo'),
  message: z.string().trim().min(10, 'El mensaje debe tener al menos 10 caracteres').max(1000, 'Mensaje muy largo'),
});

export default function Contact() {
  const [formData, setFormData] = useState({ name: '', email: '', message: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = contactSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0] as string] = err.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('send-contact', {
        body: {
          name: result.data.name,
          email: result.data.email,
          message: result.data.message,
        },
      });

      if (error) {
        setErrors({ message: 'Error al enviar el mensaje. Por favor intenta de nuevo.' });
        setLoading(false);
        return;
      }

      setSuccess(true);
    } catch {
      setErrors({ message: 'Error de conexión. Por favor intenta de nuevo.' });
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4 py-16">
          <Card className="max-w-md w-full text-center">
            <CardContent className="pt-8 pb-8">
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-success" />
              </div>
              <h2 className="text-xl font-semibold mb-2">¡Mensaje enviado!</h2>
              <p className="text-muted-foreground mb-6">
                Gracias por contactarnos. Te responderemos lo antes posible.
              </p>
              <Link to="/">
                <Button variant="outline">Volver al inicio</Button>
              </Link>
            </CardContent>
          </Card>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 py-16">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              ¿Cómo podemos ayudarte?
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Estamos aquí para responder tus preguntas y escuchar tus sugerencias.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-10">
            {/* Contact Info */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="w-5 h-5 text-accent" />
                    Correo electrónico
                  </CardTitle>
                  <CardDescription>
                    Para consultas generales o soporte técnico
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <a 
                    href="mailto:soporte@aluminia.app" 
                    className="text-primary hover:underline font-medium"
                  >
                    soporte@aluminia.app
                  </a>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-accent" />
                    Tiempo de respuesta
                  </CardTitle>
                  <CardDescription>
                    Respondemos en horario laboral colombiano
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-sm">
                    Normalmente respondemos en menos de 24 horas hábiles. 
                    Para usuarios con plan Pro, ofrecemos soporte prioritario.
                  </p>
                </CardContent>
              </Card>

              <div className="bg-accent/10 rounded-lg p-4 border border-accent/20">
                <p className="text-sm text-muted-foreground">
                  💡 <strong>Tip:</strong> Para reportar errores en el procesamiento de PDFs, 
                  incluye el nombre del extracto y la fecha aproximada del problema.
                </p>
              </div>
            </div>

            {/* Contact Form */}
            <Card>
              <CardHeader>
                <CardTitle>Envíanos un mensaje</CardTitle>
                <CardDescription>
                  Completa el formulario y te responderemos pronto
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nombre</Label>
                    <Input
                      id="name"
                      placeholder="Tu nombre"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className={errors.name ? 'border-destructive' : ''}
                    />
                    {errors.name && (
                      <p className="text-xs text-destructive">{errors.name}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Correo electrónico</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="tu@email.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className={errors.email ? 'border-destructive' : ''}
                    />
                    {errors.email && (
                      <p className="text-xs text-destructive">{errors.email}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="message">Mensaje</Label>
                    <Textarea
                      id="message"
                      placeholder="¿En qué podemos ayudarte?"
                      rows={5}
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      className={errors.message ? 'border-destructive' : ''}
                    />
                    {errors.message && (
                      <p className="text-xs text-destructive">{errors.message}</p>
                    )}
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Enviar mensaje
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold text-foreground">AluminIA</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/login">
            <Button variant="ghost" size="sm">Iniciar Sesión</Button>
          </Link>
          <Link to="/signup">
            <Button size="sm">Crear Cuenta</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
