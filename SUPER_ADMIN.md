# CheckPro — Backoffice Super Admin

Este archivo documenta el acceso maestro a la plataforma CheckPro.

## Correo de acceso

```
alepolch@gmail.com
```

Solo esta cuenta puede entrar al backoffice en `/superadmin`.

## Cómo se protege la contraseña

**La contraseña NO se guarda en este repositorio.** Eso es intencional — es la práctica segura. Funciona así:

1. Al arrancar por primera vez, se llama **una sola vez** al endpoint `POST /api/superadmin/setup`.
2. El endpoint:
   - Crea el usuario `alepolch@gmail.com` en Supabase Auth (si no existe).
   - Le asigna una contraseña temporal aleatoria (que nadie ve).
   - Marca el correo como confirmado.
   - Crea el perfil con `role = 'super_admin'`.
   - Dispara un correo de "reset password" al propio `alepolch@gmail.com`.
3. Tú recibes el correo, haces clic en el enlace, y **defines tu contraseña** directamente en Supabase.

A partir de ahí, si olvidas la contraseña, usas el flujo normal:
- Vas a `/login`
- Clic en "Recuperar contraseña"
- Escribes `alepolch@gmail.com`
- Recibes correo, pones nueva contraseña.

**Esa es la única manera de restablecer la contraseña del super admin** — por correo, y solo quien controle `alepolch@gmail.com` puede hacerlo.

## Arranque inicial (una sola vez)

Después de desplegar la primera versión con este código:

### Opción A — Llamar el endpoint desde el navegador

1. Ir a `https://checkpro-self.vercel.app/api/superadmin/setup`
2. El navegador hará GET; si respondes "ready: false", está listo para ser ejecutado.
3. Desde la consola del navegador (F12):
   ```js
   fetch('/api/superadmin/setup', { method: 'POST' }).then(r => r.json()).then(console.log)
   ```
4. Revisar bandeja de entrada de `alepolch@gmail.com` → enlace de recovery.

### Opción B — desde Supabase directamente

Si el correo no llega (SMTP por defecto de Supabase tiene límite bajo), puedes:
1. Ir a Supabase Dashboard → Authentication → Users
2. Buscar `alepolch@gmail.com`
3. Clic en "..." → "Send magic link" o "Reset password"
4. Abrir el correo, poner nueva contraseña.

## Qué puedes hacer desde el backoffice

Una vez dentro con la cuenta super admin:

| Sección | URL | Qué hace |
|--------|-----|----------|
| Panel | `/superadmin` | Métricas globales: # empresas, usuarios, empleados, checadas hoy y 7 días. Top 5 empresas más activas. |
| Usuarios | `/superadmin/users` | Listar TODAS las cuentas admin, buscar por correo/nombre/empresa, suspender, reactivar, enviar reset password, confirmar correo, cambiar rol, eliminar. |
| Empresas | `/superadmin/tenants` | Listar TODAS las empresas, ver detalle (sus usuarios + sucursales + empleados), suspender, cambiar plan (free/pro/enterprise), eliminar con cascada. |
| Mapa | `/superadmin/sitemap` | Referencia visual de todas las pantallas del sistema. |
| Manuales | `/superadmin/docs` | Acceso a los PDFs de admin y empleados. |

## Acciones prohibidas

Por seguridad, el backoffice **NO** permite:
- Eliminar tu propia cuenta super_admin.
- Eliminar otra cuenta super_admin (debe hacerse desde Supabase Dashboard).
- Eliminar el tenant "CheckPro System" (slug `checkpro-system`).

## Endpoints API detrás del backoffice

Todos validan `role === 'super_admin'` via service_role antes de responder:

```
GET    /api/admin/stats                → agregados
GET    /api/admin/users?q=<search>     → lista usuarios
PATCH  /api/admin/users/:id            → disable/enable/reset/confirm/set_role
DELETE /api/admin/users/:id            → borrar cuenta
GET    /api/admin/tenants              → lista empresas
GET    /api/admin/tenants/:id          → detalle empresa
PATCH  /api/admin/tenants/:id          → active, name, plan
DELETE /api/admin/tenants/:id          → borrar con cascada
```

## Variables de entorno requeridas

Ninguna nueva. Usa las mismas del proyecto:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY   ← crítico para el backoffice
NEXT_PUBLIC_APP_URL
```

Si `SUPABASE_SERVICE_ROLE_KEY` no está puesta en Vercel, el backoffice no funciona.

## Seguridad — Lo importante

- Toda la verificación de rol pasa por el **servidor** (service_role), nunca confía en el cliente.
- Si alguien edita a mano `localStorage` para aparentar ser super_admin, los endpoints `/api/admin/*` lo rechazan en 403.
- El layout de React también redirige si el rol no coincide (defensa en profundidad).
- Los PDFs están en `/public/manuals/` → son públicos, cualquiera con el link los ve. Esto es OK porque son manuales compartibles.
