import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useDashboardStore, Project } from '../store/useDashboardStore';
import { supabase } from '../utils/supabaseClient';
import { syncGitHubData } from '../utils/github';
import { ProjectCard } from '../components/ProjectCard';
import { Search, Filter, RefreshCw, Star, GitFork, BookMarked, Settings2, Tag, X, Sparkles, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { AiSettingsModal } from '../components/AiSettingsModal';
import { getTagColor } from '../utils/colors';
import { summarizeProject } from '../utils/ai';
import { useAiConfigStore } from '../store/useAiConfigStore';
import {
  ALL_PROJECTS_COLLECTION_ID,
  Collection,
  CollectionProject,
  GITHUB_STARS_COLLECTION_ID,
  matchProjectToCollection
} from '../utils/collections';

const normalizeCollection = (item: any): Collection => ({
  id: item.id,
  user_id: item.user_id,
  name: item.name,
  description: item.description || '',
  auto_collect_enabled: Boolean(item.auto_collect_enabled),
  created_at: item.created_at,
  updated_at: item.updated_at
});

const normalizeCollectionProject = (item: any): CollectionProject => ({
  id: item.id,
  collection_id: item.collection_id,
  project_id: item.project_id,
  source: item.source === 'auto' ? 'auto' : 'manual',
  reason: item.reason || '',
  created_at: item.created_at,
  updated_at: item.updated_at
});

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
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionProjects, setCollectionProjects] = useState<CollectionProject[]>([]);
  const [isLoadingCollections, setIsLoadingCollections] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState(ALL_PROJECTS_COLLECTION_ID);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDescription, setNewCollectionDescription] = useState('');
  const [isCollectionComposerOpen, setIsCollectionComposerOpen] = useState(false);
  const [isSavingCollection, setIsSavingCollection] = useState(false);
  const [editingCollectionName, setEditingCollectionName] = useState('');
  const [editingCollectionDescription, setEditingCollectionDescription] = useState('');
  const [collectionAutoCollectEnabled, setCollectionAutoCollectEnabled] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [runningAutoCollectionId, setRunningAutoCollectionId] = useState<string | null>(null);

  const stopSummarizeRef = useRef(false);
  const autoCollectBootstrappedRef = useRef(false);

  const mergeCollectionProjects = useCallback((records: CollectionProject[]) => {
    if (records.length === 0) return;

    setCollectionProjects((current) => {
      const next = current.filter((item) => {
        return !records.some((record) => (
          record.collection_id === item.collection_id &&
          record.project_id === item.project_id
        ));
      });

      return [...next, ...records];
    });
  }, []);

  const loadProjects = useCallback(async () => {
    if (!user) {
      setProjects([]);
      return;
    }

    setIsLoadingData(true);
    try {
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

      if (error) throw error;

      const formattedProjects: Project[] = (data || []).map((item: Record<string, unknown>) => ({
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

      if (formattedProjects.length === 0) {
        await handleSync(true);
      }
    } catch (error) {
      console.error('[Dashboard] Error loading projects:', error);
    } finally {
      setIsLoadingData(false);
    }
  }, [setIsLoadingData, setProjects, user]);

  const loadCollections = useCallback(async () => {
    if (!user) {
      setCollections([]);
      setCollectionProjects([]);
      return;
    }

    setIsLoadingCollections(true);
    try {
      const { data, error } = await supabase
        .from('collections')
        .select(`
          id,
          user_id,
          name,
          description,
          auto_collect_enabled,
          created_at,
          updated_at,
          collection_projects (
            id,
            collection_id,
            project_id,
            source,
            reason,
            created_at,
            updated_at
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const nextCollections = (data || []).map((item: any) => normalizeCollection(item));
      const nextCollectionProjects = (data || []).flatMap((item: any) => (
        (item.collection_projects || []).map((project: any) => normalizeCollectionProject(project))
      ));

      setCollections(nextCollections);
      setCollectionProjects(nextCollectionProjects);
    } catch (error) {
      console.error('[Dashboard] Error loading collections:', error);
    } finally {
      setIsLoadingCollections(false);
    }
  }, [user]);

  useEffect(() => {
    autoCollectBootstrappedRef.current = false;

    if (!user) {
      setCollections([]);
      setCollectionProjects([]);
      setSelectedCollectionId(ALL_PROJECTS_COLLECTION_ID);
      return;
    }

    void Promise.all([loadProjects(), loadCollections()]);
  }, [loadCollections, loadProjects, user]);

  const runAutoCollect = useCallback(async (collection: Collection, silent: boolean = false) => {
    setRunningAutoCollectionId(collection.id);

    try {
      const assignedProjectIds = new Set(
        collectionProjects
          .filter((item) => item.collection_id === collection.id)
          .map((item) => item.project_id)
      );

      const payload = [];
      let skippedWithoutAi = 0;

      for (const project of projects) {
        if (assignedProjectIds.has(project.id)) continue;

        const result = matchProjectToCollection(project, collection);
        if (result.score === 0 && (!project.ai_summary && !(project.ai_tags || []).length)) {
          skippedWithoutAi += 1;
        }

        if (result.matched) {
          payload.push({
            collection_id: collection.id,
            project_id: project.id,
            source: 'auto',
            reason: `Score ${result.score}: ${result.reason}`
          });
        }
      }

      if (payload.length === 0) {
        if (!silent) {
          alert(
            skippedWithoutAi > 0
              ? `No matching projects found. ${skippedWithoutAi} project(s) are still missing AI summaries or tags.`
              : 'No matching projects found for this collection.'
          );
        }
        return 0;
      }

      const { data, error } = await supabase
        .from('collection_projects')
        .upsert(payload, { onConflict: 'collection_id,project_id' })
        .select('id, collection_id, project_id, source, reason, created_at, updated_at');

      if (error) throw error;

      mergeCollectionProjects((data || []).map((item: any) => normalizeCollectionProject(item)));

      if (!silent) {
        alert(`Auto collected ${payload.length} project(s) into "${collection.name}".`);
      }

      return payload.length;
    } catch (error) {
      console.error('[Dashboard] Auto collect failed:', error);
      if (!silent) {
        alert('Auto collect failed. Please try again after generating AI summaries.');
      }
      return 0;
    } finally {
      setRunningAutoCollectionId((current) => current === collection.id ? null : current);
    }
  }, [collectionProjects, mergeCollectionProjects, projects]);

  useEffect(() => {
    if (!user || isLoadingData || isLoadingCollections || autoCollectBootstrappedRef.current) {
      return;
    }

    autoCollectBootstrappedRef.current = true;
    const enabledCollections = collections.filter((collection) => collection.auto_collect_enabled);

    if (enabledCollections.length === 0) return;

    void (async () => {
      for (const collection of enabledCollections) {
        await runAutoCollect(collection, true);
      }
    })();
  }, [collections, isLoadingCollections, isLoadingData, runAutoCollect, user]);

  const collectionsById = useMemo(() => {
    return collections.reduce<Record<string, Collection>>((accumulator, collection) => {
      accumulator[collection.id] = collection;
      return accumulator;
    }, {});
  }, [collections]);

  const projectCollectionsMap = useMemo(() => {
    return collectionProjects.reduce<Record<string, Collection[]>>((accumulator, item) => {
      const collection = collectionsById[item.collection_id];
      if (!collection) return accumulator;

      if (!accumulator[item.project_id]) {
        accumulator[item.project_id] = [];
      }

      accumulator[item.project_id].push(collection);
      return accumulator;
    }, {});
  }, [collectionProjects, collectionsById]);

  const collectionCounts = useMemo(() => {
    const counts: Record<string, number> = {
      [ALL_PROJECTS_COLLECTION_ID]: projects.length,
      [GITHUB_STARS_COLLECTION_ID]: projects.filter((project) => project.type === 'star').length
    };

    collectionProjects.forEach((item) => {
      counts[item.collection_id] = (counts[item.collection_id] || 0) + 1;
    });

    return counts;
  }, [collectionProjects, projects]);

  const selectedCollection = useMemo(() => {
    return collections.find((collection) => collection.id === selectedCollectionId) || null;
  }, [collections, selectedCollectionId]);

  useEffect(() => {
    if (!selectedCollection) {
      setEditingCollectionName('');
      setEditingCollectionDescription('');
      setCollectionAutoCollectEnabled(false);
      return;
    }

    setEditingCollectionName(selectedCollection.name);
    setEditingCollectionDescription(selectedCollection.description || '');
    setCollectionAutoCollectEnabled(Boolean(selectedCollection.auto_collect_enabled));
  }, [selectedCollection]);

  useEffect(() => {
    if (
      selectedCollectionId !== ALL_PROJECTS_COLLECTION_ID &&
      selectedCollectionId !== GITHUB_STARS_COLLECTION_ID &&
      !selectedCollection
    ) {
      setSelectedCollectionId(ALL_PROJECTS_COLLECTION_ID);
    }
  }, [selectedCollection, selectedCollectionId]);

  const handleSync = async (isAutoSync: boolean | React.MouseEvent = false) => {
    if (!user) return;

    const isAuto = typeof isAutoSync === 'boolean' ? isAutoSync : false;
    setIsSyncing(true);

    const githubIdentity = user.identities?.find((identity) => identity.provider === 'github');
    const identityData = githubIdentity?.identity_data || {};

    const providerId = user.user_metadata?.provider_id || githubIdentity?.id || identityData.provider_id || user.id;
    const username = user.user_metadata?.preferred_username || user.user_metadata?.user_name || identityData.preferred_username || identityData.user_name || 'unknown';

    const result = await syncGitHubData(user.id, providerId, username);

    if (result.status === 'success') {
      autoCollectBootstrappedRef.current = false;
      await Promise.all([loadProjects(), loadCollections()]);
    } else if (result.status === 'failed' && !isAuto) {
      alert('Failed to sync GitHub data. This is likely due to GitHub API rate limits. Please try again later.');
    }

    setIsSyncing(false);
  };

  const languages = useMemo(() => {
    const langs = new Set<string>();
    projects.forEach((project) => {
      if (project.language) langs.add(project.language);
    });
    return Array.from(langs).sort();
  }, [projects]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    projects.forEach((project) => {
      (project.ai_tags || []).forEach((tag) => {
        if (tag) tags.add(tag);
      });
    });
    return Array.from(tags).sort();
  }, [projects]);

  const handleAutoSummarize = async (forceAll: boolean = false) => {
    if (isAutoSummarizing) {
      stopSummarizeRef.current = true;
      return;
    }

    if (!isConfigured()) {
      alert('Please configure AI settings first to use Auto Summarize.');
      setIsAiSettingsOpen(true);
      return;
    }

    const projectsToSummarize = forceAll ? projects : projects.filter((project) => !project.ai_summary);

    if (projectsToSummarize.length === 0) {
      alert('All projects already have summaries!');
      return;
    }

    if (summarizeProgress.total === 0 || summarizeProgress.current === summarizeProgress.total || forceAll) {
      const message = forceAll
        ? `Are you sure you want to RE-SUMMARIZE ALL ${projectsToSummarize.length} projects? This will overwrite existing summaries and tags and consume API tokens.`
        : `Are you sure you want to automatically summarize ${projectsToSummarize.length} projects? You can pause at any time by clicking the button again.`;

      if (!confirm(message)) {
        return;
      }
    }

    setIsAutoSummarizing(true);
    stopSummarizeRef.current = false;
    setSummarizeProgress({ current: 0, total: projectsToSummarize.length });

    const allExistingTags = forceAll ? [] : Array.from(new Set(projects.flatMap((project) => project.ai_tags || [])));

    let successCount = 0;
    let stoppedByUser = false;

    for (let index = 0; index < projectsToSummarize.length; index++) {
      if (stopSummarizeRef.current) {
        stoppedByUser = true;
        break;
      }

      const project = projectsToSummarize[index];
      setSummarizeProgress({ current: index + 1, total: projectsToSummarize.length });

      try {
        setProjects(useDashboardStore.getState().projects.map((item) => (
          item.id === project.id ? { ...item, is_summarizing: true } : item
        )));

        await new Promise((resolve) => setTimeout(resolve, 50));

        if (stopSummarizeRef.current) {
          setProjects(useDashboardStore.getState().projects.map((item) => (
            item.id === project.id ? { ...item, is_summarizing: false } : item
          )));
          stoppedByUser = true;
          break;
        }

        const result = await summarizeProject(
          project.name,
          project.description,
          project.language,
          allExistingTags
        );

        await supabase
          .from('projects')
          .update({ ai_summary: result.summary, ai_tags: result.tags })
          .eq('id', project.id);

        result.tags.forEach((tag) => {
          if (!allExistingTags.includes(tag)) {
            allExistingTags.push(tag);
          }
        });

        setProjects(useDashboardStore.getState().projects.map((item) => (
          item.id === project.id
            ? { ...item, ai_summary: result.summary, ai_tags: result.tags, is_summarizing: false }
            : item
        )));

        successCount += 1;

        if (index < projectsToSummarize.length - 1 && !stopSummarizeRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Failed to summarize ${project.name}:`, error);
        setProjects(useDashboardStore.getState().projects.map((item) => (
          item.id === project.id ? { ...item, is_summarizing: false } : item
        )));
      }
    }

    setIsAutoSummarizing(false);

    if (stoppedByUser) {
      console.log(`Auto summarize paused. Processed ${successCount} projects this run.`);
      return;
    }

    alert(`Auto summarize complete! Successfully processed ${successCount} projects.`);
    setSummarizeProgress({ current: 0, total: 0 });
  };

  const handleCreateCollection = async () => {
    if (!user) return;

    const trimmedName = newCollectionName.trim();
    if (!trimmedName) {
      alert('Collection name is required.');
      return;
    }

    setIsSavingCollection(true);
    try {
      const { data, error } = await supabase
        .from('collections')
        .insert({
          user_id: user.id,
          name: trimmedName,
          description: newCollectionDescription.trim(),
          auto_collect_enabled: false
        })
        .select('id, user_id, name, description, auto_collect_enabled, created_at, updated_at')
        .single();

      if (error) throw error;

      const nextCollection = normalizeCollection(data);
      setCollections((current) => [...current, nextCollection]);
      setSelectedCollectionId(nextCollection.id);
      setNewCollectionName('');
      setNewCollectionDescription('');
      setIsCollectionComposerOpen(false);
    } catch (error) {
      console.error('[Dashboard] Failed to create collection:', error);
      alert('Failed to create collection. Please try a different name.');
    } finally {
      setIsSavingCollection(false);
    }
  };

  const handleSaveSelectedCollection = async () => {
    if (!selectedCollection) return;

    const trimmedName = editingCollectionName.trim();
    if (!trimmedName) {
      alert('Collection name is required.');
      return;
    }

    setIsSavingCollection(true);
    try {
      const { data, error } = await supabase
        .from('collections')
        .update({
          name: trimmedName,
          description: editingCollectionDescription.trim(),
          auto_collect_enabled: collectionAutoCollectEnabled
        })
        .eq('id', selectedCollection.id)
        .select('id, user_id, name, description, auto_collect_enabled, created_at, updated_at')
        .single();

      if (error) throw error;

      const updatedCollection = normalizeCollection(data);
      setCollections((current) => current.map((collection) => (
        collection.id === updatedCollection.id ? updatedCollection : collection
      )));

      if (updatedCollection.auto_collect_enabled) {
        await runAutoCollect(updatedCollection, true);
      }
    } catch (error) {
      console.error('[Dashboard] Failed to update collection:', error);
      alert('Failed to save collection changes.');
    } finally {
      setIsSavingCollection(false);
    }
  };

  const handleDeleteSelectedCollection = async () => {
    if (!selectedCollection) return;

    if (!confirm(`Delete collection "${selectedCollection.name}"?`)) {
      return;
    }

    setIsSavingCollection(true);
    try {
      const { error } = await supabase
        .from('collections')
        .delete()
        .eq('id', selectedCollection.id);

      if (error) throw error;

      setCollections((current) => current.filter((collection) => collection.id !== selectedCollection.id));
      setCollectionProjects((current) => current.filter((item) => item.collection_id !== selectedCollection.id));
      setSelectedCollectionId(ALL_PROJECTS_COLLECTION_ID);
      setSelectedProjectIds([]);
    } catch (error) {
      console.error('[Dashboard] Failed to delete collection:', error);
      alert('Failed to delete collection.');
    } finally {
      setIsSavingCollection(false);
    }
  };

  const handleToggleProjectCollection = async (projectId: string, collection: Collection, shouldInclude: boolean) => {
    try {
      if (shouldInclude) {
        const { data, error } = await supabase
          .from('collection_projects')
          .upsert({
            collection_id: collection.id,
            project_id: projectId,
            source: 'manual',
            reason: 'Added manually from dashboard'
          }, { onConflict: 'collection_id,project_id' })
          .select('id, collection_id, project_id, source, reason, created_at, updated_at')
          .single();

        if (error) throw error;
        mergeCollectionProjects([normalizeCollectionProject(data)]);
        return;
      }

      const { error } = await supabase
        .from('collection_projects')
        .delete()
        .eq('collection_id', collection.id)
        .eq('project_id', projectId);

      if (error) throw error;

      setCollectionProjects((current) => current.filter((item) => !(
        item.collection_id === collection.id &&
        item.project_id === projectId
      )));
    } catch (error) {
      console.error('[Dashboard] Failed to update collection membership:', error);
      alert('Failed to update collection membership.');
    }
  };

  const handleRemoveFromCurrentCollection = async (projectId: string) => {
    if (!selectedCollection) return;
    await handleToggleProjectCollection(projectId, selectedCollection, false);
    setSelectedProjectIds((current) => current.filter((id) => id !== projectId));
  };

  const projectsInSelectedCollection = useMemo(() => {
    if (selectedCollectionId === ALL_PROJECTS_COLLECTION_ID) {
      return projects;
    }

    if (selectedCollectionId === GITHUB_STARS_COLLECTION_ID) {
      return projects.filter((project) => project.type === 'star');
    }

    const projectIds = new Set(
      collectionProjects
        .filter((item) => item.collection_id === selectedCollectionId)
        .map((item) => item.project_id)
    );

    return projects.filter((project) => projectIds.has(project.id));
  }, [collectionProjects, projects, selectedCollectionId]);

  const filteredAndSortedProjects = useMemo(() => {
    return projectsInSelectedCollection
      .filter((project) => {
        if (filterTag !== 'all' && filterTag.trim() !== '') {
          const currentTags = project.ai_tags || [];
          if (!currentTags.some((tag) => tag.trim() === filterTag.trim())) {
            return false;
          }
        }

        if (filterType !== 'all' && project.type !== filterType) {
          return false;
        }

        if (filterLanguage !== 'all' && project.language !== filterLanguage) {
          return false;
        }

        if (searchQuery) {
          const searchLower = searchQuery.toLowerCase();
          const matchesSearch =
            project.name.toLowerCase().includes(searchLower) ||
            (project.full_name && project.full_name.toLowerCase().includes(searchLower)) ||
            (project.description && project.description.toLowerCase().includes(searchLower)) ||
            (project.ai_summary && project.ai_summary.toLowerCase().includes(searchLower)) ||
            (project.ai_tags || []).some((tag) => tag.toLowerCase().includes(searchLower));

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
        } else {
          const dateA = new Date(a.starred_at || a.github_created_at || 0).getTime();
          const dateB = new Date(b.starred_at || b.github_created_at || 0).getTime();
          comparison = dateA - dateB;
        }

        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [filterLanguage, filterTag, filterType, projectsInSelectedCollection, searchQuery, sortBy, sortOrder]);

  useEffect(() => {
    setSelectedProjectIds((current) => current.filter((id) => (
      filteredAndSortedProjects.some((project) => project.id === id)
    )));
  }, [filteredAndSortedProjects]);

  useEffect(() => {
    setSelectedProjectIds([]);
  }, [selectedCollectionId]);

  const handleToggleSelectedProject = (projectId: string) => {
    setSelectedProjectIds((current) => current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : [...current, projectId]);
  };

  const handleToggleSelectAllVisible = () => {
    const visibleIds = filteredAndSortedProjects.map((project) => project.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedProjectIds.includes(id));

    setSelectedProjectIds(allVisibleSelected ? [] : visibleIds);
  };

  const handleBatchRemoveFromCollection = async () => {
    if (!selectedCollection || selectedProjectIds.length === 0) return;

    if (!confirm(`Remove ${selectedProjectIds.length} project(s) from "${selectedCollection.name}"?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('collection_projects')
        .delete()
        .eq('collection_id', selectedCollection.id)
        .in('project_id', selectedProjectIds);

      if (error) throw error;

      setCollectionProjects((current) => current.filter((item) => !(
        item.collection_id === selectedCollection.id &&
        selectedProjectIds.includes(item.project_id)
      )));
      setSelectedProjectIds([]);
    } catch (error) {
      console.error('[Dashboard] Failed to batch remove projects:', error);
      alert('Failed to remove selected projects from the collection.');
    }
  };

  const stats = useMemo(() => ({
    total: projects.length,
    stars: projects.filter((project) => project.type === 'star').length,
    forks: projects.filter((project) => project.type === 'fork').length,
    languages: languages.length
  }), [languages.length, projects]);

  const isCustomCollectionSelected = Boolean(selectedCollection);
  const activeCollectionLabel = selectedCollection
    ? selectedCollection.name
    : selectedCollectionId === GITHUB_STARS_COLLECTION_ID
      ? 'GitHub Stars'
      : 'All Projects';

  return (
    <div className="flex h-[calc(100vh-64px)] w-full overflow-hidden">
      <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-gray-50/50 p-6 overflow-y-auto hidden md:block">
        <div className="space-y-8">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-gray-900 flex items-center">
                <BookMarked className="w-5 h-5 mr-2 text-gray-500" />
                Collections
              </h2>
              <button
                type="button"
                onClick={() => setIsCollectionComposerOpen((open) => !open)}
                className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-white p-1.5 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                title="Create collection"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setSelectedCollectionId(ALL_PROJECTS_COLLECTION_ID)}
                className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                  selectedCollectionId === ALL_PROJECTS_COLLECTION_ID
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className="font-medium">All Projects</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                  {collectionCounts[ALL_PROJECTS_COLLECTION_ID] || 0}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedCollectionId(GITHUB_STARS_COLLECTION_ID)}
                className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                  selectedCollectionId === GITHUB_STARS_COLLECTION_ID
                    ? 'border-yellow-200 bg-yellow-50 text-yellow-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className="font-medium">GitHub Stars</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                  {collectionCounts[GITHUB_STARS_COLLECTION_ID] || 0}
                </span>
              </button>

              {collections.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => setSelectedCollectionId(collection.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    selectedCollectionId === collection.id
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium truncate">{collection.name}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                      {collectionCounts[collection.id] || 0}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 line-clamp-2">
                    {collection.description?.trim() || 'No description yet.'}
                  </p>
                  {collection.auto_collect_enabled && (
                    <span className="mt-2 inline-flex rounded-md bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">
                      Auto collect enabled
                    </span>
                  )}
                </button>
              ))}
            </div>

            {collections.length === 0 && (
              <p className="mt-3 text-sm text-gray-400 italic">Create your first custom collection to organize projects.</p>
            )}

            {isCollectionComposerOpen && (
              <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-white p-4 space-y-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Collection Name</label>
                  <input
                    type="text"
                    value={newCollectionName}
                    onChange={(event) => setNewCollectionName(event.target.value)}
                    className="block w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="AI Infra, Design Systems..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Description</label>
                  <textarea
                    value={newCollectionDescription}
                    onChange={(event) => setNewCollectionDescription(event.target.value)}
                    rows={3}
                    className="block w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Describe what belongs in this collection..."
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCreateCollection}
                    disabled={isSavingCollection}
                    className="inline-flex items-center rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSavingCollection ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCollectionComposerOpen(false)}
                    className="inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
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
                    onChange={(event) => setSearchQuery(event.target.value)}
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
                  onChange={(event) => setFilterLanguage(event.target.value)}
                  className="block w-full pl-3 pr-10 py-2 text-base border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md bg-white cursor-pointer"
                >
                  <option value="all">All Languages</option>
                  {languages.map((language) => (
                    <option key={language} value={language}>{language}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-semibold text-gray-700">AI Tags</label>
                  {filterTag !== 'all' && (
                    <button
                      onClick={() => setFilterTag('all')}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {allTags.map((tag) => {
                    const colors = getTagColor(tag);
                    const isSelected = filterTag === tag;

                    return (
                      <button
                        key={tag}
                        onClick={() => setFilterTag(isSelected ? 'all' : tag)}
                        className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                          isSelected
                            ? `${colors.bg} border-blue-400 ${colors.text} ring-1 ring-blue-400`
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
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
                    onChange={(event) => setSortBy(event.target.value as 'starred_at' | 'stars_count' | 'name' | 'activity')}
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white">
        <div className="p-6 md:p-8 lg:p-10 w-full mx-auto space-y-8">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
            <div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Dashboard</h1>
              <p className="text-base text-gray-500 mt-1">
                Welcome back, <span className="font-medium text-gray-700">{user?.user_metadata.preferred_username}</span>
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Viewing <span className="font-semibold text-gray-700">{activeCollectionLabel}</span>
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full lg:w-auto">
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
                    title={isAutoSummarizing ? 'Pause automatic summarization' : 'Automatically summarize all projects without a summary'}
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
                            ? 'Resume Auto Summarize'
                            : 'Auto Summarize'}
                        </span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      if (!isAutoSummarizing) {
                        void handleAutoSummarize(true);
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

          {selectedCollectionId === GITHUB_STARS_COLLECTION_ID && (
            <div className="rounded-2xl border border-yellow-200 bg-yellow-50/70 p-5">
              <h2 className="text-lg font-semibold text-yellow-900">GitHub Stars</h2>
              <p className="mt-2 text-sm text-yellow-800">
                This smart collection mirrors repositories already starred in your GitHub account.
              </p>
            </div>
          )}

          {selectedCollection && (
            <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
              <div className="grid grid-cols-1 xl:grid-cols-[2fr_2fr_auto] gap-4 items-start">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Collection Name</label>
                  <input
                    type="text"
                    value={editingCollectionName}
                    onChange={(event) => setEditingCollectionName(event.target.value)}
                    className="block w-full rounded-md border border-blue-100 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Description</label>
                  <textarea
                    value={editingCollectionDescription}
                    onChange={(event) => setEditingCollectionDescription(event.target.value)}
                    rows={3}
                    className="block w-full rounded-md border border-blue-100 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Describe what belongs in this collection..."
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="inline-flex items-center gap-2 rounded-md border border-blue-100 bg-white px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={collectionAutoCollectEnabled}
                      onChange={(event) => setCollectionAutoCollectEnabled(event.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Auto collect on load
                  </label>
                  <button
                    type="button"
                    onClick={handleSaveSelectedCollection}
                    disabled={isSavingCollection}
                    className="inline-flex items-center justify-center rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSavingCollection ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAutoCollect(selectedCollection)}
                    disabled={runningAutoCollectionId === selectedCollection.id}
                    className="inline-flex items-center justify-center rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {runningAutoCollectionId === selectedCollection.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Run Auto Collect
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSelectedCollection}
                    disabled={isSavingCollection}
                    className="inline-flex items-center justify-center rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
              <p className="mt-3 text-sm text-blue-800">
                {collectionCounts[selectedCollection.id] || 0} project(s) currently in this collection.
                Auto collect uses project AI summaries and tags to find related repositories.
              </p>
            </div>
          )}

          {((filterTag !== 'all' && filterTag !== '') || filterType !== 'all' || filterLanguage !== 'all' || searchQuery) && (
            <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-gray-100">
              <span className="text-sm font-medium text-gray-500 mr-2">Active filters:</span>

              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700">
                Collection: {activeCollectionLabel}
              </span>

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

              {filterTag !== 'all' && (() => {
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

          {isCustomCollectionSelected && filteredAndSortedProjects.length > 0 && (
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-amber-900">Manage projects in this collection</p>
                <p className="text-sm text-amber-800">
                  {selectedProjectIds.length} selected. Use checkboxes on cards for batch remove.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleSelectAllVisible}
                  className="inline-flex items-center rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
                >
                  {filteredAndSortedProjects.length > 0 && filteredAndSortedProjects.every((project) => selectedProjectIds.includes(project.id))
                    ? 'Clear Selection'
                    : 'Select Visible'}
                </button>
                <button
                  type="button"
                  onClick={handleBatchRemoveFromCollection}
                  disabled={selectedProjectIds.length === 0}
                  className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove Selected
                </button>
              </div>
            </div>
          )}

          {isLoadingData || isLoadingCollections ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            </div>
          ) : filteredAndSortedProjects.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
              {filteredAndSortedProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  collections={collections}
                  assignedCollections={projectCollectionsMap[project.id] || []}
                  onToggleCollection={(collection, shouldInclude) => handleToggleProjectCollection(project.id, collection, shouldInclude)}
                  showSelectionCheckbox={isCustomCollectionSelected}
                  isSelected={selectedProjectIds.includes(project.id)}
                  onToggleSelected={handleToggleSelectedProject}
                  onRemoveFromCurrentCollection={isCustomCollectionSelected ? handleRemoveFromCurrentCollection : undefined}
                  currentCollectionName={selectedCollection?.name}
                />
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
                  : "We couldn't find anything matching your current search, filter, or collection criteria."}
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
