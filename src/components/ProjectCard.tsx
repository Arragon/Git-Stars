import React from 'react';
import { Star, GitFork, ExternalLink } from 'lucide-react';
import { Project } from '../store/useDashboardStore';
import { Link } from 'react-router-dom';

interface ProjectCardProps {
  project: Project;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({ project }) => {
  // Simple color mapping for common languages
  const getLanguageColor = (lang: string) => {
    const colors: Record<string, string> = {
      TypeScript: 'bg-blue-500',
      JavaScript: 'bg-yellow-400',
      Python: 'bg-blue-400',
      Java: 'bg-orange-500',
      Go: 'bg-cyan-500',
      Rust: 'bg-orange-600',
      Ruby: 'bg-red-500',
      C: 'bg-gray-600',
      'C++': 'bg-pink-600',
      'C#': 'bg-blue-600',
      HTML: 'bg-red-400',
      CSS: 'bg-purple-500',
      Vue: 'bg-green-500',
      React: 'bg-blue-400',
    };
    return colors[lang] || 'bg-gray-400';
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col h-full hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-2">
        <Link 
          to={`/project/${project.id}`}
          className="text-lg font-semibold text-blue-600 hover:underline truncate mr-2"
          title={project.full_name}
        >
          {project.name}
        </Link>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          project.type === 'star' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'
        }`}>
          {project.type === 'star' ? 'Star' : 'Fork'}
        </span>
      </div>
      
      <p className="text-sm text-gray-500 mb-4 flex-grow line-clamp-3" title={project.description}>
        {project.description || 'No description provided.'}
      </p>
      
      <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-100">
        <div className="flex items-center space-x-4">
          {project.language && (
            <div className="flex items-center text-xs text-gray-600">
              <span className={`w-3 h-3 rounded-full mr-1.5 ${getLanguageColor(project.language)}`}></span>
              {project.language}
            </div>
          )}
          
          <div className="flex items-center text-xs text-gray-600" title="Stars">
            <Star className="w-4 h-4 mr-1 text-gray-400" />
            {project.stars_count.toLocaleString()}
          </div>
          
          <div className="flex items-center text-xs text-gray-600" title="Forks">
            <GitFork className="w-4 h-4 mr-1 text-gray-400" />
            {project.forks_count.toLocaleString()}
          </div>
        </div>
        
        <a 
          href={project.html_url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-gray-400 hover:text-gray-600"
          title="View on GitHub"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
};
