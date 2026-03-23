import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import { Project } from '../store/useDashboardStore';
import { ArrowLeft, Star, GitFork, ExternalLink, Calendar, Code, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';

export const ProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProject = async () => {
      if (!id) return;
      
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .eq('id', id)
          .single();

        if (error) throw error;
        setProject(data as Project);
      } catch (err: unknown) {
        console.error('Error fetching project:', err);
        setError(err instanceof Error ? err.message : 'Failed to load project details');
      } finally {
        setIsLoading(false);
      }
    };

    fetchProject();
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="bg-red-50 p-4 rounded-md flex items-center">
        <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
        <span className="text-red-700">{error || 'Project not found'}</span>
      </div>
    );
  }

  // Mock data for charts since we don't have historical data in the current schema
  const mockActivityData = Array.from({ length: 6 }).map((_, i) => ({
    name: format(new Date(Date.now() - (5 - i) * 30 * 24 * 60 * 60 * 1000), 'MMM yyyy'),
    stars: Math.floor(project.stars_count * (0.5 + (i * 0.1))),
    forks: Math.floor(project.forks_count * (0.5 + (i * 0.1))),
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link to="/dashboard" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-900 mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Dashboard
        </Link>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {project.full_name}
              </h1>
              <p className="text-lg text-gray-600 mb-4">
                {project.description || 'No description available for this repository.'}
              </p>
            </div>
            <a
              href={project.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 flex-shrink-0"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              View on GitHub
            </a>
          </div>

          <div className="flex flex-wrap gap-6 mt-6 pt-6 border-t border-gray-100">
            {project.language && (
              <div className="flex items-center text-sm text-gray-600">
                <Code className="h-5 w-5 mr-2 text-gray-400" />
                <span className="font-medium mr-1">Language:</span> {project.language}
              </div>
            )}
            <div className="flex items-center text-sm text-gray-600">
              <Star className="h-5 w-5 mr-2 text-yellow-400" />
              <span className="font-medium mr-1">Stars:</span> {project.stars_count.toLocaleString()}
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <GitFork className="h-5 w-5 mr-2 text-blue-400" />
              <span className="font-medium mr-1">Forks:</span> {project.forks_count.toLocaleString()}
            </div>
            {project.github_created_at && (
              <div className="flex items-center text-sm text-gray-600">
                <Calendar className="h-5 w-5 mr-2 text-gray-400" />
                <span className="font-medium mr-1">Created:</span> {format(new Date(project.github_created_at), 'MMM d, yyyy')}
              </div>
            )}
            {project.github_updated_at && (
              <div className="flex items-center text-sm text-gray-600">
                <Calendar className="h-5 w-5 mr-2 text-gray-400" />
                <span className="font-medium mr-1">Last Updated:</span> {format(new Date(project.github_updated_at), 'MMM d, yyyy')}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Estimated Growth (Mock Data)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mockActivityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="stars" stroke="#eab308" strokeWidth={2} name="Stars" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Forks Trend (Mock Data)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockActivityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="forks" fill="#3b82f6" name="Forks" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
