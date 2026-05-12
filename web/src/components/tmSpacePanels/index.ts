/** Registry of named React components for tm_space detail panels.
 *
 *  Reference one of these from a tm_space artifact spec by setting
 *  `detail_panels[i].component = "<name>"` (with optional `zarr_group`,
 *  `params`). The TmSpacePane will dispatch to the matching component when
 *  the panel tab is active.
 */
import { StructuralSusHeatmap } from "./StructuralSusHeatmap";
import { StructuralBlockSigmas } from "./StructuralBlockSigmas";
import type { TmSpacePanelComponent } from "./types";

export const TM_SPACE_PANEL_REGISTRY: Record<string, TmSpacePanelComponent> = {
  StructuralSusHeatmap,
  StructuralBlockSigmas,
};

export type { TmSpacePanelProps, TmSpacePanelComponent } from "./types";
