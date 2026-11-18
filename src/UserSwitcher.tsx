import { useState } from "react";
import { USER, switchUser, type useUsers } from "./lib.ts";

/**
 * Usuario de esta pestaña. Cada usuario tiene su perfil, conversaciones, viviendas y ofertas.
 * Sin contraseñas: está pensado para usarlo en tu ordenador (tú, tu pareja, alguien a quien asesoras).
 */
export function UserSwitcher({ store }: { store: ReturnType<typeof useUsers> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const current = store.current;
  const label = current?.name ?? "…";
  const initial = (n: string) => n.trim()[0]?.toUpperCase() ?? "?";
  const newTab = (id: string) => window.open(`${location.pathname}?u=${encodeURIComponent(id)}`, "_blank", "noopener");

  return (
    <div className="user-switch">
      <button className="user-current" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="user-initial" aria-hidden>
          {initial(label)}
        </span>
        <span className="user-name">{label}</span>
        <small>{open ? "Cerrar" : "Cambiar"}</small>
      </button>
      {open && (
        <div className="user-menu">
          <p className="eyebrow">Usuarios</p>
          {store.users.map((u) => (
            <div key={u.id} className={`user-row${u.id === USER ? " on" : ""}`}>
              <button className="user-pick" onClick={() => u.id !== USER && switchUser(u.id)} disabled={u.id === USER}>
                <span className="user-initial" aria-hidden>
                  {initial(u.name)}
                </span>
                {u.name}
                {u.id === USER && <small> · aquí</small>}
              </button>
              <button className="icon" title={`Abrir a ${u.name} en otra pestaña`} aria-label={`Abrir a ${u.name} en otra pestaña`} onClick={() => newTab(u.id)}>
                ↗
              </button>
            </div>
          ))}
          <form
            className="user-new"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) store.create(name.trim());
            }}
          >
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del nuevo usuario" maxLength={40} aria-label="Nombre del nuevo usuario" />
            <button type="submit" disabled={!name.trim()}>
              Crear
            </button>
          </form>
          <div className="row">
            <button
              className="link"
              onClick={() => {
                const n = prompt("Nuevo nombre", label);
                if (n?.trim()) store.rename(USER, n.trim());
              }}
            >
              Renombrar
            </button>
            {USER !== "default" && (
              <button
                className="link danger"
                onClick={() => confirm(`¿Borrar a ${label} y todos sus datos (perfil, conversaciones, viviendas y ofertas)? No se puede deshacer.`) && store.remove(USER)}
              >
                Borrar a {label}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
