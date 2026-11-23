import { getCatalog, getPeople, getProcesses } from "@/lib/lookups";
import { getAssetTypes, getScale } from "@/lib/asset-lookups";
import { SELF_TYPES } from "@/lib/asset-profiles";
import AssetFormClient, { type AssetValues } from "./asset-form-client";

export type AssetData = AssetValues & { id: string; code: string; name: string; asset_type_id: string; status: string };

/** Carga los catálogos en el servidor y entrega el formulario dinámico. */
export default async function AssetForm({
  asset,
  action,
  readOnly,
  selfService,
}: {
  asset?: AssetData;
  action: (fd: FormData) => Promise<void>;
  readOnly?: boolean;
  selfService?: boolean;
}) {
  const [allTypes, classes, people, processes, scale] = await Promise.all([
    getAssetTypes(),
    getCatalog("info_classification"),
    getPeople(),
    getProcesses(),
    getScale(),
  ]);
  const types = selfService ? allTypes.filter((t) => (SELF_TYPES as readonly string[]).includes(t.code)) : allTypes;
  return (
    <AssetFormClient
      asset={asset}
      types={types}
      classes={classes}
      people={people}
      processes={processes}
      scale={scale}
      action={action}
      readOnly={readOnly}
      selfService={selfService}
    />
  );
}
