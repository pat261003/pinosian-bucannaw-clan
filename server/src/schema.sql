CREATE TABLE IF NOT EXISTS persons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 first_name text NOT NULL CHECK(length(trim(first_name)) BETWEEN 1 AND 100),
 middle_name text NOT NULL DEFAULT '', last_name text NOT NULL CHECK(length(trim(last_name)) BETWEEN 1 AND 100),
 suffix text NOT NULL DEFAULT '', birth_date date NOT NULL CHECK(birth_date <= CURRENT_DATE),
 gender text NOT NULL CHECK(gender IN ('Male','Female','Other')),
 birth_place text NOT NULL DEFAULT '', current_location text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS unions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), person1_id uuid NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
 person2_id uuid NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(person1_id <> person2_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS unions_pair ON unions(LEAST(person1_id,person2_id),GREATEST(person1_id,person2_id));
CREATE INDEX IF NOT EXISTS unions_p1 ON unions(person1_id);
CREATE INDEX IF NOT EXISTS unions_p2 ON unions(person2_id);
CREATE TABLE IF NOT EXISTS parent_child_relationships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
 child_id uuid NOT NULL REFERENCES persons(id) ON DELETE RESTRICT, union_id uuid REFERENCES unions(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(parent_id,child_id), CHECK(parent_id <> child_id)
);
CREATE INDEX IF NOT EXISTS relationships_child ON parent_child_relationships(child_id);
CREATE INDEX IF NOT EXISTS relationships_union ON parent_child_relationships(union_id);
CREATE INDEX IF NOT EXISTS persons_birth ON persons(birth_date);
CREATE OR REPLACE FUNCTION validate_parent_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.union_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unions WHERE id=NEW.union_id AND NEW.parent_id IN(person1_id,person2_id)) THEN
  RAISE EXCEPTION 'Parent must belong to the recorded union' USING ERRCODE='23514';
 END IF;
 IF EXISTS (WITH RECURSIVE descendants(id) AS (
 SELECT child_id FROM parent_child_relationships WHERE parent_id=NEW.child_id
 UNION SELECT r.child_id FROM parent_child_relationships r JOIN descendants d ON r.parent_id=d.id
 ) SELECT 1 FROM descendants WHERE id=NEW.parent_id) THEN
  RAISE EXCEPTION 'Circular ancestry is not allowed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS parent_link_validation ON parent_child_relationships;
CREATE TRIGGER parent_link_validation BEFORE INSERT OR UPDATE ON parent_child_relationships FOR EACH ROW EXECUTE FUNCTION validate_parent_link();

-- Upgrade existing installations without deleting or replacing family data.
ALTER TABLE persons DROP CONSTRAINT IF EXISTS persons_first_name_check;
ALTER TABLE persons DROP CONSTRAINT IF EXISTS persons_last_name_check;
ALTER TABLE persons ALTER COLUMN first_name SET DEFAULT '';
ALTER TABLE persons ALTER COLUMN last_name SET DEFAULT '';
ALTER TABLE persons ALTER COLUMN birth_date DROP NOT NULL;
CREATE TABLE IF NOT EXISTS tree_revision (id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL DEFAULT 0);
INSERT INTO tree_revision(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION record_tree_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE tree_revision SET revision=revision+1 WHERE id=1;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS persons_revision ON persons;
CREATE TRIGGER persons_revision AFTER INSERT OR UPDATE OR DELETE ON persons FOR EACH STATEMENT EXECUTE FUNCTION record_tree_change();
DROP TRIGGER IF EXISTS unions_revision ON unions;
CREATE TRIGGER unions_revision AFTER INSERT OR UPDATE OR DELETE ON unions FOR EACH STATEMENT EXECUTE FUNCTION record_tree_change();
DROP TRIGGER IF EXISTS parents_revision ON parent_child_relationships;
CREATE TRIGGER parents_revision AFTER INSERT OR UPDATE OR DELETE ON parent_child_relationships FOR EACH STATEMENT EXECUTE FUNCTION record_tree_change();
ALTER TABLE persons DROP CONSTRAINT IF EXISTS persons_gender_check;
ALTER TABLE persons ADD CONSTRAINT persons_gender_check CHECK(gender IN ('Male','Female','Other','Unknown'));
CREATE TABLE IF NOT EXISTS app_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS clan_heads (person_id uuid PRIMARY KEY REFERENCES persons(id) ON DELETE RESTRICT, position integer NOT NULL UNIQUE);

-- Stable entry sequence and optional family birth order, preserving existing records.
CREATE SEQUENCE IF NOT EXISTS person_entry_sequence;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS entry_order bigint;
WITH ranked AS (SELECT id,row_number() OVER (ORDER BY created_at,id) AS n FROM persons)
UPDATE persons SET entry_order=ranked.n FROM ranked WHERE persons.id=ranked.id AND persons.entry_order IS NULL;
SELECT setval('person_entry_sequence',GREATEST(COALESCE((SELECT max(entry_order) FROM persons),0)+1,1),false);
ALTER TABLE persons ALTER COLUMN entry_order SET DEFAULT nextval('person_entry_sequence');
ALTER TABLE persons ALTER COLUMN entry_order SET NOT NULL;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS sibling_order integer CHECK(sibling_order > 0);
