import React, { useState } from 'react';
import { Github, Star, GitFork, Search, BarChart3 } from 'lucide-react';
import { supabase } from '../utils/supabaseClient';

export const Home: React.FC = () => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    console.log('[Home] handleLogin clicked, initiating GitHub OAuth...');
    try {
      setIsLoggingIn(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
          scopes: 'read:user user:email'
        }
      });
      if (error) {
        console.error('[Home] Supabase OAuth error:', error);
        throw error;
      }
      console.log('[Home] OAuth redirect initiated successfully');
    } catch (error) {
      console.error('[Home] Error logging in:', error);
      setIsLoggingIn(false);
    }
  };

  const features = [
    {
      icon: <Star className="h-6 w-6 text-yellow-500" />,
      title: 'Visualize Stars',
      description: 'Get a clear overview of all your starred repositories in one beautiful dashboard.'
    },
    {
      icon: <GitFork className="h-6 w-6 text-blue-500" />,
      title: 'Track Forks',
      description: 'Keep track of the projects you have forked and monitor their original repositories.'
    },
    {
      icon: <Search className="h-6 w-6 text-green-500" />,
      title: 'Advanced Search',
      description: 'Easily find specific repositories with powerful filtering and search capabilities.'
    },
    {
      icon: <BarChart3 className="h-6 w-6 text-purple-500" />,
      title: 'Analytics',
      description: 'View statistics about languages, top starred repositories, and your activity.'
    }
  ];

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl w-full text-center space-y-8">
        <div className="space-y-4">
          <Github className="mx-auto h-20 w-20 text-gray-900" />
          <h1 className="text-4xl tracking-tight font-extrabold text-gray-900 sm:text-5xl md:text-6xl">
            <span className="block">Manage your GitHub</span>
            <span className="block text-blue-600">Stars & Forks</span>
          </h1>
          <p className="mt-3 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
            A beautiful, modern dashboard to visualize, organize, and search through all your GitHub starred repositories and forks.
          </p>
        </div>

        <div className="mt-10 max-w-sm mx-auto sm:max-w-none sm:flex sm:justify-center">
          <button
            onClick={handleLogin}
            disabled={isLoggingIn}
            className={`w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-gray-900 hover:bg-gray-800 md:py-4 md:text-lg md:px-10 transition-colors ${
              isLoggingIn ? 'opacity-75 cursor-not-allowed' : ''
            }`}
          >
            {isLoggingIn ? (
              <span className="flex items-center">
                <div className="animate-spin mr-3 h-5 w-5 border-b-2 border-white rounded-full"></div>
                Connecting to GitHub...
              </span>
            ) : (
              <span className="flex items-center">
                <Github className="mr-2 h-5 w-5" />
                Sign in with GitHub
              </span>
            )}
          </button>
        </div>

        <div className="mt-24">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, index) => (
              <div key={index} className="pt-6">
                <div className="flow-root bg-white rounded-lg px-6 pb-8 shadow-sm h-full border border-gray-100 hover:shadow-md transition-shadow">
                  <div className="-mt-6">
                    <div>
                      <span className="inline-flex items-center justify-center p-3 bg-gray-50 rounded-md shadow-sm border border-gray-100">
                        {feature.icon}
                      </span>
                    </div>
                    <h3 className="mt-8 text-lg font-medium text-gray-900 tracking-tight">{feature.title}</h3>
                    <p className="mt-5 text-base text-gray-500">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
