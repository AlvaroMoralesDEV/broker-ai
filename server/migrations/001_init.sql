-- Esquema inicial: perfil con histórico, conversaciones y viviendas guardadas.

-- Perfil actual (una sola fila: aplicación de un solo usuario).
CREATE TABLE IF NOT EXISTS profile (
  id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data       jsonb NOT NULL,          -- campos de shared/finance.ts (Profile)
  extra      jsonb NOT NULL DEFAULT '{}'::jsonb, -- contrato, pagas, cotitular, zonas... (ProfileExtra)
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Cada cambio del perfil, para saber qué dijo el usuario y cuándo. Solo se añade, nunca se edita.
CREATE TABLE IF NOT EXISTS profile_facts (
  id              bigserial PRIMARY KEY,
  field           text NOT NULL,
  old_value       jsonb,
  new_value       jsonb,
  note            text,
  source          text NOT NULL,      -- chat | form | mcp | import
  conversation_id text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id         text PRIMARY KEY,
  title      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Mensajes tal y como se envían a la API de Claude (bloques de contenido incluidos).
CREATE TABLE IF NOT EXISTS messages (
  id              bigserial PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, id);

CREATE TABLE IF NOT EXISTS homes (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  price       integer NOT NULL,
  listing     jsonb NOT NULL,          -- campos de shared/listings.ts (Listing) + extras del anuncio
  status      text NOT NULL DEFAULT 'interesa'
              CHECK (status IN ('interesa', 'visitar', 'visitada', 'oferta', 'descartada')),
  notes       text,
  saved_verdict text,                  -- veredicto con el perfil del momento en que se guardó
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_prices (
  id       bigserial PRIMARY KEY,
  home_id  text NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  price    integer NOT NULL,
  seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS home_prices_home_idx ON home_prices (home_id, seen_at);
