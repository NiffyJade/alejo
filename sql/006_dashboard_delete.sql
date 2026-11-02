-- Let signed-in staff delete the answers they (or the starter set) put in the knowledge base (safe to re-run).
-- Hotel details (Wi-Fi password and the like) are cleared by setting their value to blank, which the update policy already allows.
drop policy if exists staff_delete_kb on knowledge_entries;
create policy staff_delete_kb on knowledge_entries for delete to authenticated using (is_staff());
