-- Explicit migration only. DATABASE_URL must identify an existing Neon database.
CREATE TABLE IF NOT EXISTS conversations (
 id uuid PRIMARY KEY,
 owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 256),
 title text NOT NULL DEFAULT 'New conversation',
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 lease_token text,
 lease_expires_at timestamptz,
 CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);
CREATE INDEX IF NOT EXISTS conversations_owner_updated ON conversations(owner_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('user','assistant')),
 content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources)='array'),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
 search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig,content)) STORED
);
CREATE INDEX IF NOT EXISTS messages_conversation_id ON messages(conversation_id,id);
CREATE INDEX IF NOT EXISTS messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS messages_search ON messages USING GIN(search_vector);

-- Per-owner admission survives process restarts and is shared across isolates.
CREATE TABLE IF NOT EXISTS owner_limits (
 owner_id text PRIMARY KEY CHECK (length(owner_id) BETWEEN 1 AND 256),
 conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
 lease_token text,
 lease_expires_at timestamptz,
 admission_day date NOT NULL,
 admitted_count integer NOT NULL CHECK (admitted_count BETWEEN 1 AND 60),
 CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);

-- Public demo admission is atomic across Workers and survives deployments.
-- Do not reset counters automatically: total_count is a lifetime spending fuse.
CREATE TABLE IF NOT EXISTS public_limits (
 scope text PRIMARY KEY CHECK (length(scope) BETWEEN 1 AND 256),
 day date NOT NULL,
 daily_count integer NOT NULL CHECK (daily_count > 0),
 total_count integer NOT NULL CHECK (total_count > 0)
);
