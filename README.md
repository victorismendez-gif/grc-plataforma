# Plataforma GRC multinorma

Gestión de riesgos, cumplimiento y activos de información: normas y requisitos, GAP, planes de trabajo, riesgos,
terceros, auditoría (ISO 19011), acciones correctivas, tableros y reportes.

- **Diseño de producto:** documento «Plataforma GRC multinorma: diseño de producto».
- **Stack:** Next.js (TypeScript) en Netlify · Supabase (Postgres, Auth con doble factor, Storage).
- **Datos:** todas las tablas de negocio tienen `organization_id` y seguridad a nivel de fila.

## Estado por fases

| Fase | Alcance | Estado |
| --- | --- | --- |
| 1. Base | Repositorio, migraciones, ingreso con doble factor, roles, permisos en servidor, trazabilidad, CI/CD | Construida |
| 2. Núcleo | Activos, normas y requisitos importables, controles, gestión documental y políticas | Construida |
| 3. GAP y plan de trabajo | | Pendiente |
| 4. Riesgos | | Pendiente |
| 5. Terceros | | Pendiente |
| 6. Auditoría y acciones correctivas | | Pendiente |
| 7. Tablero, reportes y notificaciones | | Pendiente |
| 8. Cierre | Seguridad, copias, prueba del flujo completo, producción y guía del administrador | Pendiente |

## Seguridad (Fase 1)

- **Doble factor obligatorio (TOTP).** Sin sesión `aal2` la base no devuelve datos: `app.current_org_id()` es nula y
  todas las políticas dependen de ella.
- **Permisos en dos capas.** Cada página y acción de servidor llama `requirePermission(...)`; además, cada política RLS
  verifica `app.has_permission(...)`. La interfaz solo oculta lo que de todas formas el servidor niega.
- **Roles base:** administrador, líder de sistema, auditor, responsable de área y consulta (editables, salvo el
  administrador), más roles personalizados.
- **Trazabilidad inalterable.** `audit_log` es de solo inserción (disparadores bloquean `UPDATE`, `DELETE` y
  `TRUNCATE`), guarda valor anterior y nuevo, y encadena cada fila con SHA-256; `verify_audit_chain()` detecta
  alteraciones.
- **Reglas de integridad:** siempre queda al menos un administrador activo; el rol administrador no pierde permisos;
  nadie se desactiva a sí mismo.
- **Cuentas solo por invitación** (registro público deshabilitado) y contraseñas de 12+ caracteres.

## Núcleo (Fase 2)

- **Estructura:** sedes, sucursales, tiendas y áreas en jerarquía sin ciclos; procesos con dueño y unidades.
- **Activos:** inventario con dueño, custodio, unidad, clasificación (catálogo editable: Pública, Uso interno,
  Confidencial) y valoración C-I-D; la criticidad es el mayor de los tres. **Importación mensual desde Excel/CSV**: el
  archivo se lee en el navegador, `import_assets()` calcula nuevos, modificados (campo a campo), sin cambios y ausentes;
  solo escribe al confirmar, en una transacción, y deja historial de cargas. Las columnas no estándar se guardan como
  datos adicionales.
- **Normas y requisitos:** catálogo por organización, importación desde Excel (`import_requirements()` deduce la
  jerarquía por numeración) y estructura base de ISO/IEC 27001:2022 (cláusulas 4–10 y 93 controles del Anexo A con
  títulos parafraseados; el texto oficial requiere licencia ISO).
- **Controles:** tipo, naturaleza, frecuencia, implementación, calificación de diseño y eficacia; mapeo cruzado a
  requisitos de varias normas y a activos.
- **Documentos:** versiones con flujo elaborar → revisar → aprobar → publicar aplicado por `document_transition()`
  (quien elabora no revisa ni aprueba), archivo privado en Storage con huella SHA-256, una sola versión vigente, fecha de
  próxima revisión y enlace a requisitos como evidencia.
- **Políticas:** las publicadas que requieren aceptación se leen y aceptan por versión; cobertura por política.

## Desarrollo local

Requisitos: Node 22, Docker y la CLI de Supabase.

```bash
npm install
supabase start            # levanta Postgres, Auth y Storage locales; aplica migraciones y seed
cp .env.example .env.local  # pegar las llaves que imprime `supabase start`
npm run dev               # http://localhost:3000
```

Usuario de desarrollo: `admin@demo.local` / `Demo-Admin-2026!` (el doble factor se configura en el primer ingreso).

Pruebas:

```bash
npm run typecheck && npm test   # tipos y pruebas unitarias
supabase test db                # pruebas pgTAP de seguridad (RLS, aal2, permisos, trazabilidad)
```

## CI/CD (GitHub Actions)

- `ci.yml`: tipos, pruebas unitarias y compilación; Supabase local en Docker con migraciones, pruebas pgTAP y
  `db lint`; al integrar en `main`, aplica las migraciones pendientes en producción (si existen los secretos).
- `keepalive.yml`: consulta diaria para evitar la pausa por inactividad del plan gratuito.
- Netlify compila y publica automáticamente cada cambio en `main`.

Secretos del repositorio (Settings → Secrets and variables → Actions):

| Secreto | Uso |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Token personal de Supabase para aplicar migraciones |
| `SUPABASE_DB_PASSWORD` | Contraseña de la base de producción |

Variables de entorno en Netlify: ver `.env.example` y `docs/configuracion-produccion.md`.
