-- Notas del bróker: lo que conviene recordar entre conversaciones y no es un dato del perfil ni de una
-- vivienda concreta (por qué se descartó un piso, qué dijo un banco, qué decidió el usuario).
-- Una fila por nota y por usuario; se borran con el usuario.
CREATE TABLE IF NOT EXISTS broker_notes (
  id              bigserial PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic           text,                 -- vivienda | banco | decision | preferencia | otro
  note            text NOT NULL,
  conversation_id text,                 -- conversación en la que se apuntó (informativo)
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broker_notes_user_idx ON broker_notes (user_id, id);
