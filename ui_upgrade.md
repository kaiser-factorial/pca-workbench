# Phase 2 UI Upgrades: Themes, Tmux-Grid, and 2D Toggle

Based on your feedback, we will elevate this from a simple side-by-side layout to a full "Tmux-style" window tiling system that dynamically splits horizontally and vertically as you freeze more views. We will also integrate your `ccru` components for the Terminal theme and build a matching Bauhaus grid component for the Primary theme!

## User Review Required

> [!IMPORTANT]
> **Tmux-Style Tiling Logic**:
> I propose using `react-resizable-panels` to dynamically nest horizontal and vertical splits based on the number of pinned views:
> - 1 View: 100% full screen
> - 2 Views: 50/50 Horizontal split (side-by-side)
> - 3 Views: Left side 50%, Right side split 50/50 Vertically (stacked)
> - 4 Views: 2x2 Grid
> *Does this layout progression sound like what you had in mind for the Tmux behavior?*

## Proposed Changes

### 1. Tmux-y Multi-Pane Component (`BauhausGrid` & `CyberGrid`)
- **Install `react-resizable-panels`** and `ccru`.
- **Create `TmuxGrid` Wrapper**: A dynamic component that renders nested `<PanelGroup>` and `<Panel>` components based on an array of `pinnedViews`.
- **Primary Theme (`BauhausGrid`)**: When in Primary mode, the grid resize handles will feature the 3px thick black borders, primary color accents on hover (red/yellow), and hard shadows characteristic of the Bauhaus aesthetic. (This component can definitely be exported to your library later!).
- **Terminal Theme (`CyberGrid`)**: When in Terminal mode, we will wrap the panes in `ccru`'s `CyberContainer` and use `.vertical-neon-line` glowing dividers for the resize handles to match the `ccru` aesthetic.

### 2. Theming (Primary vs Terminal)
- **Install `next-themes`** to toggle a `data-theme` attribute.
- **Update `globals.css`** to include the CSS variables from both your `THEME_GUIDE.md` files.
- **Refactor `page.tsx`**: The main app wrapper will swap between the `BauhausGrid` and `CyberGrid` aesthetics depending on the active theme, and use standard CSS variables for all other UI elements (buttons, sidebars, text).

### 3. 2D vs 3D Visualization Toggle
- **State Addition**: Add a `viewMode` state (`'2D' | '3D'`).
- **Trace Logic**: Modify `getTraces()` to output `type: 'scatter'` instead of `scatter3d` when in 2D mode, dropping the Z-axis data.
- **Layout Logic**: Dynamically swap the Plotly layout object between 2D (standard Cartesian axes) and 3D (scene axes). Disable the auto-rotation feature when in 2D mode.

## Verification Plan
### Manual Verification
- Verify the Tmux grid correctly splits side-by-side on the first pin, and stacks vertically on the second pin.
- Verify the resize handles can be dragged to dynamically resize the tiled plots.
- Verify the `ccru` styling applies correctly in Terminal mode, and the thick borders apply in Primary mode.
- Verify the 2D toggle accurately flattens the visualization and renders standard 2D axes.
