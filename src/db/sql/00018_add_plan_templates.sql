-- Plan Templates System
-- Allows users to save plans as reusable templates and create new plans from templates

CREATE TABLE IF NOT EXISTS plan_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  structure JSONB NOT NULL, -- Hierarchical plan structure (phases, tasks, etc.)
  is_public BOOLEAN DEFAULT false,
  is_starter BOOLEAN DEFAULT false, -- System-provided starter templates
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  use_count INTEGER DEFAULT 0, -- Track template popularity
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_templates_category ON plan_templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_public ON plan_templates(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_templates_owner ON plan_templates(owner_id);
CREATE INDEX IF NOT EXISTS idx_templates_starter ON plan_templates(is_starter) WHERE is_starter = true;

-- Full-text search on templates
CREATE INDEX IF NOT EXISTS idx_templates_search ON plan_templates USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')));

-- RLS Policies
ALTER TABLE plan_templates ENABLE ROW LEVEL SECURITY;

-- Anyone can view public templates and starter templates
CREATE POLICY templates_select_public ON plan_templates
  FOR SELECT USING (is_public = true OR is_starter = true OR owner_id = auth.uid());

-- Users can only insert their own templates
CREATE POLICY templates_insert ON plan_templates
  FOR INSERT WITH CHECK (owner_id = auth.uid() AND is_starter = false);

-- Users can only update their own templates
CREATE POLICY templates_update ON plan_templates
  FOR UPDATE USING (owner_id = auth.uid() AND is_starter = false);

-- Users can only delete their own templates
CREATE POLICY templates_delete ON plan_templates
  FOR DELETE USING (owner_id = auth.uid() AND is_starter = false);

-- Insert starter templates
INSERT INTO plan_templates (title, description, category, structure, is_public, is_starter, owner_id) VALUES
(
  'Software Project',
  'A comprehensive template for software development projects with planning, implementation, testing, and deployment phases.',
  'software',
  '{
    "phases": [
      {
        "title": "Planning & Design",
        "description": "Define requirements and architecture",
        "tasks": [
          {"title": "Define project scope and requirements", "description": "Document what the software needs to do"},
          {"title": "Create technical architecture", "description": "Design system architecture and data models"},
          {"title": "Set up development environment", "description": "Configure dev tools, CI/CD, and repositories"},
          {"title": "Create project timeline", "description": "Break down work into sprints or milestones"}
        ]
      },
      {
        "title": "Implementation",
        "description": "Build the core functionality",
        "tasks": [
          {"title": "Implement core features", "description": "Build the main functionality"},
          {"title": "Create API endpoints", "description": "Design and implement REST/GraphQL APIs"},
          {"title": "Build user interface", "description": "Implement frontend components"},
          {"title": "Integrate third-party services", "description": "Connect external APIs and services"}
        ]
      },
      {
        "title": "Testing & QA",
        "description": "Ensure quality and reliability",
        "tasks": [
          {"title": "Write unit tests", "description": "Test individual components"},
          {"title": "Perform integration testing", "description": "Test component interactions"},
          {"title": "User acceptance testing", "description": "Validate with stakeholders"},
          {"title": "Fix bugs and issues", "description": "Address discovered problems"}
        ]
      },
      {
        "title": "Deployment & Launch",
        "description": "Release to production",
        "tasks": [
          {"title": "Prepare production environment", "description": "Set up hosting and infrastructure"},
          {"title": "Create deployment pipeline", "description": "Automate the release process"},
          {"title": "Write documentation", "description": "Create user guides and API docs"},
          {"title": "Launch and monitor", "description": "Deploy and track performance"}
        ]
      }
    ]
  }'::jsonb,
  true,
  true,
  NULL
),
(
  'Marketing Campaign',
  'Plan and execute a marketing campaign from strategy to launch and analysis.',
  'marketing',
  '{
    "phases": [
      {
        "title": "Strategy & Research",
        "description": "Define campaign goals and target audience",
        "tasks": [
          {"title": "Define campaign objectives", "description": "Set measurable goals (awareness, leads, sales)"},
          {"title": "Identify target audience", "description": "Create audience personas and segments"},
          {"title": "Competitive analysis", "description": "Research competitor campaigns"},
          {"title": "Set budget and timeline", "description": "Allocate resources and deadlines"}
        ]
      },
      {
        "title": "Content Creation",
        "description": "Develop campaign assets",
        "tasks": [
          {"title": "Develop messaging and copy", "description": "Write headlines, taglines, and body copy"},
          {"title": "Create visual assets", "description": "Design graphics, videos, and images"},
          {"title": "Build landing pages", "description": "Create conversion-focused pages"},
          {"title": "Prepare email sequences", "description": "Write nurture and promotional emails"}
        ]
      },
      {
        "title": "Campaign Launch",
        "description": "Execute across channels",
        "tasks": [
          {"title": "Set up ad campaigns", "description": "Configure paid media (Google, Meta, etc.)"},
          {"title": "Schedule social media posts", "description": "Plan and queue social content"},
          {"title": "Send email campaigns", "description": "Launch email sequences"},
          {"title": "Activate PR and partnerships", "description": "Coordinate press and influencers"}
        ]
      },
      {
        "title": "Analysis & Optimization",
        "description": "Measure results and improve",
        "tasks": [
          {"title": "Track campaign metrics", "description": "Monitor KPIs and conversions"},
          {"title": "A/B test variations", "description": "Test and optimize creative"},
          {"title": "Generate reports", "description": "Create performance summaries"},
          {"title": "Document learnings", "description": "Capture insights for future campaigns"}
        ]
      }
    ]
  }'::jsonb,
  true,
  true,
  NULL
),
(
  'Research Project',
  'Structure a research project from hypothesis to publication.',
  'research',
  '{
    "phases": [
      {
        "title": "Research Design",
        "description": "Define research questions and methodology",
        "tasks": [
          {"title": "Define research questions", "description": "Formulate clear, answerable questions"},
          {"title": "Literature review", "description": "Survey existing research and identify gaps"},
          {"title": "Design methodology", "description": "Choose research methods and approaches"},
          {"title": "Create research plan", "description": "Outline timeline and resources needed"}
        ]
      },
      {
        "title": "Data Collection",
        "description": "Gather research data",
        "tasks": [
          {"title": "Prepare data collection tools", "description": "Create surveys, interview guides, etc."},
          {"title": "Collect primary data", "description": "Conduct experiments, surveys, interviews"},
          {"title": "Gather secondary data", "description": "Compile existing datasets and sources"},
          {"title": "Organize and store data", "description": "Structure data for analysis"}
        ]
      },
      {
        "title": "Analysis",
        "description": "Analyze and interpret findings",
        "tasks": [
          {"title": "Clean and prepare data", "description": "Process raw data for analysis"},
          {"title": "Perform statistical analysis", "description": "Apply appropriate analytical methods"},
          {"title": "Interpret results", "description": "Draw conclusions from analysis"},
          {"title": "Validate findings", "description": "Check for reliability and validity"}
        ]
      },
      {
        "title": "Publication",
        "description": "Share research findings",
        "tasks": [
          {"title": "Write research paper", "description": "Draft findings in academic format"},
          {"title": "Create visualizations", "description": "Design charts, graphs, and figures"},
          {"title": "Peer review", "description": "Get feedback and revise"},
          {"title": "Submit and publish", "description": "Submit to journals or conferences"}
        ]
      }
    ]
  }'::jsonb,
  true,
  true,
  NULL
),
(
  'Product Launch',
  'Plan and execute a successful product launch.',
  'product',
  '{
    "phases": [
      {
        "title": "Pre-Launch Planning",
        "description": "Prepare for launch",
        "tasks": [
          {"title": "Define launch goals", "description": "Set success metrics and targets"},
          {"title": "Identify target customers", "description": "Define ideal customer profile"},
          {"title": "Competitive positioning", "description": "Differentiate from competitors"},
          {"title": "Set pricing strategy", "description": "Determine pricing and packaging"}
        ]
      },
      {
        "title": "Launch Preparation",
        "description": "Build launch assets",
        "tasks": [
          {"title": "Create product messaging", "description": "Develop value proposition and copy"},
          {"title": "Build product landing page", "description": "Create conversion-focused page"},
          {"title": "Prepare demo and tutorials", "description": "Create product walkthrough content"},
          {"title": "Set up analytics", "description": "Configure tracking and dashboards"}
        ]
      },
      {
        "title": "Launch Execution",
        "description": "Go to market",
        "tasks": [
          {"title": "Announce on social media", "description": "Share launch news across channels"},
          {"title": "Send launch emails", "description": "Notify subscribers and waitlist"},
          {"title": "Submit to directories", "description": "Product Hunt, directories, etc."},
          {"title": "Activate PR coverage", "description": "Reach out to press and bloggers"}
        ]
      },
      {
        "title": "Post-Launch",
        "description": "Sustain momentum",
        "tasks": [
          {"title": "Monitor feedback", "description": "Collect and respond to user feedback"},
          {"title": "Track launch metrics", "description": "Measure against goals"},
          {"title": "Iterate on product", "description": "Make quick improvements based on feedback"},
          {"title": "Plan next release", "description": "Define roadmap for future updates"}
        ]
      }
    ]
  }'::jsonb,
  true,
  true,
  NULL
),
(
  'Content Calendar',
  'Plan and manage content creation across channels.',
  'content',
  '{
    "phases": [
      {
        "title": "Content Strategy",
        "description": "Define content direction",
        "tasks": [
          {"title": "Define content pillars", "description": "Identify main themes and topics"},
          {"title": "Set content goals", "description": "Define KPIs (traffic, engagement, leads)"},
          {"title": "Audit existing content", "description": "Review what you have and gaps"},
          {"title": "Create content guidelines", "description": "Document voice, style, and standards"}
        ]
      },
      {
        "title": "Content Planning",
        "description": "Plan content calendar",
        "tasks": [
          {"title": "Brainstorm content ideas", "description": "Generate topic ideas for each pillar"},
          {"title": "Research keywords", "description": "Find SEO opportunities"},
          {"title": "Create editorial calendar", "description": "Schedule content by date and channel"},
          {"title": "Assign content owners", "description": "Delegate creation responsibilities"}
        ]
      },
      {
        "title": "Content Creation",
        "description": "Produce content assets",
        "tasks": [
          {"title": "Write blog posts", "description": "Create long-form written content"},
          {"title": "Create social content", "description": "Design posts for each platform"},
          {"title": "Produce video content", "description": "Record and edit videos"},
          {"title": "Design visual assets", "description": "Create graphics and infographics"}
        ]
      },
      {
        "title": "Publishing & Promotion",
        "description": "Distribute content",
        "tasks": [
          {"title": "Publish content", "description": "Post across all channels"},
          {"title": "Promote on social media", "description": "Share and boost content"},
          {"title": "Send newsletter", "description": "Include content in email updates"},
          {"title": "Analyze performance", "description": "Review metrics and optimize"}
        ]
      }
    ]
  }'::jsonb,
  true,
  true,
  NULL
)
ON CONFLICT DO NOTHING;

-- Comment
COMMENT ON TABLE plan_templates IS 'Reusable plan templates that users can clone to create new plans';
