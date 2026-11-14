-- El historial admite mensajes con rol 'system': son las «fotos» del contexto del usuario (perfil,
-- viviendas, notas, fecha) que el servidor añade a la conversación cuando algo ha cambiado.
--
-- Por qué: antes ese contexto iba dentro del prompt de sistema y se reescribía en cada petición. Eso
-- cambia el principio de todo lo que se envía a Claude, así que (1) la caché de prompt no servía para
-- el historial y (2) los bloques de razonamiento guardados dejaban de ser válidos, porque van ligados
-- al prompt de sistema con el que se generaron. Como mensaje añadido al final, el historial sigue
-- siendo «solo se añade» y lo anterior no cambia nunca.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;
ALTER TABLE messages ADD CONSTRAINT messages_role_check CHECK (role IN ('user', 'assistant', 'system'));
