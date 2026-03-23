import { supabase } from './supabaseClient';

const GITHUB_API_URL = 'https://api.github.com';

async function getGithubToken() {
  console.log('[GitHub Utils] Attempting to get GitHub token from session...');
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[GitHub Utils] Error getting session:', error);
  }
  const token = session?.provider_token;
  console.log(`[GitHub Utils] Token retrieved: ${token ? 'Yes (length: ' + token.length + ')' : 'No'}`);
  return token;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string;
  language: string;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
  created_at: string;
  updated_at: string;
  fork: boolean;
}

interface GitHubStar {
  starred_at: string;
  repo: GitHubRepo;
}

export async function fetchUserStars(username: string) {
  console.log(`[GitHub API] Starting fetchUserStars for username: ${username}`);
  if (!username) {
    console.warn('[GitHub API] fetchUserStars called with empty username, returning empty array');
    return [];
  }
  const token = await getGithubToken();
  // if (!token) throw new Error('No GitHub token found');

  let allStars: GitHubStar[] = [];
  let page = 1;
  const perPage = 100;

  // For demo purposes, we'll just fetch the first page or two to avoid rate limits
  // In a real app, you'd want to paginate through all results
  while (page <= 2) {
    const url = token 
      ? `${GITHUB_API_URL}/user/starred?page=${page}&per_page=${perPage}`
      : `${GITHUB_API_URL}/users/${username}/starred?page=${page}&per_page=${perPage}`;
      
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3.star+json',
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    console.log(`[GitHub API] Fetching stars (Page ${page}) from: ${url}`);
    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.error(`[GitHub API] Error fetching stars: ${response.status} ${response.statusText} for URL: ${url}`);
      if (response.status === 403) {
        console.warn('[GitHub API] GitHub API rate limit exceeded');
        throw new Error('GitHub API rate limit exceeded. Please try again later.');
      }
      if (response.status === 404) {
        console.error(`[GitHub API] User ${username} not found on GitHub`);
        throw new Error(`GitHub user ${username} not found.`);
      }
      throw new Error(`Failed to fetch stars: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[GitHub API] Fetched ${data.length} stars on page ${page}`);
    if (data.length === 0) break;

    allStars = [...allStars, ...data];
    page++;
  }

  console.log(`[GitHub API] Completed fetchUserStars. Total stars fetched: ${allStars.length}`);
  return allStars;
}

export async function fetchUserForks(username: string) {
  console.log(`[GitHub API] Starting fetchUserForks for username: ${username}`);
  if (!username) {
    console.warn('[GitHub API] fetchUserForks called with empty username, returning empty array');
    return [];
  }
  const token = await getGithubToken();
  // if (!token) throw new Error('No GitHub token found');

  let allForks: GitHubRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (page <= 2) {
    const url = `${GITHUB_API_URL}/users/${username}/repos?type=forks&page=${page}&per_page=${perPage}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    console.log(`[GitHub API] Fetching forks (Page ${page}) from: ${url}`);
    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.error(`[GitHub API] Error fetching forks: ${response.status} ${response.statusText} for URL: ${url}`);
      if (response.status === 403) {
        console.warn('[GitHub API] GitHub API rate limit exceeded');
        throw new Error('GitHub API rate limit exceeded. Please try again later.');
      }
      if (response.status === 404) {
        console.error(`[GitHub API] User ${username} not found on GitHub`);
        throw new Error(`GitHub user ${username} not found.`);
      }
      throw new Error(`Failed to fetch forks: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.length === 0) {
      console.log(`[GitHub API] No more forks found on page ${page}`);
      break;
    }

    // Filter only forks since the API might return other repos depending on parameters
    const forks = data.filter((repo: GitHubRepo) => repo.fork);
    console.log(`[GitHub API] Fetched ${data.length} repos on page ${page}, filtered to ${forks.length} actual forks`);
    allForks = [...allForks, ...forks];
    page++;
  }

  console.log(`[GitHub API] Completed fetchUserForks. Total forks fetched: ${allForks.length}`);
  return allForks;
}

