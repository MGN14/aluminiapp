import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PDFUploader from '@/components/PDFUploader';
import TransactionTable from '@/components/TransactionTable';
import { FileSpreadsheet, LogOut, Download, FileText, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

interface Transaction {
  id: string;
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  category: string | null;
}

interface Statement {
  id: string;
  file_name: string;
  uploaded_at: string;
  processed: boolean;
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [selectedStatement, setSelectedStatement] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchStatements();
  }, []);

  useEffect(() => {
    if (selectedStatement) {
      fetchTransactions(selectedStatement);
    }
  }, [selectedStatement]);

  const fetchStatements = async () => {
    try {
      const { data, error } = await supabase
        .from('bank_statements')
        .select('*')
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      setStatements(data || []);
      
      if (data && data.length > 0) {
        setSelectedStatement(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching statements:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactions = async (statementId: string) => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('statement_id', statementId)
        .order('date', { ascending: false });

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  const handleUploadComplete = async (statementId: string) => {
    setProcessing(true);
    toast({
      title: 'Procesando extracto',
      description: 'Estamos extrayendo las transacciones del PDF...',
    });

    // Simulate processing (in real app, this would call an edge function)
    // For MVP, we'll add sample transactions to demonstrate the flow
    try {
      const sampleTransactions = [
        { date: '2024-01-15', description: 'TRANSFERENCIA RECIBIDA CLIENTE ABC', debit: null, credit: 5500000, balance: 12500000 },
        { date: '2024-01-14', description: 'PAGO PROVEEDOR XYZ SAS', debit: 2300000, credit: null, balance: 7000000 },
        { date: '2024-01-12', description: 'NOMINA ENERO 2024', debit: 4500000, credit: null, balance: 9300000 },
        { date: '2024-01-10', description: 'PAGO SERVICIOS PUBLICOS', debit: 850000, credit: null, balance: 13800000 },
        { date: '2024-01-08', description: 'TRANSFERENCIA RECIBIDA VENTA #1234', debit: null, credit: 3200000, balance: 14650000 },
        { date: '2024-01-05', description: 'PAGO ARRIENDO LOCAL COMERCIAL', debit: 2800000, credit: null, balance: 11450000 },
        { date: '2024-01-03', description: 'COMISION BANCARIA', debit: 45000, credit: null, balance: 14250000 },
        { date: '2024-01-02', description: 'TRANSFERENCIA RECIBIDA FACTURA #567', debit: null, credit: 8900000, balance: 14295000 },
      ];

      for (const tx of sampleTransactions) {
        await supabase.from('transactions').insert({
          user_id: user!.id,
          statement_id: statementId,
          ...tx,
        });
      }

      await supabase
        .from('bank_statements')
        .update({ processed: true })
        .eq('id', statementId);

      setSelectedStatement(statementId);
      await fetchStatements();
      await fetchTransactions(statementId);

      toast({
        title: '¡Extracto procesado!',
        description: 'Las transacciones están listas para revisar.',
      });
    } catch (error) {
      console.error('Processing error:', error);
      toast({
        title: 'Error al procesar',
        description: 'Hubo un problema procesando el extracto.',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleExport = () => {
    if (transactions.length === 0) {
      toast({
        title: 'Sin datos',
        description: 'No hay transacciones para exportar.',
        variant: 'destructive',
      });
      return;
    }

    const exportData = transactions.map(tx => ({
      Fecha: tx.date,
      Descripción: tx.description,
      Débito: tx.debit || '',
      Crédito: tx.credit || '',
      Saldo: tx.balance || '',
      Categoría: tx.category || '',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transacciones');
    
    const fileName = `transacciones_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);

    toast({
      title: 'Exportación exitosa',
      description: `Archivo ${fileName} descargado.`,
    });
  };

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">AluminIA</span>
          </div>
          
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Upload Section */}
          <section className="animate-fade-in">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              Bienvenido a AluminIA
            </h1>
            <p className="text-muted-foreground mb-6">
              Sube tu extracto bancario de Bancolombia para extraer y organizar tus transacciones.
            </p>
            <PDFUploader onUploadComplete={handleUploadComplete} />
          </section>

          {/* Statements List */}
          {statements.length > 0 && (
            <section className="animate-slide-up">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">
                  Extractos cargados
                </h2>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {statements.map((statement) => (
                  <button
                    key={statement.id}
                    onClick={() => setSelectedStatement(statement.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all whitespace-nowrap ${
                      selectedStatement === statement.id
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border bg-card hover:border-accent/50'
                    }`}
                  >
                    <FileText className="h-4 w-4" />
                    <span className="text-sm font-medium">{statement.file_name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Transactions Section */}
          {selectedStatement && (
            <section className="animate-slide-up">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-4">
                  <CardTitle className="text-lg">Transacciones</CardTitle>
                  <Button 
                    onClick={handleExport} 
                    disabled={transactions.length === 0}
                    size="sm"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Exportar Excel
                  </Button>
                </CardHeader>
                <CardContent>
                  {processing ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-accent" />
                      <span className="ml-3 text-muted-foreground">Procesando extracto...</span>
                    </div>
                  ) : (
                    <TransactionTable 
                      transactions={transactions} 
                      onTransactionUpdate={() => fetchTransactions(selectedStatement)}
                    />
                  )}
                </CardContent>
              </Card>
            </section>
          )}

          {/* Empty State */}
          {!loading && statements.length === 0 && (
            <Card className="animate-fade-in">
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  No tienes extractos aún
                </h3>
                <p className="text-muted-foreground">
                  Sube tu primer extracto de Bancolombia para comenzar a organizar tus finanzas.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
