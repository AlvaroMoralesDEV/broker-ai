-- Varios usuarios en la misma instalación: cada uno con su perfil, conversaciones y viviendas.
-- Los datos que ya existían pasan al usuario 'default'.

CREATE TABLE IF NOT EXISTS users (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO users (id, name) VALUES ('default', 'Yo') ON CONFLICT (id) DO NOTHING;

-- perfil: una fila por usuario (antes, una sola fila con id = 1)
ALTER TABLE profile ADD COLUMN user_id text NOT NULL DEFAULT 'default' REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE profile DROP COLUMN id;
ALTER TABLE profile ADD PRIMARY KEY (user_id);
ALTER TABLE profile ALTER COLUMN user_id DROP DEFAULT;

ALTER TABLE profile_facts ADD COLUMN user_id text NOT NULL DEFAULT 'default' REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE profile_facts ALTER COLUMN user_id DROP DEFAULT;
CREATE INDEX IF NOT EXISTS profile_facts_user_idx ON profile_facts (user_id, id);

ALTER TABLE conversations ADD COLUMN user_id text NOT NULL DEFAULT 'default' REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE conversations ALTER COLUMN user_id DROP DEFAULT;
CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations (user_id, updated_at);

-- viviendas: dos usuarios pueden guardar el mismo anuncio, así que la clave pasa a ser (usuario, id)
ALTER TABLE home_prices DROP CONSTRAINT home_prices_home_id_fkey;
ALTER TABLE homes DROP CONSTRAINT homes_pkey;
ALTER TABLE homes ADD COLUMN user_id text NOT NULL DEFAULT 'default' REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE homes ADD PRIMARY KEY (user_id, id);
ALTER TABLE homes ALTER COLUMN user_id DROP DEFAULT;

ALTER TABLE home_prices ADD COLUMN user_id text NOT NULL DEFAULT 'default';
ALTER TABLE home_prices ADD FOREIGN KEY (user_id, home_id) REFERENCES homes (user_id, id) ON DELETE CASCADE;
ALTER TABLE home_prices ALTER COLUMN user_id DROP DEFAULT;
DROP INDEX IF EXISTS home_prices_home_idx;
CREATE INDEX IF NOT EXISTS home_prices_home_idx ON home_prices (user_id, home_id, seen_at);