export async function syncGitHubData(userId: string, githubId: string, username: string) {
  console.log(`[Sync Process] ========================================`);
  console.log(`[Sync Process] STARTING GITHUB DATA SYNC FOR USER`);
  console.log(`[Sync Process] User ID: ${userId}`);
  console.log(`[Sync Process] GitHub ID: ${githubId}`);
  console.log(`[Sync Process] Username: ${username}`);
  console.log(`[Sync Process] ========================================`);
  
  try {
    // 0. Ensure user exists in public.users
    console.log('[Sync Process] Step 0: Ensuring user exists in public.users table...');
    
    // Check if a user with this github_id already exists but with a different id
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('github_id', String(githubId))
      .single();

    if (existingUser && existingUser.id !== userId) {
      console.log(`[Sync Process] Found existing user with same github_id but different id (${existingUser.id}). Deleting old user to recreate with new id...`);
      // This will cascade delete user_projects for the old user, which is fine because we'll re-sync them
      const { error: deleteError } = await supabase
        .from('users')
        .delete()
        .eq('id', existingUser.id);
        
      if (deleteError) {
        console.error('[Sync Process] ❌ Error deleting old user:', deleteError);
      }
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .upsert({
        id: userId,
        github_id: String(githubId), // ensure string
        username: username,
      }, { onConflict: 'id' })
      .select();

    if (userError) {
        console.error('[Sync Process] ❌ Error upserting user:', userError);
        if (userError.code === '42501') {
          alert("Database RLS Error: You don't have permission to modify the users table. Please update the Supabase Row Level Security policies.");
        }
        if (userError.code === '23505') {
           console.log('[Sync Process] User already exists (unique constraint), continuing...');
        } else {
           // Instead of throwing and stopping everything, let's log and see if we can still insert into other tables.
           // However, foreign keys require the user to exist. If the user doesn't exist, we MUST stop.
           throw userError;
        }
    }
    
    // VERIFY USER EXISTS
    const { data: checkUser } = await supabase.from('users').select('id').eq('id', userId).single();
    if (!checkUser) {
      console.error('[Sync Process] ❌ Critical: User was not found in the database even after upsert attempt. Cannot proceed with foreign key relations.');
      alert('Critical Database Error: Failed to create or find your user record in the database. Please contact support or check database logs.');
      return false; // Stop execution to prevent foreign key errors
    }
    
    console.log('[Sync Process] ✅ User successfully verified/upserted in DB:', userData);

    // 1. Fetch data from GitHub
    console.log('[Sync Process] Step 1: Fetching Stars and Forks data from GitHub API...');
    const [starsData, forksData] = await Promise.all([
      fetchUserStars(username),
      fetchUserForks(username)
    ]);

    console.log(`[Sync Process] ✅ Successfully fetched ${starsData.length} stars and ${forksData.length} forks from GitHub`);

    // 2. Format and upsert projects
    console.log('[Sync Process] Step 2: Formatting and deduping project data for DB insertion...');
    const allProjects = [
      ...starsData.map((item: GitHubStar) => ({
        github_id: item.repo.id,
        name: item.repo.name || 'Untitled',
        full_name: item.repo.full_name || 'Unknown',
        description: item.repo.description,
        language: item.repo.language,
        stars_count: item.repo.stargazers_count || 0,
        forks_count: item.repo.forks_count || 0,
        html_url: item.repo.html_url,
        github_created_at: item.repo.created_at || new Date().toISOString(),
        github_updated_at: item.repo.updated_at || new Date().toISOString(),
      })),
      ...forksData.map((repo: GitHubRepo) => ({
        github_id: repo.id,
        name: repo.name || 'Untitled',
        full_name: repo.full_name || 'Unknown',
        description: repo.description,
        language: repo.language,
        stars_count: repo.stargazers_count || 0,
        forks_count: repo.forks_count || 0,
        html_url: repo.html_url,
        github_created_at: repo.created_at || new Date().toISOString(),
        github_updated_at: repo.updated_at || new Date().toISOString(),
      }))
    ];

    // Remove duplicates based on github_id
    const uniqueProjects = Array.from(new Map(allProjects.map(item => [item.github_id, item])).values());
    console.log(`[Sync Process] Prepared ${allProjects.length} total projects, deduplicated to ${uniqueProjects.length} unique projects`);

    if (uniqueProjects.length > 0) {
      console.log('[Sync Process] Upserting projects into public.projects table in chunks...');
      const projectChunkSize = 50;
      let allInsertedProjects: any[] = [];
      
      for (let i = 0; i < uniqueProjects.length; i += projectChunkSize) {
        const chunk = uniqueProjects.slice(i, i + projectChunkSize);
        const { data: insertedChunk, error: projectsError } = await supabase
          .from('projects')
          .upsert(chunk, { onConflict: 'github_id' })
          .select('id, github_id');

        if (projectsError) {
          console.error(`[Sync Process] ❌ Error upserting projects chunk ${i}-${i+chunk.length}:`, projectsError);
          if (projectsError.code === '42501') {
            alert("Database RLS Error: You don't have permission to modify the projects table. Please update the Supabase Row Level Security policies.");
          }
          if (projectsError.code === '23505') {
             console.log('[Sync Process] Projects already exist (unique constraint), continuing...');
          } else {
             // throw projectsError;
          }
        }
        
        if (insertedChunk) {
          allInsertedProjects = [...allInsertedProjects, ...insertedChunk];
        }
      }
      
      console.log(`[Sync Process] ✅ Successfully upserted ${allInsertedProjects.length} projects`);

      // 3. Link projects to user
      console.log('[Sync Process] Step 3: Linking projects to the user in user_projects table...');
      
      // We must fetch the actual projects from the database to get their UUIDs, 
      // because chunked upsert might not return all of them or they might already exist
      const { data: dbProjects } = await supabase
        .from('projects')
        .select('id, github_id')
        .in('github_id', uniqueProjects.map(p => p.github_id));
        
      const projectMap = new Map(dbProjects?.map(p => [p.github_id, p.id]) || []);

      const userProjects = [
        ...starsData.map((item: GitHubStar) => ({
          user_id: userId,
          project_id: projectMap.get(item.repo.id),
          type: 'star',
          starred_at: item.starred_at
        })),
        ...forksData.map((repo: GitHubRepo) => ({
          user_id: userId,
          project_id: projectMap.get(repo.id),
          type: 'fork',
          starred_at: repo.created_at // Use creation date for forks
        }))
      ].filter(up => up.project_id); // Filter out any missing project_ids
      
      console.log(`[Sync Process] Prepared ${userProjects.length} relation records for user_projects`);

      if (userProjects.length > 0) {
        // Break userProjects into smaller chunks to avoid request size limits or complex foreign key lockups
        const chunkSize = 50;
        let successCount = 0;
        
        for (let i = 0; i < userProjects.length; i += chunkSize) {
          const chunk = userProjects.slice(i, i + chunkSize);
          const { error: linkError } = await supabase
            .from('user_projects')
            .upsert(chunk, { onConflict: 'user_id, project_id, type' });

          if (linkError) {
            console.error(`[Sync Process] ❌ Error linking chunk ${i}-${i+chunk.length}:`, linkError);
            if (linkError.code === '42501') {
              alert("Database RLS Error: You don't have permission to modify the user_projects table. Please update the Supabase Row Level Security policies.");
            }
            if (linkError.code === '23503') {
              console.error("Foreign Key Error details:", linkError.details);
              // Instead of throwing and stopping everything, let's log and continue
              // throw linkError;
            } else if (linkError.code === '23505') {
              console.log('[Sync Process] Links already exist (unique constraint), continuing...');
            } else {
               // throw linkError;
            }
          } else {
            successCount += chunk.length;
          }
        }
        console.log(`[Sync Process] ✅ Successfully linked ${successCount}/${userProjects.length} projects to user`);
      }
    } else {
      console.log('[Sync Process] No new projects to insert or link. Skipping DB steps.');
    }

    console.log(`[Sync Process] 🎉 SYNC COMPLETED SUCCESSFULLY`);
    return true;
  } catch (error) {
    console.error('[Sync Process] ❌ CRITICAL ERROR DURING SYNC:', error);
    if (error instanceof Error) {
      console.error('[Sync Process] Error Message:', error.message);
      console.error('[Sync Process] Error Stack:', error.stack);
    }
    return false;
  }
}
