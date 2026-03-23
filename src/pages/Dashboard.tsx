import React, { useEffect, useState, useMemo } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useDashboardStore, Project } from '../store/useDashboardStore';
import { supabase } from '../utils/supabaseClient';
import { syncGitHubData } from '../utils/github';
import { ProjectCard } from '../components/ProjectCard';
import { Search, Filter, RefreshCw, Star, GitFork, BookMarked, Code } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const { user } = useAuthStore();
  const {
    projects, setProjects,
    isLoadingData, setIsLoadingData,
    searchQuery, setSearchQuery,
    filterType, setFilterType,
    filterLanguage, setFilterLanguage,
    sortBy, setSortBy,
    sortOrder, setSortOrder
  } = useDashboardStore();
  
  const [isSyncing, setIsSyncing] = useState(false);

  const loadProjects = async () => {
    console.log('[Dashboard] Attempting to load projects from DB for user:', user?.id);
    if (!user) {
      console.log('[Dashboard] No user found, skipping project load');
      return;
    }
    
    setIsLoadingData(true);
    try {
      console.log('[Dashboard] Executing Supabase query to fetch user_projects...');
      const { data, error } = await supabase
        .from('user_projects')
        .select(`
          type,
          starred_at,
          projects (
            id,
            github_id,
            name,
            full_name,
            description,
            language,
            stars_count,
            forks_count,
            html_url,
            github_created_at,
            github_updated_at
          )
        `)
        .eq('user_id', user.id);

      if (error) {
        console.error('[Dashboard] Supabase query error:', error);
        throw error;
      }

      if (data) {
        console.log(`[Dashboard] Query successful, retrieved ${data.length} records`);
        const formattedProjects: Project[] = data.map((item: Record<string, unknown>) => ({
          ...(item.projects as Project),
          type: item.type as 'star' | 'fork',
          starred_at: item.starred_at as string
        }));
        setProjects(formattedProjects);
        
        // If no data, try to sync automatically
        if (formattedProjects.length === 0) {
          console.log('[Dashboard] No projects found in DB, initiating auto-sync...');
          handleSync(true);
        } else {
          console.log('[Dashboard] Projects loaded and formatted successfully');
        }
      }
    } catch (error) {
      console.error('[Dashboard] Error in loadProjects:', error);
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleSync = async (isAutoSync: boolean | React.MouseEvent = false) => {
    console.log('[Dashboard] handleSync triggered. isAutoSync:', isAutoSync);
    if (!user) {
      console.warn('[Dashboard] Cannot sync: User is null');
      return;
    }
    const isAuto = typeof isAutoSync === 'boolean' ? isAutoSync : false;
    
    setIsSyncing(true);
    
    // Find GitHub identity to get the provider_id
    const githubIdentity = user.identities?.find(id => id.provider === 'github');
    const identityData = githubIdentity?.identity_data || {};
    
    const providerId = user.user_metadata?.provider_id || githubIdentity?.id || identityData.provider_id || user.id;
    const username = user.user_metadata?.preferred_username || user.user_metadata?.user_name || identityData.preferred_username || identityData.user_name || 'unknown';

    console.log('[Dashboard] Sync parameters resolved:', {
      userId: user.id,
      providerId,
      username,
      identityData
    });

    console.log('[Dashboard] Calling syncGitHubData util function...');
    const success = await syncGitHubData(
      user.id, 
      providerId,
      username
    );
    
    console.log('[Dashboard] syncGitHubData returned:', success);
    if (success) {
      console.log('[Dashboard] Sync successful, reloading projects...');
      await loadProjects();
    } else if (!isAuto) {
      console.log('[Dashboard] Sync failed (manual trigger), showing alert to user');
      alert('Failed to sync GitHub data. This is likely due to GitHub API rate limits. Please try again later.');
    } else {
      console.log('[Dashboard] Sync failed (auto trigger), failing silently');
    }
    setIsSyncing(false);
  };

  // Derived data
  const languages = useMemo(() => {
    const langs = new Set<string>();
    projects.forEach(p => {
      if (p.language) langs.add(p.language);
    });
    return Array.from(langs).sort();
  }, [projects]);

  const stats = useMemo(() => {
    return {
      total: projects.length,
      stars: projects.filter(p => p.type === 'star').length,
      forks: projects.filter(p => p.type === 'fork').length,
      languages: languages.length
    };
  }, [projects, languages]);

  // Filter and sort
  const filteredAndSortedProjects = useMemo(() => {
    return projects
      .filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()));
        const matchesType = filterType === 'all' || p.type === filterType;
        const matchesLanguage = filterLanguage === 'all' || p.language === filterLanguage;
        
        return matchesSearch && matchesType && matchesLanguage;
      })
      .sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'name') {
          comparison = a.name.localeCompare(b.name);
        } else if (sortBy === 'stars_count') {
          comparison = a.stars_count - b.stars_count;
        } else if (sortBy === 'starred_at') {
          const dateA = new Date(a.starred_at || a.github_created_at || 0).getTime();
          const dateB = new Date(b.starred_at || b.github_created_at || 0).getTime();
          comparison = dateA - dateB;
        }
        
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [projects, searchQuery, filterType, filterLanguage, sortBy, sortOrder]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Welcome back, {user?.user_metadata.preferred_username}</p>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className={`inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 ${
            isSyncing ? 'opacity-75 cursor-not-allowed' : ''
          }`}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing...' : 'Sync GitHub Data'}
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white overflow-hidden shadow-sm rounded-lg border border-gray-200">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <BookMarked className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Repositories</dt>
                  <dd className="text-2xl font-semibold text-gray-900">{stats.total}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white overflow-hidden shadow-sm rounded-lg border border-gray-200">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Star className="h-6 w-6 text-yellow-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Stars</dt>
                  <dd className="text-2xl font-semibold text-gray-900">{stats.stars}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white overflow-hidden shadow-sm rounded-lg border border-gray-200">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <GitFork className="h-6 w-6 text-blue-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Forks</dt>
                  <dd className="text-2xl font-semibold text-gray-900">{stats.forks}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white overflow-hidden shadow-sm rounded-lg border border-gray-200">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Code className="h-6 w-6 text-green-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Languages</dt>
                  <dd className="text-2xl font-semibold text-gray-900">{stats.languages}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-gray-900 focus:border-gray-900 sm:text-sm"
              placeholder="Search repositories..."
            />
          </div>
          
          <div className="flex flex-wrap gap-2">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as 'all' | 'star' | 'fork')}
              className="block w-full md:w-auto pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-gray-900 focus:border-gray-900 sm:text-sm rounded-md"
            >
              <option value="all">All Types</option>
              <option value="star">Stars Only</option>
              <option value="fork">Forks Only</option>
            </select>
            
            <select
              value={filterLanguage}
              onChange={(e) => setFilterLanguage(e.target.value)}
              className="block w-full md:w-auto pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-gray-900 focus:border-gray-900 sm:text-sm rounded-md"
            >
              <option value="all">All Languages</option>
              {languages.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'starred_at' | 'stars_count' | 'name')}
              className="block w-full md:w-auto pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-gray-900 focus:border-gray-900 sm:text-sm rounded-md"
            >
              <option value="starred_at">Date Added</option>
              <option value="stars_count">Stars Count</option>
              <option value="name">Name</option>
            </select>

            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900"
            >
              <Filter className={`h-4 w-4 mr-2 ${sortOrder === 'desc' ? 'transform rotate-180' : ''}`} />
              {sortOrder === 'asc' ? 'Asc' : 'Desc'}
            </button>
          </div>
        </div>
      </div>

      {/* Project Grid */}
      {isLoadingData ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
        </div>
      ) : filteredAndSortedProjects.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredAndSortedProjects.map(project => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200 shadow-sm">
          <BookMarked className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No repositories found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {projects.length === 0 
              ? "You haven't synced your data yet or you don't have any stars/forks."
              : "Try adjusting your search or filter settings."}
          </p>
          {projects.length === 0 && (
            <div className="mt-6">
              <button
                onClick={handleSync}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-gray-900 hover:bg-gray-800"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync Now
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
