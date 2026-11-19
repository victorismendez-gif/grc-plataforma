# Configuración de producción

Proyecto Supabase: `grc-plataforma` (ref `dvggwzoyiqvlyzexjnqn`, región us-east-1, plan gratuito).

## 1. Supabase → Authentication

| Ajuste | Valor |
| --- | --- |
| Sign In / Providers → Email → *Allow new users to sign up* | Desactivado (solo invitación) |
| Sign In / Providers → Email → *Minimum password length* | 12, con minúsculas, mayúsculas, dígitos y símbolos |
| Multi-Factor → TOTP | Habilitado (enroll y verify) |
| URL Configuration → *Site URL* | URL de Netlify (por ejemplo `https://grc-plataforma.netlify.app`) |
| URL Configuration → *Redirect URLs* | `https://<sitio>/**` |

> **Correo.** Desde junio de 2026 los proyectos gratuitos con el correo predeterminado de Supabase no pueden editar
> plantillas, solo envían a miembros del equipo del proyecto y tienen un límite de 2 correos por hora. La aplicación
> funciona con las plantillas predeterminadas (la sesión llega en el fragmento `#` y la lee `/auth/sesion`). Para
> invitar a personas fuera del equipo hay que configurar un SMTP propio gratuito (Authentication → SMTP Settings);
> con él se pueden cargar las plantillas de `supabase/templates/`.

## 2. Netlify → Site configuration → Environment variables

| Variable | Valor | Alcance |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://dvggwzoyiqvlyzexjnqn.supabase.co` | Builds y funciones |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Llave publicable (`sb_publishable_…`) | Builds y funciones |
| `SUPABASE_SERVICE_ROLE_KEY` | Llave secreta (Project Settings → API Keys → *secret*) | Solo funciones, marcada como secreta |
| `NEXT_PUBLIC_SITE_URL` | URL pública del sitio | Builds y funciones |

## 3. Primer administrador

1. En Supabase → Authentication → Users → *Invite user*, invitar el correo del administrador.
2. Ejecutar en el editor SQL (una sola vez):

```sql
select app.bootstrap_organization('Nombre de la empresa', 'identificador-corto',
  (select id from auth.users where email = 'correo@empresa.com'), 'Nombre del administrador');
```

3. El administrador abre el enlace de invitación, configura el doble factor y define su contraseña. Desde ahí
   invita al resto del equipo en **Usuarios**.
