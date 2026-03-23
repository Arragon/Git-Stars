import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useDashboardStore, Project } from '../store/useDashboardStore';
import { supabase } from '../utils/supabaseClient';
import { syncGitHubData } from '../utils/github';
import { ProjectCard } from '../components/ProjectCard';
import { Search, Filter, RefreshCw, Star, GitFork, BookMarked, Code, Settings2, Tag, X, Sparkles, Loader2 } from 'lucide-react';
import { AiSettingsModal } from '../components/AiSettingsModal';
import { getTagColor } from '../utils/colors';

import { summarizeProject } from '../utils/ai';
import { useAiConfigStore } from '../store/useAiConfigStore';

export const Dashboard: React.FC = () => {
  const { user } = useAuthStore();
  const {
    projects, setProjects,
    isLoadingData, setIsLoadingData,
    searchQuery, setSearchQuery,
    filterType, setFilterType,
    filterLanguage, setFilterLanguage,
    filterTag, setFilterTag,
    sortBy, setSortBy,
    sortOrder, setSortOrder
  } = useDashboardStore();
  const { isConfigured } = useAiConfigStore();
  
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [isAutoSummarizing, setIsAutoSummarizing] = useState(false);
  const [summarizeProgress, setSummarizeProgress] = useState({ current: 0, total: 0 });
  
  // Use a ref to control pausing/stopping the loop from outside
  const stopSummarizeRef = useRef(false);

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
            github_updated_at,
            activity_index,
            activity_details,
            activity_analyzed_at,
            ai_summary,
            ai_tags
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
          starred_at: item.starred_at as string,
          activity_index: (item.projects as any).activity_index,
          activity_details: (item.projects as any).activity_details,
          activity_analyzed_at: (item.projects as any).activity_analyzed_at,
          ai_summary: (item.projects as any).ai_summary,
          ai_tags: (item.projects as any).ai_tags
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

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    projects.forEach(p => {
      if (p.ai_tags && Array.isArray(p.ai_tags)) {
        p.ai_tags.forEach(tag => {
          if (tag && typeof tag === 'string') {
            tags.add(tag);
          }
        });
      }
    });
    return Array.from(tags).sort();
  }, [projects]);

  const handleAutoSummarize = async (forceAll: boolean = false) => {
    // If already running, treat click as PAUSE
    if (isAutoSummarizing) {
      stopSummarizeRef.current = true;
      return;
    }

    if (!isConfigured()) {
      alert('Please configure AI settings first to use Auto Summarize.');
      setIsAiSettingsOpen(true);
      return;
    }

    const projectsToSummarize = forceAll ? projects : projects.filter(p => !p.ai_summary);
    
    if (projectsToSummarize.length === 0) {
      alert('All projects already have summaries!');
      return;
    }

    // Only ask for confirmation if starting fresh (not resuming a previously paused session that we just clicked)
    if (summarizeProgress.total === 0 || summarizeProgress.current === summarizeProgress.total || forceAll) {
       const msg = forceAll 
         ? `Are you sure you want to RE-SUMMARIZE ALL ${projectsToSummarize.length} projects? This will overwrite existing summaries and tags and consume API tokens.`
         : `Are you sure you want to automatically summarize ${projectsToSummarize.length} projects? You can pause at any time by clicking the button again.`;
         
       if (!confirm(msg)) {
         return;
       }
    }

    setIsAutoSummarizing(true);
    stopSummarizeRef.current = false;
    
    // We update total to be the number of currently unsummarized
    setSummarizeProgress({ current: 0, total: projectsToSummarize.length });

    // If forcing all, we start with a clean slate of tags to allow the AI to generate better ones
    const allExistingTags = forceAll ? [] : Array.from(new Set(
      projects.flatMap(p => p.ai_tags || [])
    ));

    let successCount = 0;
    let stoppedByUser = false;
    
    // Process sequentially to respect rate limits
    for (let i = 0; i < projectsToSummarize.length; i++) {
      // Check ref on every iteration to see if user requested a pause
      if (stopSummarizeRef.current) {
        stoppedByUser = true;
        break;
      }

      const project = projectsToSummarize[i];
      setSummarizeProgress({ current: i + 1, total: projectsToSummarize.length });
      
      try {
        // Mark project as currently summarizing in global state
        setProjects(useDashboardStore.getState().projects.map(p => 
          p.id === project.id ? { ...p, is_summarizing: true } : p
        ));

        // Use a small local timeout check within the loop to allow UI to render the loading state
        await new Promise(resolve => setTimeout(resolve, 50));

        // Double check pause right before the heavy API call
        if (stopSummarizeRef.current) {
           // Revert loading state if we paused exactly here
           setProjects(useDashboardStore.getState().projects.map(p => 
             p.id === project.id ? { ...p, is_summarizing: false } : p
           ));
           stoppedByUser = true;
           break;
        }

        const result = await summarizeProject(
          project.name, 
          project.description, 
          project.language,
          allExistingTags
        );
        
        // Save to database
        await supabase.from('projects').update({
          ai_summary: result.summary,
          ai_tags: result.tags
        }).eq('id', project.id);

        // Add new tags to our context for the next iteration
        result.tags.forEach(tag => {
          if (!allExistingTags.includes(tag)) allExistingTags.push(tag);
        });

        // Update local state incrementally so UI reflects progress immediately
        // Use functional state update to ensure we always have the freshest state
        setProjects(useDashboardStore.getState().projects.map(p => 
          p.id === project.id 
            ? { ...p, ai_summary: result.summary, ai_tags: result.tags, is_summarizing: false } 
            : p
        ));
        
        successCount++;

        // Add a small delay between requests to avoid hitting API rate limits too quickly
        if (i < projectsToSummarize.length - 1 && !stopSummarizeRef.current) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Failed to summarize ${project.name}:`, error);
        // Clear summarizing flag on error
        setProjects(useDashboardStore.getState().projects.map(p => 
          p.id === project.id ? { ...p, is_summarizing: false } : p
        ));
        // Continue with the next project even if one fails unless stopped
      }
    }

    setIsAutoSummarizing(false);
    
    if (stoppedByUser) {
       console.log(`Auto summarize paused. Processed ${successCount} projects this run.`);
    } else {
       alert(`Auto summarize complete! Successfully processed ${successCount} projects.`);
       setSummarizeProgress({ current: 0, total: 0 }); // reset on full completion
    }
  };

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
    // We must ensure we're filtering on the most up-to-date state
    return projects
        .filter(p => {
          // 1. Tag Filtering (STRICT MATCH)
          if (filterTag && filterTag !== 'all' && filterTag.trim() !== '') {
            const currentTags = p.ai_tags;
            // Defensive check: ensure it's a real array and has the exact string
            if (!currentTags || !Array.isArray(currentTags)) {
              return false;
            }
            // Strict exact match check
            if (!currentTags.some(t => typeof t === 'string' && t.trim() === filterTag.trim())) {
              return false;
            }
          }

          // 2. Type Filtering
          if (filterType && filterType !== 'all' && p.type !== filterType) {
            return false;
          }

          // 3. Language Filtering
          if (filterLanguage && filterLanguage !== 'all' && p.language !== filterLanguage) {
            return false;
          }

          // 4. Search Filtering
          if (searchQuery) {
            const searchLower = searchQuery.toLowerCase();
            const matchesSearch = p.name.toLowerCase().includes(searchLower) || 
                                  (p.full_name && p.full_name.toLowerCase().includes(searchLower)) ||
                                  (p.description && p.description.toLowerCase().includes(searchLower)) ||
                                  (p.ai_summary && p.ai_summary.toLowerCase().includes(searchLower));
            if (!matchesSearch) {
              return false;
            }
          }
          
          return true;
        })
      .sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'name') {
          comparison = a.name.localeCompare(b.name);
        } else if (sortBy === 'stars_count') {
          comparison = a.stars_count - b.stars_count;
        } else if (sortBy === 'activity') {
          comparison = (a.activity_index || 0) - (b.activity_index || 0);
        } else if (sortBy === 'starred_at') {
          const dateA = new Date(a.starred_at || a.github_created_at || 0).getTime();
          const dateB = new Date(b.starred_at || b.github_created_at || 0).getTime();
          comparison = dateA - dateB;
        }
        
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [projects, searchQuery, filterType, filterLanguage, sortBy, sortOrder]);

  return (
    <div className="flex h-[calc(100vh-64px)] w-full overflow-hidden">
      {/* Sidebar Filters */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-gray-50/50 p-6 overflow-y-auto hidden md:block">
        <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center">
          <Filter className="w-5 h-5 mr-2 text-gray-500" />
          Filters
        </h2>
        
        <div className="space-y-8">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">Search</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="block w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md leading-5 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-shadow"
                placeholder="Find repositories..."
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">Type</label>
            <div className="flex bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setFilterType('all')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${filterType === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                All
              </button>
              <button
                onClick={() => setFilterType('star')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${filterType === 'star' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Stars
              </button>
              <button
                onClick={() => setFilterType('fork')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${filterType === 'fork' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Forks
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">Language</label>
            <select
              value={filterLanguage}
              onChange={(e) => setFilterLanguage(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md bg-white cursor-pointer"
            >
              <option value="all">All Languages</option>
              {languages.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-semibold text-gray-700">AI Tags</label>
              {(filterTag !== 'all' && filterTag !== '') && (
                <button 
                  onClick={() => setFilterTag('all')}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {allTags.map(tag => {
                const colors = getTagColor(tag);
                const isSelected = filterTag === tag;
                return (
                  <button
                    key={tag}
                    onClick={() => setFilterTag(isSelected ? 'all' : tag)}
                    className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                      isSelected 
                        ? `${colors.bg} border-blue-400 ${colors.text} ring-1 ring-blue-400` 
                        : `bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300`
                    }`}
                  >
                    <Tag className={`w-3 h-3 mr-1 ${isSelected ? colors.text : 'text-gray-400'}`} />
                    {tag}
                  </button>
                );
              })}
              {allTags.length === 0 && (
                <span className="text-sm text-gray-400 italic">No tags generated yet.</span>
              )}
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">Sort By</label>
            <div className="space-y-3">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'starred_at' | 'stars_count' | 'name' | 'activity')}
                className="block w-full pl-3 pr-10 py-2 text-base border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md bg-white cursor-pointer"
              >
                <option value="starred_at">Date Added</option>
                <option value="stars_count">Stars Count</option>
                <option value="activity">Activity Index</option>
                <option value="name">Name</option>
              </select>
              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="w-full flex justify-between items-center px-4 py-2 border border-gray-200 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              >
                <span>{sortOrder === 'asc' ? 'Ascending' : 'Descending'}</span>
                <Filter className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${sortOrder === 'desc' ? 'transform rotate-180' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="p-6 md:p-8 lg:p-10 w-full mx-auto space-y-8">
          {/* Header Row */}
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
            <div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Dashboard</h1>
              <p className="text-base text-gray-500 mt-1">Welcome back, <span className="font-medium text-gray-700">{user?.user_metadata.preferred_username}</span></p>
            </div>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full lg:w-auto">
              {/* Compact Stats */}
              <div className="flex items-center space-x-5 text-sm text-gray-600 bg-gray-50/80 px-5 py-2.5 rounded-xl border border-gray-100 shadow-sm">
                <div className="flex items-center" title="Total Repositories">
                  <BookMarked className="w-4 h-4 mr-2 text-gray-400" />
                  <span className="font-bold text-gray-900 text-base">{stats.total}</span>
                </div>
                <div className="w-px h-5 bg-gray-200"></div>
                <div className="flex items-center" title="Stars">
                  <Star className="w-4 h-4 mr-2 text-yellow-500" />
                  <span className="font-bold text-gray-900 text-base">{stats.stars}</span>
                </div>
                <div className="w-px h-5 bg-gray-200"></div>
                <div className="flex items-center" title="Forks">
                  <GitFork className="w-4 h-4 mr-2 text-blue-500" />
                  <span className="font-bold text-gray-900 text-base">{stats.forks}</span>
                </div>
              </div>

              <div className="flex gap-3 relative group">
                <div className="flex rounded-lg shadow-sm">
                  <button
                    onClick={() => handleAutoSummarize(false)}
                    disabled={isLoadingData}
                    className={`inline-flex items-center px-4 py-2 border rounded-l-lg text-sm font-medium transition-all ${
                      isAutoSummarizing 
                        ? 'border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100 hover:border-orange-300 focus:ring-orange-500 z-10' 
                        : 'border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 hover:border-purple-300 focus:ring-purple-500 z-10'
                    }`}
                    title={isAutoSummarizing ? "Pause automatic summarization" : "Automatically summarize all projects without a summary"}
                  >
                    {isAutoSummarizing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        <span>Pause ({summarizeProgress.current}/{summarizeProgress.total})</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        <span className="hidden sm:inline">
                          {summarizeProgress.total > 0 && summarizeProgress.current < summarizeProgress.total 
                            ? `Resume Auto Summarize` 
                            : `Auto Summarize`}
                        </span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      if (!isAutoSummarizing) {
                        handleAutoSummarize(true);
                      }
                    }}
                    disabled={isAutoSummarizing || isLoadingData}
                    className={`inline-flex items-center px-2 py-2 border-y border-r rounded-r-lg text-sm font-medium transition-all border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 hover:border-purple-300 focus:ring-purple-500 focus:z-10 ${
                      isAutoSummarizing ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    title="Force re-summarize ALL projects (overwrites existing)"
                  >
                    <span className="sr-only">Summarize All</span>
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
                <button
                  onClick={() => setIsAiSettingsOpen(true)}
                  className="inline-flex items-center px-4 py-2 border border-gray-200 rounded-lg shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all"
                  title="AI Configuration"
                >
                  <Settings2 className="h-4 w-4 text-gray-500 sm:mr-2" />
                  <span className="hidden sm:inline">AI Settings</span>
                </button>
                <button
                  onClick={handleSync}
                  disabled={isSyncing}
                  className={`inline-flex items-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 transition-all ${
                    isSyncing ? 'opacity-75 cursor-not-allowed' : ''
                  }`}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Syncing...' : 'Sync Data'}
                </button>
              </div>
            </div>
          </div>

          {/* Active Filters Display (Mobile only or when tags are active) */}
          {(filterTag !== 'all' && filterTag !== '' || filterType !== 'all' || filterLanguage !== 'all' || searchQuery) && (
            <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-gray-100">
              <span className="text-sm font-medium text-gray-500 mr-2">Active filters:</span>
              
              {searchQuery && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700">
                  Search: "{searchQuery}"
                  <button onClick={() => setSearchQuery('')} className="ml-1.5 text-gray-400 hover:text-gray-600"><X className="w-3 h-3" /></button>
                </span>
              )}
              
              {filterType !== 'all' && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700">
                  Type: {filterType}
                  <button onClick={() => setFilterType('all')} className="ml-1.5 text-blue-400 hover:text-blue-600"><X className="w-3 h-3" /></button>
                </span>
              )}

              {filterLanguage !== 'all' && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-green-50 text-green-700">
                  Lang: {filterLanguage}
                  <button onClick={() => setFilterLanguage('all')} className="ml-1.5 text-green-400 hover:text-green-600"><X className="w-3 h-3" /></button>
                </span>
              )}

              {(filterTag !== 'all' && filterTag !== '') && (() => {
                const colors = getTagColor(filterTag);
                return (
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${colors.bg} ${colors.text} ring-1 ring-inset ${colors.border}`}>
                    Tag: {filterTag}
                    <button onClick={() => setFilterTag('all')} className={`ml-1.5 ${colors.text} hover:opacity-75`}><X className="w-3 h-3" /></button>
                  </span>
                );
              })()}
            </div>
          )}

          {/* Project Grid */}
          {isLoadingData ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            </div>
          ) : filteredAndSortedProjects.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
              {filteredAndSortedProjects.map(project => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-gray-50 rounded-2xl border border-gray-200 border-dashed">
              <div className="mx-auto w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                <BookMarked className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900">No repositories found</h3>
              <p className="mt-2 text-sm text-gray-500 max-w-sm mx-auto">
                {projects.length === 0 
                  ? "You haven't synced your data yet or you don't have any stars/forks on GitHub."
                  : "We couldn't find anything matching your current search and filter criteria."}
              </p>
              {projects.length === 0 && (
                <div className="mt-8">
                  <button
                    onClick={handleSync}
                    className="inline-flex items-center px-5 py-2.5 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-gray-900 hover:bg-gray-800 transition-colors"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync Data Now
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <AiSettingsModal isOpen={isAiSettingsOpen} onClose={() => setIsAiSettingsOpen(false)} />
    </div>
  );
};
