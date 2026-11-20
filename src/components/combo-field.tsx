// Campo editable con sugerencias: se elige de la lista o se escribe un valor
// nuevo. Se usa para Responsable (usuarios) y Proceso (catálogo de procesos).
type Option = { id: string; label: string; code?: string | null };

export default function ComboField({
  name,
  label,
  value,
  options,
  placeholder,
  className,
  title,
}: {
  name: string;
  label: string;
  value?: string | null;
  options: Option[];
  placeholder?: string;
  className?: string;
  title?: string;
}) {
  const listId = `lista-${name}`;
  return (
    <label className={className} title={title}>
      {label}
      <input name={name} defaultValue={value ?? ""} list={listId} maxLength={name === "process" ? 160 : 120} placeholder={placeholder} autoComplete="off" />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.id} value={o.label}>
            {o.code && o.code !== o.label ? o.code : undefined}
          </option>
        ))}
      </datalist>
    </label>
  );
}
