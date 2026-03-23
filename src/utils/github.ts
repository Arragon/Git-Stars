import { supabase } from './supabaseClient';

const GITHUB_API_URL = 'https://api.github.com';

export async function analyzeProjectActivity(fullName: string) {
  console.log(`[GitHub API] Analyzing activity for ${fullName}`);
  const token = await getGithubToken();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Last 30 days
  const date = new Date();
  date.setDate(date.getDate() - 30);
  const since = date.toISOString();

  try {
    const [commitsRes, issuesRes, releasesRes] = await Promise.all([
      fetch(`${GITHUB_API_URL}/repos/${fullName}/commits?since=${since}&per_page=100`, { headers }),
      fetch(`${GITHUB_API_URL}/repos/${fullName}/issues?since=${since}&state=all&per_page=100`, { headers }),
      fetch(`${GITHUB_API_URL}/repos/${fullName}/releases?per_page=100`, { headers })
    ]);

    // Gracefully handle rate limits or repository not found errors
    if (!commitsRes.ok || !issuesRes.ok || !releasesRes.ok) {
      console.warn(`[GitHub API] Failed to fetch some data for ${fullName}.`);
      throw new Error('Failed to fetch project activity data');
    }

    const [commits, issuesAndPrs, releases] = await Promise.all([
      commitsRes.json(),
      issuesRes.json(),
      releasesRes.json()
    ]);

    // Handle potential API errors (e.g., repository is empty, disabled, etc.)
    const commitsCount = Array.isArray(commits) ? commits.length : 0;
    const issuesAndPrsArray = Array.isArray(issuesAndPrs) ? issuesAndPrs : [];
    const releasesArray = Array.isArray(releases) ? releases : [];
    
    // GitHub API returns PRs in the issues endpoint. We differentiate by checking the pull_request property
    const prsCount = issuesAndPrsArray.filter((item: any) => item.pull_request).length;
    const issuesCount = issuesAndPrsArray.length - prsCount;
    
    // Releases in last 30 days
    const recentReleasesCount = releasesArray.filter((r: any) => new Date(r.published_at) > date).length;

    // Calculate an activity index (max 100)
    // - Commits: max 50 points (2 pts each)
    // - PRs: max 20 points (4 pts each)
    // - Issues: max 20 points (2 pts each)
    // - Releases: max 10 points (10 pts each)
    const commitScore = Math.min(commitsCount * 2, 50);
    const prScore = Math.min(prsCount * 4, 20);
    const issueScore = Math.min(issuesCount * 2, 20);
    const releaseScore = Math.min(recentReleasesCount * 10, 10);
    
    const activityIndex = Math.min(commitScore + prScore + issueScore + releaseScore, 100);

    return {
      index: activityIndex,
      details: {
        commits: commitsCount,
        issues: issuesCount,
        prs: prsCount,
        releases: recentReleasesCount
      }
    };
  } catch (error) {
    console.error(`[GitHub API] Error analyzing activity for ${fullName}:`, error);
    throw error;
  }
}

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

export async function fetchUserStars(username: string, lastSyncedAt?: string) {
  console.log(`[GitHub API] Starting fetchUserStars for username: ${username}, lastSyncedAt: ${lastSyncedAt || 'None'}`);
  if (!username) {
    console.warn('[GitHub API] fetchUserStars called with empty username, returning empty array');
    return [];
  }
  const token = await getGithubToken();
  // if (!token) throw new Error('No GitHub token found');

  let allStars: GitHubStar[] = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
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

    // Check if we reached stars that are older than lastSyncedAt
    if (lastSyncedAt) {
      const lastSyncedDate = new Date(lastSyncedAt);
      const newStars = data.filter((item: GitHubStar) => new Date(item.starred_at) > lastSyncedDate);
      allStars = [...allStars, ...newStars];
      
      // If we found stars older than lastSyncedAt, we can stop fetching
      if (newStars.length < data.length) {
        hasMore = false;
        break;
      }
    } else {
      allStars = [...allStars, ...data];
      // For initial sync without lastSyncedAt, we still limit pages to avoid excessive fetching
      if (page >= 5) hasMore = false; // Fetch up to 500 stars initially
    }

    page++;
  }

  console.log(`[GitHub API] Completed fetchUserStars. Total new stars fetched: ${allStars.length}`);
  return allStars;
}

