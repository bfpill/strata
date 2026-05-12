/** Custom detail-panel components for TmSpacePane.
 *
 *  A panel spec on a tm_space artifact may declare either:
 *    1. Legacy template+slice rendering: { label, figure, zarr_uri } (a Plotly
 *       template + one zarr array; the slice patches into the first trace).
 *    2. Custom component rendering: { label, component, zarr_group?, params? }
 *       referencing a name in TM_SPACE_PANEL_REGISTRY. The component receives
 *       the props below and is responsible for its own data loading.
 */
import type { ReactElement } from "react";

export interface TmSpacePanelProps {
  /** Index of the focused TM in the scatter (0..numPoints-1). */
  tmIndex: number;
  /** TM ID coordinate value (e.g. the integer in `tm` array). May equal tmIndex. */
  tmCoord: number;
  /** Optional zarr group URI from the panel spec; usually contains the
   *  arrays the component will fetch (e.g. `permuted_sus`, `partition_sizes`). */
  zarrGroup?: string;
  /** Optional component-specific parameters from the panel spec. */
  params?: Record<string, unknown>;
}

export type TmSpacePanelComponent = (props: TmSpacePanelProps) => ReactElement | null;
