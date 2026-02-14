-- Prevent duplicate nodes with same title+type under the same parent in a plan
-- NULLS NOT DISTINCT ensures root nodes (parent_id IS NULL) are also deduplicated
ALTER TABLE plan_nodes
  ADD CONSTRAINT plan_nodes_unique_title_per_parent
  UNIQUE NULLS NOT DISTINCT (plan_id, parent_id, title, node_type);