export async function fetchUserForks(username: string, lastSyncedAt?: string) {
  console.log(`[GitHub API] Starting fetchUserForks for username: ${username}, lastSyncedAt: ${lastSyncedAt || 'None'}`);
  if (!username) {
    console.warn('[GitHub API] fetchUserForks called with empty username, returning empty array');
    return [];
  }
  const token = await getGithubToken();
  // if (!token) throw new Error('No GitHub token found');

  let allForks: GitHubRepo[] = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    // Add sort=created&direction=desc to get newest forks first
    const url = `${GITHUB_API_URL}/users/${username}/repos?type=forks&sort=created&direction=desc&page=${page}&per_page=${perPage}`;
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
    
    if (lastSyncedAt) {
      const lastSyncedDate = new Date(lastSyncedAt);
      const newForks = forks.filter((repo: GitHubRepo) => new Date(repo.created_at) > lastSyncedDate);
      console.log(`[GitHub API] Fetched ${data.length} repos on page ${page}, filtered to ${newForks.length} new forks`);
      allForks = [...allForks, ...newForks];
      
      // If we found forks older than lastSyncedAt, stop fetching
      if (newForks.length < forks.length) {
        hasMore = false;
        break;
      }
    } else {
      console.log(`[GitHub API] Fetched ${data.length} repos on page ${page}, filtered to ${forks.length} actual forks`);
      allForks = [...allForks, ...forks];
      // Limit initial fetch to avoid rate limits
      if (page >= 5) hasMore = false; // Up to 500 repos initially
    }
    
    page++;
  }

  console.log(`[GitHub API] Completed fetchUserForks. Total new forks fetched: ${allForks.length}`);
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
      .select('id, last_synced_at')
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
        last_login_at: new Date().toISOString(), // Update last login time during sync
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
    
    // VERIFY USER EXISTS and get last_synced_at
    const { data: checkUser } = await supabase.from('users').select('id, last_synced_at').eq('id', userId).single();
    if (!checkUser) {
      console.error('[Sync Process] ❌ Critical: User was not found in the database even after upsert attempt. Cannot proceed with foreign key relations.');
      alert('Critical Database Error: Failed to create or find your user record in the database. Please contact support or check database logs.');
      return false; // Stop execution to prevent foreign key errors
    }
    
    console.log('[Sync Process] ✅ User successfully verified/upserted in DB:', userData);
    
    const lastSyncedAt = checkUser.last_synced_at;
    console.log(`[Sync Process] User last synced at: ${lastSyncedAt || 'Never'}`);

    // 1. Fetch data from GitHub
    console.log('[Sync Process] Step 1: Fetching Stars and Forks data from GitHub API...');
    const [starsData, forksData] = await Promise.all([
      fetchUserStars(username, lastSyncedAt),
      fetchUserForks(username, lastSyncedAt)
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

    // 4. Update last_synced_at
    console.log('[Sync Process] Step 4: Updating last_synced_at for user...');
    const { error: updateSyncError } = await supabase
      .from('users')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', userId);

    if (updateSyncError) {
      console.error('[Sync Process] ❌ Error updating last_synced_at:', updateSyncError);
    } else {
      console.log('[Sync Process] ✅ Successfully updated last_synced_at');
    }

    // 5. Perform automatic cleanup
    console.log('[Sync Process] Step 5: Performing automatic data cleanup...');
    try {
      // Clean up users inactive for 30 days
      const { error: timeCleanupError } = await supabase.rpc('cleanup_inactive_users', { days_inactive: 30 });
      if (timeCleanupError) {
        console.warn('[Sync Process] Warning: Failed to run time-based cleanup:', timeCleanupError);
      } else {
        console.log('[Sync Process] ✅ Completed time-based cleanup');
      }

      // Clean up oldest users if we exceed 1000 users
      const { error: capacityCleanupError } = await supabase.rpc('cleanup_old_users', { max_users: 1000 });
      if (capacityCleanupError) {
        console.warn('[Sync Process] Warning: Failed to run capacity-based cleanup:', capacityCleanupError);
      } else {
        console.log('[Sync Process] ✅ Completed capacity-based cleanup');
      }
    } catch (cleanupError) {
      console.error('[Sync Process] ❌ Error during cleanup phase:', cleanupError);
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
