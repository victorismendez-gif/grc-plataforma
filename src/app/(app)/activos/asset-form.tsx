import { getCatalog, getPeople, getProcesses } from "@/lib/lookups";
import { getAssetTypes, getScale } from "@/lib/asset-lookups";
import AssetFormClient, { type AssetValues } from "./asset-form-client";

export type AssetData = AssetValues & { id: string; code: string; name: string; asset_type_id: string; status: string };

/** Carga los catálogos en el servidor y entrega el formulario dinámico. */
export default async function AssetForm({
  asset,
  processIds = [],
  action,
  readOnly,
}: {
  asset?: AssetData;
  processIds?: string[];
  action: (fd: FormData) => Promise<void>;
  readOnly?: boolean;
}) {
  const [types, classes, people, processes, scale] = await Promise.all([
    getAssetTypes(),
    getCatalog("info_classification"),
    getPeople(),
    getProcesses(),
    getScale(),
  ]);
  return (
    <AssetFormClient
      asset={asset}
      types={types}
      classes={classes}
      people={people}
      processes={processes}
      processIds={processIds}
      scale={scale}
      action={action}
      readOnly={readOnly}
    />
  );
}
