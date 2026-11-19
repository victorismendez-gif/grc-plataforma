// Campos de formulario reutilizables (componentes de servidor).
import type { Option, UnitOption } from "@/lib/lookups";

type SelectProps = {
  name: string;
  label: string;
  options: Option[] | UnitOption[];
  value?: string | null;
  empty?: string;
  required?: boolean;
};

export function SelectField({ name, label, options, value, empty = "—", required }: SelectProps) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={value ?? ""} required={required}>
        {!required && <option value="">{empty}</option>}
        {required && !value && (
          <option value="" disabled>
            Selecciona…
          </option>
        )}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {"depth" in o ? "  ".repeat(o.depth) : ""}
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function EnumField({
  name,
  label,
  map,
  value,
  empty,
}: {
  name: string;
  label: string;
  map: Record<string | number, string>;
  value?: string | number | null;
  empty?: string;
}) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={value === null || value === undefined ? "" : String(value)}>
        {empty !== undefined && <option value="">{empty}</option>}
        {Object.entries(map).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextField({
  name,
  label,
  value,
  required,
  type = "text",
  maxLength,
  wide,
  placeholder,
}: {
  name: string;
  label: string;
  value?: string | number | null;
  required?: boolean;
  type?: string;
  maxLength?: number;
  wide?: boolean;
  placeholder?: string;
}) {
  return (
    <label style={wide ? { flex: 1, minWidth: 240 } : undefined}>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value ?? ""}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
      />
    </label>
  );
}

export function TextArea({ name, label, value, rows = 3 }: { name: string; label: string; value?: string | null; rows?: number }) {
  return (
    <label style={{ flex: 1, minWidth: 280 }}>
      {label}
      <textarea name={name} defaultValue={value ?? ""} rows={rows} maxLength={5000} />
    </label>
  );
}
