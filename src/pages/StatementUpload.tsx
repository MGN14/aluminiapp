import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/layout/AppLayout';
import PDFUploader from '@/components/PDFUploader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Check, Clock, AlertCircle, Info } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface Statement {
  id: string;
  file_name: string;
  uploaded_at: string;
  processed: boolean;
  processing_error: string | null;
}

export default function StatementUpload() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatements();
  }, []);

  const fetchStatements = async () => {
    try {
      const { data, error } = await supabase
        .from('bank_statements')
        .select('*')
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      setStatements(data || []);
    } catch (error) {
      console.error('Error fetching statements:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadComplete = async (statementId: string) => {
    toast({
      title: 'Extracto subido',
      description: 'El archivo se ha guardado. Cargando transacciones de demo...',
    });

    // For MVP: Insert sample Bancolombia-style transactions
    // In production, this would be replaced by real PDF parsing
    try {
      const sampleTransactions = [
        { 
          date: '2024-01-15', 
          description: 'TRANSFERENCIA RECIBIDA CLIENTE ABC SAS NIT 900123456', 
          amount: 5500000, 
          balance: 25500000,
          sucursal: 'BOGOTA CENTRO',
          dcto: '001234',
          category: 'ventas',
          applies_iva: true, // Income from sales has IVA
        },
        { 
          date: '2024-01-14', 
          description: 'PAGO PROVEEDOR XYZ LTDA FACTURA 4567', 
          amount: -2300000,
          balance: 20000000,
          sucursal: 'VIRTUAL',
          dcto: '002345',
          category: 'proveedores',
          applies_retefuente: true, // Purchase of goods
        },
        { 
          date: '2024-01-13', 
          description: 'COBRO IVA PAGOS AUTOMATICOS', 
          amount: -185000,
          balance: 22300000,
          sucursal: 'VIRTUAL',
          dcto: '',
          category: 'impuestos',
          applies_iva: false, // This IS the IVA payment
        },
        { 
          date: '2024-01-12', 
          description: 'NOMINA ENERO 2024 EMPLEADOS', 
          amount: -4500000,
          balance: 22485000,
          sucursal: 'VIRTUAL',
          dcto: '003456',
          category: 'nomina',
        },
        { 
          date: '2024-01-10', 
          description: 'PAGO SERVICIOS PUBLICOS EPM', 
          amount: -850000,
          balance: 26985000,
          sucursal: 'BOGOTA NORTE',
          dcto: '004567',
          category: 'servicios',
        },
        { 
          date: '2024-01-08', 
          description: 'TRANSFERENCIA RECIBIDA VENTA MERCANCIA FACT 1234', 
          amount: 3200000,
          balance: 27835000,
          sucursal: 'VIRTUAL',
          dcto: '005678',
          category: 'ventas',
          applies_iva: true,
        },
        { 
          date: '2024-01-05', 
          description: 'PAGO ARRIENDO LOCAL COMERCIAL ENERO', 
          amount: -2800000,
          balance: 24635000,
          sucursal: 'BOGOTA CENTRO',
          dcto: '006789',
          category: 'gastos_operativos',
        },
        { 
          date: '2024-01-04', 
          description: 'PAGO PSE IMPUESTO DIAN RETEFUENTE DIC', 
          amount: -145000,
          balance: 27435000,
          sucursal: 'VIRTUAL',
          dcto: '',
          category: 'impuestos',
        },
        { 
          date: '2024-01-03', 
          description: 'COMPRA MATERIALES FERRETERIA NACIONAL', 
          amount: -1200000,
          balance: 27580000,
          sucursal: 'MEDELLIN',
          dcto: '007890',
          category: 'proveedores',
          applies_retefuente: true,
        },
        { 
          date: '2024-01-02', 
          description: 'TRANSFERENCIA RECIBIDA FACTURA #567 CLIENTE DEF', 
          amount: 8900000,
          balance: 28780000,
          sucursal: 'VIRTUAL',
          dcto: '008901',
          category: 'ventas',
          applies_iva: true,
        },
      ];

      for (const tx of sampleTransactions) {
        await supabase.from('transactions').insert({
          user_id: user!.id,
          statement_id: statementId,
          date: tx.date,
          description: tx.description,
          amount: tx.amount,
          debit: tx.amount < 0 ? Math.abs(tx.amount) : null,
          credit: tx.amount > 0 ? tx.amount : null,
          balance: tx.balance,
          category: tx.category || null,
          sucursal: tx.sucursal || null,
          dcto: tx.dcto || null,
          applies_iva: tx.applies_iva || false,
          applies_retefuente: tx.applies_retefuente || false,
          reconciled: false,
        });
      }

      await supabase
        .from('bank_statements')
        .update({ processed: true })
        .eq('id', statementId);

      await fetchStatements();

      toast({
        title: '¡Transacciones cargadas!',
        description: 'Ve a Transacciones para revisarlas y editarlas.',
      });

      setTimeout(() => navigate('/transactions'), 1500);
    } catch (error) {
      console.error('Processing error:', error);
      toast({
        title: 'Error',
        description: 'Hubo un error al procesar el extracto.',
        variant: 'destructive',
      });
    }
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <section className="animate-fade-in">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Subir Extracto Bancario
          </h1>
          <p className="text-muted-foreground mb-6">
            Sube tu extracto bancario de Bancolombia en formato PDF.
          </p>

          <Alert className="mb-6">
            <Info className="h-4 w-4" />
            <AlertTitle>Formato esperado del PDF</AlertTitle>
            <AlertDescription>
              El extracto debe contener la tabla de movimientos con: fecha, descripción, sucursal, dcto, valor y saldo.
              El resumen (saldo anterior, total abonos, total cargos) se usa solo para validación.
            </AlertDescription>
          </Alert>

          <PDFUploader onUploadComplete={handleUploadComplete} />
        </section>

        {statements.length > 0 && (
          <section className="animate-slide-up">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Extractos subidos</CardTitle>
                <CardDescription>
                  Los extractos procesados tienen sus transacciones disponibles para edición
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {statements.map((statement) => (
                    <div
                      key={statement.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-sm">{statement.file_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(statement.uploaded_at), "dd MMM yyyy, HH:mm", { locale: es })}
                          </p>
                        </div>
                      </div>
                      <div>
                        {statement.processing_error ? (
                          <Badge variant="destructive" className="flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Error
                          </Badge>
                        ) : statement.processed ? (
                          <Badge variant="secondary" className="flex items-center gap-1 bg-success/10 text-success">
                            <Check className="h-3 w-3" />
                            Procesado
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Pendiente
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </AppLayout>
  );
}
