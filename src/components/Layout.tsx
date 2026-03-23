import React, { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Github, LogOut } from 'lucide-react';
import { supabase } from '../utils/supabaseClient';
import { useAuthStore } from '../store/useAuthStore';

export const Layout: React.FC = () => {
  const { user, setUser, isLoading, setIsLoading } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    console.log('[Layout] Setting up auth session and listener...');
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[Layout] Initial getSession result:', session ? 'User logged in' : 'No session');
      setUser(session?.user ?? null);
      setIsLoading(false);
      
      if (!session?.user && location.pathname !== '/') {
        console.log('[Layout] Redirecting to / because no user session found');
        navigate('/');
      } else if (session?.user && location.pathname === '/') {
        console.log('[Layout] Redirecting to /dashboard because user is already logged in');
        navigate('/dashboard');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log(`[Layout] onAuthStateChange event: ${event}, Session present: ${!!session}`);
      setUser(session?.user ?? null);
      if (!session?.user && location.pathname !== '/') {
        navigate('/');
      } else if (session?.user && location.pathname === '/') {
        navigate('/dashboard');
      }
    });

    return () => {
      console.log('[Layout] Cleaning up auth listener');
      subscription.unsubscribe();
    };
  }, [navigate, location.pathname, setUser, setIsLoading]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-gray-900 text-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center cursor-pointer" onClick={() => user ? navigate('/dashboard') : navigate('/')}>
              <Github className="h-8 w-8 text-white" />
              <span className="ml-2 text-xl font-bold">GitStars</span>
            </div>
            
            {user && (
              <div className="flex items-center space-x-4">
                <div className="flex items-center">
                  <img
                    className="h-8 w-8 rounded-full border border-gray-700"
                    src={user.user_metadata.avatar_url}
                    alt={user.user_metadata.full_name || 'User avatar'}
                  />
                  <span className="ml-2 text-sm font-medium hidden sm:block">
                    {user.user_metadata.full_name || user.user_metadata.preferred_username}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
                  title="Logout"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500">
            &copy; {new Date().getFullYear()} GitStars. Visualizing your GitHub stars and forks.
          </p>
        </div>
      </footer>
    </div>
  );
};
