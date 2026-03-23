import React, { useEffect, useState, useRef } from 'react';
import { Project } from '../store/useDashboardStore';
import { analyzeProjectActivity } from '../utils/github';
import { supabase } from '../utils/supabaseClient';
import { Flame, TrendingUp, Moon, AlertCircle, Loader2 } from 'lucide-react';

interface ActivityBadgeProps {
  project: Project;
}

export const ActivityBadge: React.FC<ActivityBadgeProps> = ({ project }) => {
  const [index, setIndex] = useState<number | null>(project.activity_index ?? null);
  const [details, setDetails] = useState(project.activity_details ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const badgeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // If we already have recent data, don't re-fetch
    const hasRecentData = project.activity_analyzed_at && 
      (Date.now() - new Date(project.activity_analyzed_at).getTime() < 7 * 24 * 60 * 60 * 1000);

    if (hasRecentData && index !== null) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadActivity();
        observer.disconnect();
      }
    }, { threshold: 0.1 });

    if (badgeRef.current) {
      observer.observe(badgeRef.current);
    }
    
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const loadActivity = async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await analyzeProjectActivity(project.full_name);
      setIndex(result.index);
      setDetails(result.details);

      // Update the database asynchronously
      await supabase.from('projects').update({
        activity_index: result.index,
        activity_details: result.details,
        activity_analyzed_at: new Date().toISOString()
      }).eq('id', project.id);

    } catch (err) {
      console.error('Failed to analyze activity for', project.full_name, err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const getBadgeContent = () => {
    if (loading) {
      return {
        icon: <Loader2 className="w-3 h-3 animate-spin mr-1" />,
        text: 'Analyzing...',
        color: 'bg-gray-100 text-gray-600 border-gray-200'
      };
    }
    
    if (error) {
      return {
        icon: <AlertCircle className="w-3 h-3 mr-1" />,
        text: 'Unknown',
        color: 'bg-gray-100 text-gray-500 border-gray-200'
      };
    }

    if (index === null) {
      return {
        icon: <Loader2 className="w-3 h-3 animate-spin mr-1" />,
        text: 'Waiting...',
        color: 'bg-gray-100 text-gray-600 border-gray-200'
      };
    }

    if (index >= 80) {
      return {
        icon: <Flame className="w-3 h-3 mr-1 text-orange-500" />,
        text: 'Hot',
        color: 'bg-orange-50 text-orange-700 border-orange-200'
      };
    } else if (index >= 40) {
      return {
        icon: <TrendingUp className="w-3 h-3 mr-1 text-green-500" />,
        text: 'Active',
        color: 'bg-green-50 text-green-700 border-green-200'
      };
    } else {
      return {
        icon: <Moon className="w-3 h-3 mr-1 text-blue-400" />,
        text: 'Quiet',
        color: 'bg-blue-50 text-blue-700 border-blue-200'
      };
    }
  };

  const content = getBadgeContent();

  return (
    <div className="relative group inline-block" ref={badgeRef}>
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${content.color}`}>
        {content.icon}
        {content.text} {index !== null && !loading && !error ? `(${index})` : ''}
      </span>
      
      {/* Tooltip */}
      {details && !loading && !error && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 p-3 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10 pointer-events-none w-48">
          <div className="font-semibold mb-2 border-b border-gray-700 pb-1.5 text-center">Last 30 Days Activity</div>
          <div className="grid grid-cols-2 gap-y-2 gap-x-4">
            <div className="flex justify-between">
              <span className="text-gray-400">Commits:</span>
              <span className="font-medium">{details.commits}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">PRs:</span>
              <span className="font-medium">{details.prs}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Issues:</span>
              <span className="font-medium">{details.issues}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Releases:</span>
              <span className="font-medium">{details.releases}</span>
            </div>
          </div>
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
        </div>
      )}
    </div>
  );
};
