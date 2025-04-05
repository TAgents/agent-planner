-- This migration fixes RLS policy issues for comments, logs, and API keys tables

-- Fix missing RLS policies for plan_comments table
CREATE POLICY plan_comments_insert_policy ON plan_comments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_comments.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid()
          )
        )
      )
    )
  );

CREATE POLICY plan_comments_select_policy ON plan_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_comments.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid()
          )
        )
      )
    )
  );

-- Fix missing RLS policies for plan_node_logs table
CREATE POLICY plan_node_logs_insert_policy ON plan_node_logs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_logs.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid()
          )
        )
      )
    )
  );

CREATE POLICY plan_node_logs_select_policy ON plan_node_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_logs.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid()
          )
        )
      )
    )
  );



-- Add RLS policies for plan_node_artifacts table (new functionality)
CREATE POLICY plan_node_artifacts_select_policy ON plan_node_artifacts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_artifacts.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid()
          )
        )
      )
    )
  );

CREATE POLICY plan_node_artifacts_insert_policy ON plan_node_artifacts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_artifacts.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid() AND role IN ('admin', 'editor')
          )
        )
      )
    )
  );

CREATE POLICY plan_node_artifacts_update_policy ON plan_node_artifacts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_artifacts.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid() AND role IN ('admin', 'editor')
          )
        )
      )
    )
  );

CREATE POLICY plan_node_artifacts_delete_policy ON plan_node_artifacts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM plan_nodes 
      WHERE id = plan_node_artifacts.plan_node_id AND
      EXISTS (
        SELECT 1 FROM plans 
        WHERE id = plan_nodes.plan_id AND (
          owner_id = auth.uid() OR 
          EXISTS (
            SELECT 1 FROM plan_collaborators 
            WHERE plan_id = plans.id AND user_id = auth.uid() AND role IN ('admin', 'editor')
          )
        )
      )
    )
  );
