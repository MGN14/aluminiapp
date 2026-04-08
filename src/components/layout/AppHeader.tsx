import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { LogOut, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export default function AppHeader() {
  const { user, signOut } = useAuth();
  const [companyInitial, setCompanyInitial] = useState<string | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      try {
        const { data } = await supabase
          .from('profiles')
          .select('company_initial')
          .eq('user_id', user.id)
          .maybeSingle();
        if (data?.company_initial) {
          setCompanyInitial(data.company_initial);
        }
      } catch (error) {
        console.error('Error loading profile:', error);
      }
    };
    loadProfile();
  }, [user]);

  const getAvatarInitial = () => {
    if (companyInitial) return companyInitial;
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name.charAt(0).toUpperCase();
    if (user?.email) return user.email.charAt(0).toUpperCase();
    return 'U';
  };

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4">
      <SidebarTrigger className="h-8 w-8" />

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full h-9 w-9 p-0">
              <Avatar className="h-9 w-9 border-2 border-border hover:border-accent transition-colors">
                <AvatarFallback className="bg-accent/10 text-accent-foreground font-semibold text-sm">
                  {getAvatarInitial()}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-popover">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">Mi cuenta</p>
                <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings" className="cursor-pointer">
                <Settings className="h-4 w-4 mr-2" />
                Ajustes
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="text-destructive cursor-pointer">
              <LogOut className="h-4 w-4 mr-2" />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
