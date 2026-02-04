-- Migration: Add Decision Requests System
-- Purpose: Enable agents to request human decisions with structured options

-- Create enum for urgency levels
CREATE TYPE decision_urgency AS ENUM ('blocking', 'can_continue', 'informational');

-- Create enum for decision status
CREATE TYPE decision_status AS ENUM ('pending', 'decided', 'expired', 'cancelled');

-- Create decision_requests table
CREATE TABLE decision_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    node_id UUID REFERENCES plan_nodes(id) ON DELETE SET NULL,
    
    -- Who requested the decision
    requested_by_user_id UUID NOT NULL REFERENCES auth.users(id),
    requested_by_agent_name TEXT, -- Optional agent identifier for attribution
    
    -- The decision context
    title TEXT NOT NULL,
    context TEXT NOT NULL, -- What the agent needs decided
    options JSONB DEFAULT '[]'::jsonb, -- [{option, pros, cons, recommendation}]
    
    -- Urgency and timing
    urgency decision_urgency NOT NULL DEFAULT 'can_continue',
    expires_at TIMESTAMPTZ, -- Optional expiration
    
    -- Decision status
    status decision_status NOT NULL DEFAULT 'pending',
    
    -- Resolution (when decided)
    decided_by_user_id UUID REFERENCES auth.users(id),
    decision TEXT, -- The actual decision made
    rationale TEXT, -- Why this decision was made
    decided_at TIMESTAMPTZ,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_decision_requests_plan_id ON decision_requests(plan_id);
CREATE INDEX idx_decision_requests_node_id ON decision_requests(node_id);
CREATE INDEX idx_decision_requests_status ON decision_requests(status);
CREATE INDEX idx_decision_requests_requested_by ON decision_requests(requested_by_user_id);
CREATE INDEX idx_decision_requests_pending ON decision_requests(plan_id, status) WHERE status = 'pending';

-- Trigger to update updated_at
CREATE TRIGGER update_decision_requests_updated_at
    BEFORE UPDATE ON decision_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE decision_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view decision requests for plans they have access to
CREATE POLICY decision_requests_select_policy ON decision_requests
    FOR SELECT
    USING (
        plan_id IN (
            SELECT id FROM plans WHERE owner_id = auth.uid()
            UNION
            SELECT plan_id FROM plan_collaborators WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can create decision requests for plans they have edit access to
CREATE POLICY decision_requests_insert_policy ON decision_requests
    FOR INSERT
    WITH CHECK (
        plan_id IN (
            SELECT id FROM plans WHERE owner_id = auth.uid()
            UNION
            SELECT plan_id FROM plan_collaborators 
            WHERE user_id = auth.uid() AND role IN ('editor', 'admin')
        )
    );

-- Policy: Users can update decision requests for plans they own or are admins of
-- (allows resolving decisions)
CREATE POLICY decision_requests_update_policy ON decision_requests
    FOR UPDATE
    USING (
        plan_id IN (
            SELECT id FROM plans WHERE owner_id = auth.uid()
            UNION
            SELECT plan_id FROM plan_collaborators 
            WHERE user_id = auth.uid() AND role IN ('editor', 'admin')
        )
    );

-- Policy: Only plan owners can delete decision requests
CREATE POLICY decision_requests_delete_policy ON decision_requests
    FOR DELETE
    USING (
        plan_id IN (SELECT id FROM plans WHERE owner_id = auth.uid())
    );

-- Add comment
COMMENT ON TABLE decision_requests IS 'Stores decision requests from agents for human review and resolution';
COMMENT ON COLUMN decision_requests.options IS 'JSON array of options: [{option: string, pros: string[], cons: string[], recommendation: boolean}]';
COMMENT ON COLUMN decision_requests.urgency IS 'blocking: agent cannot continue, can_continue: agent proceeds with default, informational: FYI only';
