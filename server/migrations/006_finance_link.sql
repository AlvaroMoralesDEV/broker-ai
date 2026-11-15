-- Enlace con la app de Finanzas (docs/finance-architecture.md §7). Una fila por usuario del bróker.
-- Solo guarda el token que el usuario pegó y lo último que se leyó del objetivo de vivienda.
CREATE TABLE IF NOT EXISTS finance_links (
  user_id         text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token           text NOT NULL,
  -- finanzas: los ahorros salen de la app de Finanzas y mandan; manual: el usuario pidió ignorarla
  mode            text NOT NULL DEFAULT 'finanzas' CHECK (mode IN ('finanzas', 'manual')),
  goal            text,
  saved           double precision,
  target          double precision,
  monthly         double precision,
  finance_date    text,            -- fecha del último cambio en Finanzas (AAAA-MM-DD)
  synced_at       timestamptz,     -- última lectura correcta
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
