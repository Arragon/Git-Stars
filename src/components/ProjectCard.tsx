import React, { useState } from 'react';
import { Project } from '../store/useDashboardStore';
import { Star, GitFork, ExternalLink, Calendar, BookMarked, Sparkles, Loader2, Tag } from 'lucide-react';
import { ActivityBadge } from './ActivityBadge';
import { summarizeProject } from '../utils/ai';
import { supabase } from '../utils/supabaseClient';
import { useAiConfigStore } from '../store/useAiConfigStore';
import { useDashboardStore } from '../store/useDashboardStore';
import { getTagColor } from '../utils/colors';

interface ProjectCardProps {
  project: Project;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({ project }) => {
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [aiSummary, setAiSummary] = useState(project.ai_summary);
  const [aiTags, setAiTags] = useState<string[]>(project.ai_tags || []);
  const { isConfigured } = useAiConfigStore();
  const { projects, setProjects, filterTag, setFilterTag } = useDashboardStore();

  const handleSummarize = async () => {
    if (!isConfigured()) {
      alert('Please configure AI settings first.');
      return;
    }

    setIsSummarizing(true);
    // Also update global state so other components know it's summarizing
    setProjects(projects.map(p => 
      p.id === project.id ? { ...p, is_summarizing: true } : p
    ));
    
    try {
      // Gather all existing unique tags to pass as context
      const allExistingTags = Array.from(new Set(
        projects.flatMap(p => p.ai_tags || [])
      ));
      
      const result = await summarizeProject(
        project.name, 
        project.description, 
        project.language,
        allExistingTags
      );
      setAiSummary(result.summary);
      setAiTags(result.tags);

      // Save to database
      await supabase.from('projects').update({
        ai_summary: result.summary,
        ai_tags: result.tags
      }).eq('id', project.id);

      // Update global store
      setProjects(projects.map(p => 
        p.id === project.id 
          ? { ...p, ai_summary: result.summary, ai_tags: result.tags, is_summarizing: false } 
          : p
      ));

    } catch (error) {
      console.error('Summarization error:', error);
      alert(error instanceof Error ? error.message : 'Failed to generate summary');
      // Revert summarizing state on error
      setProjects(projects.map(p => 
        p.id === project.id ? { ...p, is_summarizing: false } : p
      ));
    } finally {
      setIsSummarizing(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  };

  // Derive state from props instead of local state to ensure it updates when global state changes
  // Only use local state for the manual button click, rely on project.is_summarizing for auto-summarize
  const isCurrentlySummarizing = isSummarizing || project.is_summarizing;
  const displaySummary = project.ai_summary || aiSummary;
  const displayTags = project.ai_tags?.length ? project.ai_tags : aiTags;

  return (
    <div className={`bg-white rounded-xl border ${isCurrentlySummarizing ? 'border-purple-400 ring-1 ring-purple-400 shadow-md' : 'border-gray-200'} shadow-sm hover:shadow-md transition-all duration-200 flex flex-col h-full text-sm hover:-translate-y-0.5 relative overflow-hidden`}>
      {/* Animated gradient border top for summarizing state */}
      {isCurrentlySummarizing && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-400 via-pink-500 to-purple-400 bg-[length:200%_auto] animate-gradient-x"></div>
      )}
      
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center space-x-2.5 truncate pr-2">
            <BookMarked className={`w-4.5 h-4.5 flex-shrink-0 ${isCurrentlySummarizing ? 'text-purple-500' : 'text-gray-400'}`} />
            <h3 className="text-base font-bold text-gray-900 truncate" title={project.full_name}>
              {project.name}
            </h3>
          </div>
          <div className="flex items-center space-x-1.5 flex-shrink-0">
            <button 
              onClick={handleSummarize}
              disabled={isCurrentlySummarizing}
              className={`transition-colors p-1.5 rounded-full hover:bg-purple-50 ${isCurrentlySummarizing ? 'text-purple-500' : 'text-gray-400 hover:text-purple-600'}`}
              title={displaySummary ? "Re-summarize with AI" : "Summarize with AI"}
            >
              {isCurrentlySummarizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            </button>
            <ActivityBadge project={project} />
          </div>
        </div>
        
        <p className="text-gray-600 mb-3 line-clamp-2 leading-relaxed text-sm flex-1" title={project.description}>
          {project.description || 'No description provided.'}
        </p>

        {isCurrentlySummarizing && !displaySummary && (
          <div className="mb-3 p-3 bg-purple-50/50 rounded-lg border border-purple-100/50 flex items-center justify-center space-x-2 text-purple-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs font-medium animate-pulse">Generating AI summary...</span>
          </div>
        )}

        {displaySummary && (
          <div className={`mb-3 p-3 bg-purple-50/80 rounded-lg text-xs text-purple-900 border ${isCurrentlySummarizing ? 'border-purple-300' : 'border-purple-100/60'} leading-relaxed shadow-sm transition-colors`}>
            <div className="font-semibold flex items-center mb-1.5 text-purple-800">
              <Sparkles className="w-3 h-3 mr-1.5 text-purple-500" />
              AI Summary {isCurrentlySummarizing && <span className="ml-2 text-[10px] font-normal text-purple-500 animate-pulse">(Updating...)</span>}
            </div>
            {displaySummary}
          </div>
        )}

        {displayTags && displayTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4 mt-auto">
            {displayTags.map((tag, idx) => {
                const colors = getTagColor(tag);
                const isSelected = filterTag === tag;
                return (
                  <button 
                    key={idx} 
                    onClick={() => setFilterTag(isSelected ? 'all' : tag)}
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer border ${
                      isSelected 
                        ? `${colors.bg} border-blue-400 ${colors.text} ring-1 ring-blue-400` 
                        : `${colors.bg} ${colors.text} ${colors.border} hover:opacity-80`
                    }`}
                  >
                    <Tag className={`w-2.5 h-2.5 mr-1 ${colors.text}`} />
                    {tag}
                  </button>
                );
              })}
            </div>
          )}
        
        <div className={`flex flex-wrap items-center gap-3.5 text-xs font-medium text-gray-500 ${!displayTags?.length && !displaySummary && !isCurrentlySummarizing ? 'mt-auto' : ''}`}>
          {project.language && (
            <div className="flex items-center space-x-1.5 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              <span>{project.language}</span>
            </div>
          )}
          
          <div className="flex items-center space-x-1" title="Stars">
            <Star className="w-4 h-4 text-yellow-500" />
            <span>{project.stars_count.toLocaleString()}</span>
          </div>
          
          <div className="flex items-center space-x-1" title="Forks">
            <GitFork className="w-4 h-4 text-gray-400" />
            <span>{project.forks_count.toLocaleString()}</span>
          </div>
        </div>
      </div>
      
      <div className="px-5 py-3 bg-gray-50/50 border-t border-gray-100 flex justify-between items-center rounded-b-xl">
        <div className="flex items-center text-xs font-medium text-gray-400" title={project.type === 'star' ? 'Starred on' : 'Forked on'}>
          <Calendar className="w-3.5 h-3.5 mr-1.5" />
          <span>{project.type === 'star' ? 'Starred' : 'Forked'} {formatDate(project.starred_at || project.github_created_at)}</span>
        </div>
        
        <a 
          href={project.html_url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-gray-400 hover:text-gray-900 transition-colors p-1 hover:bg-gray-200 rounded-md"
          title="View on GitHub"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
};
