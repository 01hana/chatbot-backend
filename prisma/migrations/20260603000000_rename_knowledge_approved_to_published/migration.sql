UPDATE knowledge_entries
SET status = 'published'
WHERE status = 'approved';

UPDATE knowledge_documents
SET status = 'published'
WHERE status = 'approved';
