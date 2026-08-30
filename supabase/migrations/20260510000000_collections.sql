CREATE TABLE IF NOT EXISTS public.collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    description TEXT DEFAULT '',
    auto_collect_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS public.collection_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(collection_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_collections_user_id ON public.collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_projects_collection_id ON public.collection_projects(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_projects_project_id ON public.collection_projects(project_id);

GRANT ALL PRIVILEGES ON public.collections TO authenticated;
GRANT ALL PRIVILEGES ON public.collection_projects TO authenticated;

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collections_select_own ON public.collections;
DROP POLICY IF EXISTS collections_insert_own ON public.collections;
DROP POLICY IF EXISTS collections_update_own ON public.collections;
DROP POLICY IF EXISTS collections_delete_own ON public.collections;

CREATE POLICY collections_select_own ON public.collections
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY collections_insert_own ON public.collections
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY collections_update_own ON public.collections
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY collections_delete_own ON public.collections
FOR DELETE TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS collection_projects_select_own ON public.collection_projects;
DROP POLICY IF EXISTS collection_projects_insert_own ON public.collection_projects;
DROP POLICY IF EXISTS collection_projects_update_own ON public.collection_projects;
DROP POLICY IF EXISTS collection_projects_delete_own ON public.collection_projects;

CREATE POLICY collection_projects_select_own ON public.collection_projects
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.collections
        WHERE collections.id = collection_projects.collection_id
          AND collections.user_id = auth.uid()
    )
);

CREATE POLICY collection_projects_insert_own ON public.collection_projects
FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.collections
        WHERE collections.id = collection_projects.collection_id
          AND collections.user_id = auth.uid()
    )
);

CREATE POLICY collection_projects_update_own ON public.collection_projects
FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.collections
        WHERE collections.id = collection_projects.collection_id
          AND collections.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.collections
        WHERE collections.id = collection_projects.collection_id
          AND collections.user_id = auth.uid()
    )
);

CREATE POLICY collection_projects_delete_own ON public.collection_projects
FOR DELETE TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.collections
        WHERE collections.id = collection_projects.collection_id
          AND collections.user_id = auth.uid()
    )
);
