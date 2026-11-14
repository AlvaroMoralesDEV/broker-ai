-- Ofertas de hipoteca que le han dado al usuario los bancos (no las de mercado de data/rates.json).
CREATE TABLE IF NOT EXISTS bank_offers (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         text NOT NULL,
  bank       text NOT NULL,
  offer      jsonb NOT NULL,          -- ReceivedOffer de shared/offers.ts
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
