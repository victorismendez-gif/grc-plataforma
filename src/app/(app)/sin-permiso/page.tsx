import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <section className="panel">
      <h1>No tienes permiso para esta sección</h1>
      <p className="muted">Si necesitas acceso, pídele al administrador que ajuste tus roles.</p>
      <Link href="/">Volver al inicio</Link>
    </section>
  );
}
