// Contrato con la app de Finanzas (repositorio aparte, «finanzas»): lo único que el bróker lee de ella.
// Es una COPIA de shared/contract.ts de Finanzas; finance-contract.fixture.json es la misma respuesta de
// ejemplo en los dos repositorios. Si cambia el formato, se cambian los dos a la vez y se sube la versión.
// Solo el objetivo de vivienda: nunca saldos, movimientos, nóminas, suscripciones ni el resto del patrimonio.

/** GET /api/share/v1/housing con Authorization: Bearer <token>. */
export interface HousingShare {
  /** nombre del objetivo («Compra de vivienda») */
  goal: string;
  /** dinero asignado de verdad al objetivo, en euros */
  saved: number;
  /** importe objetivo, en euros */
  target: number;
  /** aportación mensual prevista, en euros (null si no la ha puesto) */
  monthlyContribution: number | null;
  /** fecha (AAAA-MM-DD) del último cambio del objetivo, de sus asignaciones o de los saldos de sus cuentas */
  updatedAt: string;
}

export const HOUSING_SHARE_PATH = "/api/share/v1/housing";
