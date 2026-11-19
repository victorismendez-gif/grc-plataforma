export default function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (ok) return <div className="alert ok" role="status">{ok}</div>;
  return null;
}

export type FlashParams = Promise<{ error?: string; ok?: string }>;
