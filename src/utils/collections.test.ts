import { describe, expect, it } from 'vitest';
import type { Project } from '../store/useDashboardStore';
import { matchProjectToCollection, tokenizeMixedText } from './collections';

describe('tokenizeMixedText', () => {
  it('removes English stop words from mixed Chinese and English text', () => {
    const tokens = tokenizeMixedText('Markdown tools for 文档管理');

    expect(tokens).toContain('markdown');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('tools');
  });
});

describe('matchProjectToCollection', () => {
  it('does not match a project without AI summary or tags', () => {
    const project: Project = {
      id: 'project-1',
      github_id: 1,
      name: 'Example',
      full_name: 'owner/Example',
      description: 'An example project',
      language: 'TypeScript',
      stars_count: 0,
      forks_count: 0,
      html_url: 'https://github.com/owner/Example',
      type: 'star',
    };
    const collection = {
      id: 'collection-1',
      user_id: 'user-1',
      name: 'Examples',
      auto_collect_enabled: true,
    };

    expect(matchProjectToCollection(project, collection)).toMatchObject({
      matched: false,
      score: 0,
    });
  });
});
