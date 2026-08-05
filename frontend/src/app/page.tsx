"use client";
import { useEffect, useState, useRef, useMemo } from "react";
import { UploadCloud, Play, Square, Download, Pin, Layers, Monitor, X, Trash2 } from "lucide-react";
import dynamic from 'next/dynamic';
import { useTheme } from "next-themes";
import { TmuxGrid } from "@/components/TmuxGrid";
import { CyberStackGroup, CyberContainer, CyberPanel } from "ccru/components";
import { Accordion, AccordionItem, Separator } from "puxel";
import { readTable } from "@/lib/parse";
import { processUpload } from "@/lib/engine";
import { dbscan, kmeans, zscoreCellColumns, suggestStandardize, countImputed } from "@/lib/cluster";
import * as wsStore from "@/lib/workspaces";
import { AssistantPanel } from "@/components/AssistantPanel";
import type { AppBridge, ColumnProfile } from "@/lib/assistant";
import { GUIDE_TARGETS } from "@/lib/assistant";
import { correlation, compareGroups as statsCompareGroups, silhouetteByK, kDistancePercentiles } from "@/lib/stats";
import { runPCA, deriveRunLabel, sanitizeLabel, pcaColumnNames, type MissingReport, type MissingStrategy } from "@/lib/pca";
import { isIdentifierColumn, pickDefaultAxes, pickDefaultColorBy } from "@/lib/defaults";
import { InfoTip } from "@/components/InfoTip";
import { buildClusterCrosstab, buildClusterHeatmap, downloadClusterHeatmapPng, HEATMAP_PALETTES, sortClusterLabels, type BreakdownDirection, type HeatmapPalette } from "@/lib/clusterBreakdown";


const Plot = dynamic(() => import('@/components/PlotlyPlot'), { ssr: false });

// Working title — referenced everywhere the app names itself
const APP_NAME = "Scatter Lab";

const PrimaryCollapsible = ({ title, mode = 'top', defaultOpen = true, width, buttonPosition = 'right', children }: any) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    if (mode === 'side') {
        const buttonNode = (
            <button 
                onClick={() => setIsOpen(!isOpen)} 
                className={`w-9 flex-shrink-0 bg-[var(--border)] text-[var(--background)] flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer ${buttonPosition === 'right' ? 'border-l-[3px]' : 'border-r-[3px]'} border-[var(--background)]`}
            >
                <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: buttonPosition === 'right' ? 'rotate(180deg)' : 'none' }}>
                    {title} {isOpen ? (buttonPosition === 'right' ? '▸' : '◂') : (buttonPosition === 'right' ? '◂' : '▸')}
                </span>
            </button>
        );

        return (
            <div className="flex bg-[var(--background)]/90 backdrop-blur-md border-[3px] border-[var(--border)] shadow-[4px_4px_0px_#111111] overflow-hidden transition-all duration-200" style={{ width: isOpen ? width : 36, height: 'fit-content' }}>
                {buttonPosition === 'left' && buttonNode}
                <div className="flex-grow min-w-0 transition-opacity duration-200" style={{ opacity: isOpen ? 1 : 0, width: isOpen ? width - 36 : 0 }}>
                    <div className="p-3" style={{ width: width - 36 }}>
                        {children}
                    </div>
                </div>
                {buttonPosition === 'right' && buttonNode}
            </div>
        );
    }

    return (
        <div className="bg-[var(--background)]/90 backdrop-blur-md border-[3px] border-[var(--border)] shadow-[4px_4px_0px_#111111] transition-all duration-200 flex flex-col" style={{ width }}>
            <button 
                onClick={() => setIsOpen(!isOpen)} 
                className="w-full flex justify-between items-center p-2 bg-[var(--border)] text-[var(--background)] hover:opacity-80 transition-opacity cursor-pointer"
            >
                <span className="text-xs font-bold uppercase tracking-wider">{title}</span>
                <span className="text-[10px]">{isOpen ? '▼' : '▶'}</span>
            </button>
            <div className="overflow-hidden transition-all duration-200" style={{ maxHeight: isOpen ? 500 : 0, opacity: isOpen ? 1 : 0 }}>
                <div className="p-3">
                    {children}
                </div>
            </div>
        </div>
    );
};

// Legend swatch for the shape channel — mirrors the Plotly symbol names in
// SHAPE_SYMBOLS. Drawn rather than imported so it inherits the theme colour.
const SymbolGlyph = ({ symbol, color }: { symbol: string, color: string }) => {
    const open = symbol.endsWith('-open');
    const base = symbol.replace('-open', '');
    const fill = open ? 'none' : color;
    const p = { fill, stroke: color, strokeWidth: 1.5 };
    return (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="flex-shrink-0">
            {base === 'circle' && <circle cx="6" cy="6" r="4.2" {...p} />}
            {base === 'square' && <rect x="2" y="2" width="8" height="8" {...p} />}
            {base === 'diamond' && <path d="M6 1.4 L10.6 6 L6 10.6 L1.4 6 Z" {...p} />}
        </svg>
    );
};

const ThemedLegend = ({ view, theme, muted = {}, onToggle }: { view: any, theme: string | undefined, muted?: MuteMap, onToggle?: (val: any) => void }) => {
    const legendInfo = useMemo(() => {
        const colVals: any[] = view.data?.data?.[view.colorBy] ?? [];
        const kind = getColorFieldKind(colVals);
        if (kind === "categorical") {
            return { kind, values: sortCategories(Array.from(new Set(colVals.map((v: any) => v ?? "N/A")))) };
        }
        if (kind === "continuous") {
            let min = Infinity, max = -Infinity;
            for (const v of colVals) {
                if (v == null) continue;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            return { kind, min, max, values: [] };
        }
        return { kind, values: [] };
    }, [view.data, view.colorBy]);
    const colors = ['#4195DE', '#D23B72', '#FFD600', '#5F4690', '#1D6996', '#38A6A5', '#0F8554', '#73AF48', '#EDAD08', '#E17C05'];
    const textClass = theme === 'primary' ? 'text-[10px] font-bold text-[var(--foreground)]' : 'text-[10px] text-gray-300';

    // Shape is an independent channel, so it gets its own key below the colours.
    // Display-only: muting stays a colour concept (mutedMap is keyed by colour value).
    const shapeCats = useMemo(() => {
        const vals: any[] = view.shapeBy ? (view.data?.data?.[view.shapeBy] ?? []) : [];
        const cats = vals.length ? shapeCategories(vals) : [];
        return cats.length && cats.length <= MAX_SHAPE_CATEGORIES ? cats : [];
    }, [view.data, view.shapeBy]);
    const glyphColor = theme === 'primary' ? '#111111' : '#10ff50';

    const innerContent = legendInfo.kind === "continuous" ? (
        <div className="flex flex-col gap-1">
            <div className="h-3 w-full rounded-sm" style={{ background: 'linear-gradient(to right, #440154, #414487, #2a788e, #22a884, #7ad151, #fde725)' }} />
            <div className={`flex justify-between ${textClass}`}>
                <span>{Number(legendInfo.min).toFixed(2)}</span>
                <span>{Number(legendInfo.max).toFixed(2)}</span>
            </div>
        </div>
    ) : legendInfo.kind === "too-many" ? (
        <span className={textClass}>Too many categories to display</span>
    ) : (
        <div className="flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto">
            {legendInfo.values.map((val, i) => {
                const state = muted[String(val)];
                const nextAction = !state ? 'Mute' : state === 'muted' ? 'Hide' : 'Show';
                return (
                    <button
                        key={String(val)}
                        onClick={() => onToggle?.(val)}
                        title={`${nextAction} ${String(val)}`}
                        className="flex items-center gap-2 cursor-pointer group text-left bg-transparent border-0 p-0"
                    >
                        <div
                            className={`flex-shrink-0 rounded-full transition-transform duration-150 group-hover:scale-125 ${theme === 'primary' ? 'w-3 h-3 border-[2px]' : 'w-2.5 h-2.5 border'} ${state === 'hidden' ? 'border-dashed border-[#bbbbbb]' : state === 'muted' ? 'border-[#999999]' : (theme === 'primary' ? 'border-[var(--foreground)]' : 'border-transparent')}`}
                            style={{ backgroundColor: state ? 'transparent' : (String(val) === 'Noise' ? '#8a8a8a' : colors[i % colors.length]) }}
                        />
                        <span className={`truncate ${textClass} ${state === 'hidden' ? 'opacity-25 line-through' : state === 'muted' ? 'opacity-40' : ''}`} title={String(val)}>{String(val)}</span>
                    </button>
                );
            })}
        </div>
    );

    const shapeSection = shapeCats.length > 0 && (
        <div className="mt-3 pt-2 border-t border-current/15">
            <div className={`mb-1.5 opacity-60 uppercase tracking-wider ${textClass}`} title={view.shapeBy}>
                Shape · {view.shapeBy}
            </div>
            <div className="flex flex-col gap-1.5 max-h-[30vh] overflow-y-auto">
                {shapeCats.map((val, i) => (
                    <div key={val} className="flex items-center gap-2">
                        <SymbolGlyph symbol={SHAPE_SYMBOLS[i]} color={glyphColor} />
                        <span className={`truncate ${textClass}`} title={val}>{val}</span>
                    </div>
                ))}
            </div>
        </div>
    );

    if (theme === 'terminal') {
        return (
            <div className="absolute top-1/4 right-0 z-30">
                <CyberPanel id="legend-panel" title="Legend" width={200} collapseDirection="side" positionMode="relative" position={{x:0, y:0}} onDragStart={() => {}}>
                    <div className="p-3 w-full">
                        <div className="text-[10px] font-bold mb-2 uppercase tracking-widest text-[#10ff50]/70">{view.colorBy}</div>
                        {innerContent}
                        {shapeSection}
                    </div>
                </CyberPanel>
            </div>
        );
    }

    return (
        <div className="absolute top-1/4 right-0 z-30">
            <PrimaryCollapsible title={view.colorBy} mode="side" width={200}>
                {innerContent}
                {shapeSection}
            </PrimaryCollapsible>
        </div>
    );
};

const ThemedNotes = ({ notes, setNotes, theme }: { notes: string, setNotes: any, theme: string | undefined }) => {
    const innerContent = (
        <div className="w-full h-full p-1">
            <textarea 
                value={notes} 
                onChange={e => setNotes(e.target.value)}
                placeholder="Add observations here..."
                className={`w-full h-full bg-transparent outline-none resize-none text-sm ${theme === 'primary' ? 'text-[var(--foreground)]' : 'text-[#10ff50]'}`}
            />
        </div>
    );

    if (theme === 'terminal') {
        return (
            <div className="absolute top-1/4 left-0 z-30 [&>div>div>.flex]:flex-row-reverse [&>div>div>.flex]:gap-2">
                <CyberPanel id="notes-panel" title="Notes" width={280} collapseDirection="side" positionMode="relative" position={{x:0, y:0}} defaultOpen={false} onDragStart={() => {}}>
                    <div className="p-3 w-full h-64">
                        {innerContent}
                    </div>
                </CyberPanel>
            </div>
        );
    }
    
    return (
        <div className="absolute top-1/4 left-0 z-30">
            <PrimaryCollapsible title="Notes" mode="side" width={280} buttonPosition="left" defaultOpen={false}>
                <div className="w-full h-64">
                    {innerContent}
                </div>
            </PrimaryCollapsible>
        </div>
    );
};

// Columnar table as returned by /api/upload: one array per column
type DataTable = { columns: string[], data: Record<string, any[]>, nRows: number };

// Which table columns feed the plot; z is null for purely 2D data
type Axes = { x: string, y: string, z: string | null };
type AxisLabels = { x: string, y: string, z: string };

type Axes2D = { x: string, y: string };

// Provenance of one PCA run: which variables went in, what came out, when.
// Identity is the label — re-running a label replaces its registry entry and
// its columns. The column NAME stays short (PC1_openness / COMP_openness);
// everything else about the run lives here, not in the name.
type PcaRun = {
    label: string;            // '' = the unnamed bare-PC1..PCk run
    columns: string[];
    variables: string[];
    k: number;
    standardize: boolean;
    savedAt: string;
    varianceExplained: number[];
    missing?: MissingReport;
};

// One sentence naming what happened to the incomplete rows. Returns '' when
// there were none, so a complete dataset says nothing at all.
const missingNote = (rep: MissingReport | undefined, nRows: number): string => {
    if (!rep || !rep.byVariable.length) return '';
    const worst = rep.byVariable.slice(0, 3).map(m => `${m.var} ${m.n}/${nRows}`).join(', ');
    const more = rep.byVariable.length > 3 ? `, +${rep.byVariable.length - 3} more` : '';
    if (rep.strategy === 'complete') {
        return ` Complete cases only: ${rep.rowsDropped} of ${nRows} rows were dropped for having a gap, leaving ${rep.rowsUsed} — ${worst}${more}. Those rows have no score.`;
    }
    const pct = (rep.imputedCells / Math.max(rep.totalCells, 1)) * 100;
    return ` ${rep.imputedCells} of ${rep.totalCells} cells (${pct < 0.1 ? '<0.1' : pct.toFixed(1)}%) were missing and filled with the column median — ${worst}${more}.`;
};

// A cached upload: processed table, upload-time profile, and its plot-axis choices.
// 3D (axes) and 2D (axes2d) are independent so picking a 2D pair never disturbs
// the 3D triple. labels are display overrides — they default to the column names.
type Dataset = {
    id: number, name: string, table: DataTable, summary: any,
    axes: Axes, labels: AxisLabels,
    axes2d: Axes2D, labels2d: Axes2D,
    pcaRuns?: PcaRun[],
};

type InitialUploadView = {
    axes: Axes;
    colorBy: string;
    shapeBy?: string;
    viewMode?: "2D" | "3D";
};

// The axes a view actually plots, given its mode
const effectiveAxes = (d: Dataset, mode: "3D" | "2D"): Axes =>
    mode === "2D" ? { x: d.axes2d.x, y: d.axes2d.y, z: null } : d.axes;
const effectiveLabels = (d: Dataset, mode: "3D" | "2D"): AxisLabels =>
    mode === "2D" ? { x: d.labels2d.x, y: d.labels2d.y, z: 'Z' } : d.labels;

const numericColumns = (table: DataTable) =>
    table.columns.filter(c => (table.data[c] ?? []).some(v => typeof v === 'number'));

const defaultLabels = (axes: Axes): AxisLabels => ({ x: axes.x, y: axes.y, z: axes.z ?? 'Z' });

// Above these cardinalities, one-trace-per-value plotting freezes the tab on real datasets
const CONTINUOUS_UNIQUE_THRESHOLD = 20;
const MAX_CATEGORIES = 50;

// Numeric column with many distinct values → treat as continuous (colorscale, not per-value traces)
const getColorFieldKind = (values: any[]): "categorical" | "continuous" | "too-many" => {
    const seen = new Set();
    let allNumeric = true;
    for (const v of values) {
        if (v == null) continue;
        if (typeof v !== 'number') allNumeric = false;
        seen.add(v);
        if (allNumeric && seen.size > CONTINUOUS_UNIQUE_THRESHOLD) return "continuous";
        if (!allNumeric && seen.size > MAX_CATEGORIES) return "too-many";
    }
    return "categorical";
};

// Legend mute cycle: normal → 'muted' (hollow grey outline) → 'hidden' (gone) → normal
type MuteState = 'muted' | 'hidden';
type MuteMap = Record<string, MuteState>;

// Categories sort numerically-aware with Noise last, in BOTH traces and legend,
// so palette index i lines up between them and stays stable across re-runs
const sortCategories = (vals: any[]) => [...vals].sort((a, b) => {
    const A = String(a), B = String(b);
    if (A === 'Noise') return 1;
    if (B === 'Noise') return -1;
    return A.localeCompare(B, undefined, { numeric: true });
});

// Marker symbols understood by BOTH scatter and scatter3d, so switching modes
// never changes what a shape means. Filled glyphs lead, then their open twins.
// cross/x are deliberately absent: scatter3d draws them as line glyphs at a much
// heavier visual weight than the filled shapes, which reads as "these points are
// bigger" — shape must not imply magnitude. Shape is a low-cardinality channel
// anyway (past ~5 levels the glyphs stop being tellable apart), so the list is
// also the cap.
const SHAPE_SYMBOLS = ['circle', 'square', 'diamond', 'circle-open', 'square-open', 'diamond-open'];
const MAX_SHAPE_CATEGORIES = SHAPE_SYMBOLS.length;

// scatter3d renders square/diamond glyphs with a much smaller footprint than
// circles at the same marker.size. These calibrated values equalize the visual
// diameter without inflating ordinary circle markers or 2D plots.
const markerSizeFor = (mode: "3D" | "2D", symbol?: string) => {
    if (mode === "2D") return 6;
    if (symbol?.includes('diamond')) return 8;
    if (symbol?.includes('square')) return 7;
    if (symbol === 'circle-open') return 5;
    return 4;
};

const shapeCategories = (vals: any[]) =>
    sortCategories(Array.from(new Set(vals.map((v: any) => String(v ?? 'N/A')))));

const buildTraces = (table: DataTable | null, colorField: string, mode: "3D" | "2D", axes: Axes, labels: AxisLabels, muted: MuteMap = {}, dark = false, shapeField = "") => {
    if (!table || table.nRows === 0) return [];
    const n = table.nRows;
    const px = table.data[axes.x] ?? [];
    const py = table.data[axes.y] ?? [];
    const pz = axes.z ? (table.data[axes.z] ?? []) : new Array(n).fill(0);
    const colorVals = table.data[colorField] ?? [];

    // Shape is a second, independent categorical channel. Plotly takes one symbol
    // per trace, so an active shape variable splits each colour group further —
    // hence the hard cardinality cap, which also keeps the glyphs distinguishable.
    const shapeVals = shapeField ? (table.data[shapeField] ?? []) : [];
    const shapeCats = shapeField ? shapeCategories(shapeVals) : [];
    const shapeOn = shapeCats.length > 0 && shapeCats.length <= MAX_SHAPE_CATEGORIES;
    const symbolFor: Record<string, string> = {};
    if (shapeOn) shapeCats.forEach((v, i) => { symbolFor[v] = SHAPE_SYMBOLS[i]; });
    const shapeAt = (i: number) => (shapeOn ? String(shapeVals[i] ?? 'N/A') : null);

    const traces: any[] = [];
    const colors = ['#4195DE', '#D23B72', '#FFD600', '#5F4690', '#1D6996', '#38A6A5', '#0F8554', '#73AF48', '#EDAD08', '#E17C05'];
    const hovertemplate = mode === "3D"
        ? `${labels.x}: %{x:.2f}<br>${labels.y}: %{y:.2f}<br>${labels.z}: %{z:.2f}<extra></extra>`
        : `${labels.x}: %{x:.2f}<br>${labels.y}: %{y:.2f}<extra></extra>`;

    const kind = getColorFieldKind(colorVals);

    if (kind === "categorical") {
        // Palette index comes from the colour categories alone, so adding a shape
        // variable subdivides traces without shifting anybody's colour
        const colorCats = sortCategories(Array.from(new Set(colorVals.map((v: any) => v ?? "N/A"))));
        const colorIdx = new Map(colorCats.map((v, i) => [String(v), i]));
        const grouped: Record<string, { x: any[], y: any[], z: any[], color: any, shape: string | null }> = {};
        for (let i = 0; i < n; i++) {
            const cval = colorVals[i] ?? "N/A";
            const sval = shapeAt(i);
            const key = sval == null ? String(cval) : `${cval}␟${sval}`;
            const g = (grouped[key] ??= { x: [], y: [], z: [], color: cval, shape: sval });
            g.x.push(px[i]);
            g.y.push(py[i]);
            g.z.push(pz[i]);
        }
        // Colour-major, then shape — keeps trace order aligned with the legend
        const groups = Object.values(grouped).sort((a, b) => {
            const ca = colorIdx.get(String(a.color)) ?? 0, cb = colorIdx.get(String(b.color)) ?? 0;
            if (ca !== cb) return ca - cb;
            return shapeCats.indexOf(a.shape ?? '') - shapeCats.indexOf(b.shape ?? '');
        });
        groups.forEach(g => {
            // Muted/hidden categories keep their trace slot so colors don't shift:
            // 'muted' renders hollow with a thin grey outline, 'hidden' is invisible
            const key = String(g.color);
            const state = muted[key];
            const i = colorIdx.get(key) ?? 0;
            const symbol = g.shape ? symbolFor[g.shape] : undefined;
            // Hollowing out only works for fillable glyphs — the -open symbols draw
            // in the marker colour, so a transparent fill would erase them entirely.
            // Those mute to a grey ghost instead, which keeps the shape readable.
            const mutedMarker = symbol?.endsWith('-open')
                ? { color: '#999999', opacity: 0.3 }
                : { color: 'rgba(0,0,0,0)', opacity: 0.5, line: { color: '#999999', width: 1 } };
            traces.push({
                x: g.x,
                y: g.y,
                z: mode === "3D" ? g.z : undefined,
                visible: state !== 'hidden',
                mode: 'markers',
                type: mode === "3D" ? 'scatter3d' : 'scatter',
                name: g.shape ? `${key} · ${g.shape}` : key,
                marker: {
                    size: markerSizeFor(mode, symbol),
                    ...(symbol ? { symbol } : {}),
                    ...(state === 'muted'
                        ? mutedMarker
                        : { color: key === 'Noise' ? '#8a8a8a' : colors[i % colors.length], opacity: key === 'Noise' ? 0.35 : 0.7 }),
                },
                hovertemplate
            });
        });
    } else {
        // Single trace: the columnar arrays go to Plotly as-is, no reshaping.
        // Continuous fields get a Viridis colorscale, overflowing categoricals a flat color.
        // A shape variable splits this into one trace per symbol; the colorscale is
        // then pinned to the full range so the split traces stay directly comparable.
        let cmin = Infinity, cmax = -Infinity;
        if (kind === "continuous") {
            for (const v of colorVals) {
                if (typeof v !== 'number') continue;
                if (v < cmin) cmin = v;
                if (v > cmax) cmax = v;
            }
        }
        const markerFor = (vals: any[], symbol?: string) => ({
            size: markerSizeFor(mode, symbol),
            opacity: 0.7,
            ...(kind === "continuous"
                ? { color: vals, colorscale: 'Viridis', showscale: false, cmin, cmax }
                : { color: '#4195DE' })
        });
        const base = {
            mode: 'markers',
            type: mode === "3D" ? 'scatter3d' : 'scatter',
            hovertemplate
        };
        if (!shapeOn) {
            traces.push({ ...base, x: px, y: py, z: mode === "3D" ? pz : undefined, name: colorField, marker: markerFor(colorVals) });
        } else {
            const buckets: Record<string, { x: any[], y: any[], z: any[], c: any[] }> = {};
            for (let i = 0; i < n; i++) {
                const sval = shapeAt(i)!;
                const b = (buckets[sval] ??= { x: [], y: [], z: [], c: [] });
                b.x.push(px[i]); b.y.push(py[i]); b.z.push(pz[i]); b.c.push(colorVals[i]);
            }
            shapeCats.filter(s => buckets[s]).forEach(s => {
                const b = buckets[s];
                traces.push({
                    ...base,
                    x: b.x, y: b.y, z: mode === "3D" ? b.z : undefined,
                    name: s,
                    marker: { ...markerFor(b.c, symbolFor[s]), symbol: symbolFor[s] },
                });
            });
        }
    }

    if (mode === "3D") {
        // Single pass for bounds — spreading large arrays into Math.min/max blows the call stack.
        // Hidden categories are excluded so they don't stretch the axes or cast shadows.
        const hasHidden = kind === "categorical" && Object.values(muted).includes('hidden');
        let x_min = Infinity, x_max = -Infinity, y_min = Infinity, y_max = -Infinity, z_min = Infinity, z_max = -Infinity;
        const shadow_x: number[] = [], shadow_y: number[] = [];
        for (let i = 0; i < n; i++) {
            if (hasHidden && muted[String(colorVals[i] ?? "N/A")] === 'hidden') continue;
            if (px[i] != null) {
                if (px[i] < x_min) x_min = px[i];
                if (px[i] > x_max) x_max = px[i];
            }
            if (py[i] != null) {
                if (py[i] < y_min) y_min = py[i];
                if (py[i] > y_max) y_max = py[i];
            }
            if (pz[i] != null) {
                if (pz[i] < z_min) z_min = pz[i];
                if (pz[i] > z_max) z_max = pz[i];
            }
            if (px[i] != null && py[i] != null) {
                shadow_x.push(px[i]);
                shadow_y.push(py[i]);
            }
        }
        if (x_min === Infinity || y_min === Infinity || z_min === Infinity) return traces;
        // Proportional floor offset: a fixed -0.5 dwarfed small-range axes
        // (e.g. rates in [0, 0.4]), shoving the data into the middle of the axis
        const z_span = z_max - z_min;
        const z_floor = z_min - (z_span > 0 ? z_span * 0.08 : 0.5);

        // The shadow floor must contrast with the canvas: near-black on light
        // themes, pale gray on the terminal theme's black background
        const shadowColor = dark ? '#d8d8d8' : '#111111';
        traces.push({
            x: shadow_x,
            y: shadow_y,
            z: new Array(shadow_x.length).fill(z_floor),
            mode: 'markers',
            type: 'scatter3d',
            marker: { size: 2, color: shadowColor, opacity: 0.1 },
            showlegend: false,
            hoverinfo: 'skip'
        });

        traces.push({
            x: [x_min, x_max, x_max, x_min],
            y: [y_min, y_min, y_max, y_max],
            z: [z_floor, z_floor, z_floor, z_floor],
            type: 'mesh3d',
            color: shadowColor,
            opacity: 0.05,
            showlegend: false,
            hoverinfo: 'skip'
        });
    }

    return traces;
};

const CHART_COLORS = ['#4195DE', '#D23B72', '#FFD600', '#5F4690', '#1D6996', '#38A6A5', '#0F8554', '#73AF48', '#EDAD08', '#E17C05'];

// Inline distribution sparkline for a numeric column
const MiniHistogram = ({ values, color }: { values: any[], color: string }) => {
    const bars = useMemo(() => {
        const nums = values.filter(v => typeof v === 'number' && !Number.isNaN(v));
        if (nums.length < 2) return null;
        let min = Infinity, max = -Infinity;
        for (const v of nums) { if (v < min) min = v; if (v > max) max = v; }
        if (min === max) return null;
        const N = 14;
        const counts = new Array(N).fill(0);
        for (const v of nums) counts[Math.min(N - 1, Math.floor(((v - min) / (max - min)) * N))]++;
        const peak = Math.max(...counts);
        return counts.map(c => c / peak);
    }, [values]);
    if (!bars) return null;
    return (
        <svg width="56" height="16" className="flex-shrink-0 opacity-80" aria-hidden="true">
            {bars.map((h, i) => (
                <rect key={i} x={i * 4} y={16 - Math.max(1, h * 16)} width="3" height={Math.max(1, h * 16)} fill={color} />
            ))}
        </svg>
    );
};

// Proportion bar of the top categories for a categorical column
const MiniCatBar = ({ values }: { values: any[] }) => {
    const segs = useMemo(() => {
        const counts = new Map<string, number>();
        let total = 0;
        for (const v of values) {
            if (v == null) continue;
            const k = String(v);
            counts.set(k, (counts.get(k) ?? 0) + 1);
            total++;
        }
        if (!total) return null;
        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([k, c]) => ({ k, frac: c / total }));
    }, [values]);
    if (!segs) return null;
    let acc = 0;
    return (
        <svg width="56" height="16" className="flex-shrink-0 opacity-80" aria-hidden="true">
            {segs.map((s, i) => {
                const x = acc * 56;
                acc += s.frac;
                return <rect key={s.k} x={x} y={4} width={Math.max(1, s.frac * 56 - 1)} height={8} fill={CHART_COLORS[i % CHART_COLORS.length]} />;
            })}
        </svg>
    );
};

// One row per column: profile (kind, range, missing, sparkline) plus one-click
// plot assignment — X/Y/Z axis for numeric columns, C (color) for any column.
// This is the app's data inspector and its variable picker in one surface.
const VariablesPanel = ({ dataset, viewMode, colorBy, shapeBy, theme, onAxis, onColor, onShape }: {
    dataset: Dataset, viewMode: "3D" | "2D", colorBy: string, shapeBy: string, theme: string | undefined,
    onAxis: (axis: 'x' | 'y' | 'z', col: string) => void, onColor: (col: string) => void, onShape: (col: string) => void,
}) => {
    const table = dataset.table;
    const axes = viewMode === "2D" ? { ...dataset.axes2d, z: null as string | null } : dataset.axes;
    const profiles = useMemo(() => table.columns.map(col => {
        const vals = table.data[col] ?? [];
        let missing = 0, isNumeric = false, min = Infinity, max = -Infinity;
        const distinct = new Set<any>();
        for (const v of vals) {
            if (v == null) { missing++; continue; }
            if (typeof v === 'number') { isNumeric = true; if (v < min) min = v; if (v > max) max = v; }
            distinct.add(v);
        }
        return { col, vals, missing, isNumeric, min, max, nUnique: distinct.size };
    }), [table]);

    const fmt = (v: number) => Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2).replace(/\.?0+$/, '');
    // Assignment buttons carry the Bauhaus triad in primary; terminal goes green
    const AXIS_STYLE: Record<string, string> = { x: 'var(--p-red)', y: 'var(--p-blue)', z: 'var(--p-yellow)', c: 'var(--p-black)', s: 'var(--p-white)' };
    const activeStyle = (slot: string) => theme === 'primary'
        ? { backgroundColor: AXIS_STYLE[slot], color: slot === 'z' || slot === 's' ? '#111111' : '#FFFFFF', borderColor: '#111111' }
        : { backgroundColor: 'var(--system-green)', color: '#000000', borderColor: 'var(--system-green)' };

    const slotTitle = (slot: string, col: string, active: boolean) =>
        slot === 'c' ? `Color by ${col}`
        : slot === 's' ? (active ? `Stop encoding ${col} as marker shape` : `Encode ${col} as marker shape`)
        : `Plot ${col} on the ${slot.toUpperCase()} axis`;

    const slotBtn = (slot: 'x' | 'y' | 'z' | 'c' | 's', p: { col: string }, active: boolean, disabled = false) => (
        <button
            key={slot}
            disabled={disabled}
            onClick={() => slot === 'c' ? onColor(p.col) : slot === 's' ? onShape(p.col) : onAxis(slot, p.col)}
            title={slotTitle(slot, p.col, active)}
            className="w-5 h-5 text-[9px] font-bold uppercase border flex items-center justify-center transition-colors disabled:opacity-20 cursor-pointer"
            style={active ? activeStyle(slot) : { borderColor: 'var(--border)', opacity: 0.45 }}
        >
            {slot}
        </button>
    );

    return (
        <div className="space-y-0.5 max-h-[380px] overflow-y-auto pr-1 -mr-1">
            {profiles.map(p => {
                const kind = p.isNumeric ? null : getColorFieldKind(p.vals);
                return (
                    <div key={p.col} className="flex items-center gap-2 py-1.5 border-b border-[var(--border)]/15">
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold truncate" title={p.col}>{p.col}</div>
                            <div className="text-[10px] opacity-50 truncate">
                                {p.isNumeric
                                    ? `${fmt(p.min)} – ${fmt(p.max)}`
                                    : `${p.nUnique} categories`}
                                {p.missing > 0 && ` · ${p.missing} NA`}
                            </div>
                        </div>
                        {p.isNumeric
                            ? <MiniHistogram values={p.vals} color={theme === 'primary' ? '#0045AD' : '#10ff50'} />
                            : <MiniCatBar values={p.vals} />}
                        <div className="flex gap-0.5 flex-shrink-0">
                            {p.isNumeric && slotBtn('x', p, axes.x === p.col)}
                            {p.isNumeric && slotBtn('y', p, axes.y === p.col)}
                            {p.isNumeric && viewMode === "3D" && slotBtn('z', p, axes.z === p.col)}
                            {kind !== 'too-many' && slotBtn('c', p, colorBy === p.col)}
                            {/* Shape only reads at low cardinality — offered for any
                                column inside the cap, numeric Likert scales included */}
                            {p.nUnique > 1 && p.nUnique <= MAX_SHAPE_CATEGORIES && slotBtn('s', p, shapeBy === p.col)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// First-run landing: an abstract scatter built from the Bauhaus glyphs, three
// steps, and a zero-friction demo loader. Occupies the otherwise-blank canvas.
const EmptyState = ({ theme, onLoadDemo, onUpload, busy }: { theme: string | undefined, onLoadDemo: () => void, onUpload: () => void, busy: boolean }) => {
    const steps = [
        "Add a dataset — CSV, XLSX, or Parquet",
        "Assign variables to X · Y · Z and color",
        "Cluster, pin comparisons, export",
    ];

    if (theme === 'terminal') {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <div className="max-w-md w-full mx-6 border border-[var(--system-green)]/40 bg-black/60 p-8 space-y-5">
                    <div className="text-[var(--system-green)] text-lg font-bold tracking-widest uppercase system-green-glow">Awaiting data_</div>
                    <div className="space-y-2">
                        {steps.map((s, i) => (
                            <div key={i} className="flex gap-3 text-sm text-[var(--foreground)]">
                                <span className="text-[var(--system-green)] flex-shrink-0">[{i + 1}]</span>
                                <span>{s}</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onUpload}
                            disabled={busy}
                            className="flex-1 py-2 text-sm font-bold bg-[var(--system-green)]/15 border border-[var(--system-green)] text-[var(--system-green)] hover:bg-[var(--system-green)]/25 disabled:opacity-40 cursor-pointer"
                        >
                            {"> upload data"}
                        </button>
                        <button
                            onClick={onLoadDemo}
                            disabled={busy}
                            className="flex-1 py-2 text-sm font-bold border border-[var(--system-green)]/60 text-[var(--system-green)]/80 hover:bg-[var(--system-green)]/10 disabled:opacity-40 cursor-pointer"
                        >
                            {busy ? "loading…" : "> load demo"}
                        </button>
                    </div>
                    <p className="text-[11px] text-[var(--foreground)]/60">
                        New here? Open the <span className="text-[var(--system-green)]">Assistant</span> (bottom right) and ask for a tour.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex items-center justify-center">
            <div className="max-w-md w-full mx-6 bg-white border-[3px] border-[#111111] shadow-[8px_8px_0px_#111111] p-8 space-y-6">
                <svg viewBox="0 0 336 120" className="w-full" aria-hidden="true">
                    {/* faint grid */}
                    {Array.from({ length: 7 }, (_, i) => (
                        <line key={`v${i}`} x1={i * 56} y1="0" x2={i * 56} y2="120" stroke="#111111" strokeOpacity="0.08" />
                    ))}
                    {Array.from({ length: 4 }, (_, i) => (
                        <line key={`h${i}`} x1="0" y1={i * 40} x2="336" y2={i * 40} stroke="#111111" strokeOpacity="0.08" />
                    ))}
                    {/* three loose clusters of the three glyphs */}
                    {[[38, 84], [62, 96], [50, 70], [82, 88], [70, 108]].map(([x, y], i) => (
                        <rect key={`sq${i}`} x={x - 6} y={y - 6} width="12" height="12" fill="#0045AD" stroke="#111111" strokeWidth="2" />
                    ))}
                    {[[168, 34], [192, 22], [180, 50], [210, 40], [156, 54]].map(([x, y], i) => (
                        <circle key={`ci${i}`} cx={x} cy={y} r="7" fill="#EB1A26" stroke="#111111" strokeWidth="2" />
                    ))}
                    {[[272, 78], [296, 92], [284, 62], [310, 72], [264, 100]].map(([x, y], i) => (
                        <path key={`tr${i}`} d={`M ${x - 8} ${y + 6} L ${x} ${y - 8} L ${x + 8} ${y + 6} Z`} fill="#FFD600" stroke="#111111" strokeWidth="2" />
                    ))}
                </svg>
                <div>
                    <h2 className="text-lg font-bold leading-tight">See the shape of your data.</h2>
                    <p className="text-xs opacity-60 mt-1">Plot any variables in 2D or 3D, color by anything, find the clusters.</p>
                </div>
                <div className="space-y-2.5">
                    {steps.map((s, i) => (
                        <div key={i} className="flex items-center gap-3 text-sm">
                            <span className="bauhaus-step" style={{ backgroundColor: STEP_COLORS[i].bg, color: STEP_COLORS[i].fg }}>{i + 1}</span>
                            <span>{s}</span>
                        </div>
                    ))}
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={onUpload}
                        disabled={busy}
                        className="bauhaus-btn flex-1 py-2.5 text-sm font-bold bg-[var(--p-blue)] text-white disabled:opacity-40 cursor-pointer"
                    >
                        Upload data
                    </button>
                    <button
                        onClick={onLoadDemo}
                        disabled={busy}
                        className="bauhaus-btn flex-1 py-2.5 text-sm font-bold bg-[var(--p-yellow)] text-[#111111] disabled:opacity-40 cursor-pointer"
                    >
                        {busy ? "Loading…" : "Load demo data"}
                    </button>
                </div>
                <p className="text-[11px] opacity-50 text-center -mt-2">
                    New here? Open the <span className="font-bold">Assistant</span> (bottom right) and ask for a tour.
                </p>
            </div>
        </div>
    );
};

// In-app PCA: pick variables, pick k, run — scores land as PC columns and the
// scree bars show what each component buys you.
const PCASection = ({ table, datasetId, theme, lastRun, runs, onRun }: {
    table: DataTable,
    datasetId: number,
    theme: string | undefined,
    lastRun: { varianceExplained: number[]; cumulative: number[] } | null,
    runs: PcaRun[],
    onRun: (vars: string[], k: number, standardize: boolean, label: string, missing: MissingStrategy) => void,
}) => {
    // Component columns (bare or labeled) don't feed new PCAs; COMP_ composites
    // stay selectable on purpose — feeding composites into a second-order PCA
    // is a legitimate technique.
    const numericVars = useMemo(
        () => numericColumns(table).filter(c => !/^PC\d+(_|$)/.test(c) && c !== 'Cluster'),
        [table]
    );
    const [selected, setSelected] = useState<Set<string>>(() => new Set(numericVars));
    const [k, setK] = useState(3);
    const [standardize, setStandardize] = useState(true);
    const [missing, setMissing] = useState<MissingStrategy>('median');
    const [label, setLabel] = useState('');
    // Auto-suggest tracks the selection until the user types a label of their
    // own; a cleared field re-arms the suggestion.
    const labelTouched = useRef(false);
    // Replacement confirm: what's waiting for an OK, and whether the user has
    // opted out of being asked (persisted).
    const [pendingRun, setPendingRun] = useState<{ vars: string[]; k: number; standardize: boolean; label: string; missing: MissingStrategy; replaces: string[] } | null>(null);
    // New dataset → fresh default selection and label. A mere table change
    // (a run adding columns) must NOT reset — that would wipe the user's
    // subset selection mid-iteration — it only prunes columns that vanished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setSelected(new Set(numericVars)); setLabel(''); labelTouched.current = false; }, [datasetId]);
    const varsKey = numericVars.join('\u0000');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setSelected(prev => new Set(Array.from(prev).filter(c => numericVars.includes(c)))); }, [varsKey]);
    useEffect(() => {
        if (labelTouched.current) return;
        setLabel(selected.size === numericVars.length ? '' : (deriveRunLabel(Array.from(selected)) ?? ''));
    }, [selected, numericVars.length]);

    // Per-variable missingness for the picker. methods.ts (pca_workflow) advises
    // dropping columns above ~50% missing rather than imputing them — at that
    // level an imputed column is mostly one repeated value, which enters the
    // correlation matrix as a near-constant.
    const missingPct = useMemo(() => {
        const out: Record<string, number> = {};
        for (const c of numericVars) {
            const vals = table.data[c] ?? [];
            let have = 0;
            for (const v of vals) if (typeof v === 'number') have++;
            out[c] = table.nRows ? (1 - have / table.nRows) * 100 : 0;
        }
        return out;
    }, [numericVars, table]);
    const heavilyMissing = Array.from(selected).filter(c => (missingPct[c] ?? 0) > 50);
    // Rows with no gap across the current selection — what complete-case would keep.
    const completeRows = useMemo(() => {
        const sel = Array.from(selected).filter(c => numericVars.includes(c));
        if (!sel.length) return table.nRows;
        let count = 0;
        for (let i = 0; i < table.nRows; i++) {
            if (sel.every(c => typeof (table.data[c] ?? [])[i] === 'number')) count++;
        }
        return count;
    }, [selected, numericVars, table]);

    const toggle = (c: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(c)) next.delete(c); else next.add(c);
        return next;
    });
    const maxK = Math.max(1, Math.min(10, selected.size));
    const screeMaxBarHeight = lastRun
        ? Math.max(...lastRun.varianceExplained.map(v => v * 100 * 1.4))
        : 0;
    // Reserve the label line too. A high-variance first component should grow
    // the chart rather than spilling out of a fixed-height bar box.
    const screeHeight = Math.max(56, Math.ceil(screeMaxBarHeight) + 18);

    const submit = () => {
        const vars = Array.from(selected).filter(c => numericVars.includes(c));
        const cleanLabel = sanitizeLabel(label);
        const effK = Math.min(k, maxK);
        const existing = runs.find(r => r.label === cleanLabel);
        const suppressed = typeof localStorage !== 'undefined' && localStorage.getItem('scatterlab.pca.confirmReplace') === 'off';
        if (existing && !suppressed) {
            setPendingRun({ vars, k: effK, standardize, label: cleanLabel, missing, replaces: existing.columns });
            return;
        }
        onRun(vars, effK, standardize, cleanLabel, missing);
    };

    return (
        <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
                <span className="opacity-60">{selected.size}/{numericVars.length} variables</span>
                <span className="flex gap-2">
                    <button onClick={() => setSelected(new Set(numericVars))} className="underline-offset-2 hover:underline opacity-60 hover:opacity-100 cursor-pointer">all</button>
                    <button onClick={() => setSelected(new Set())} className="underline-offset-2 hover:underline opacity-60 hover:opacity-100 cursor-pointer">none</button>
                </span>
            </div>
            <div className="max-h-36 overflow-y-auto space-y-0.5 pr-1 border border-[var(--border)]/30 p-1.5">
                {numericVars.map(c => {
                    const miss = missingPct[c] ?? 0;
                    return (
                        <label key={c} className="flex items-center gap-2 cursor-pointer hover:opacity-80">
                            <input type="checkbox" checked={selected.has(c)} onChange={() => toggle(c)} />
                            <span className="truncate flex-1" title={c}>{c}</span>
                            {miss > 0 && (
                                <span
                                    className={`flex-shrink-0 text-[10px] ${miss > 50 ? 'font-bold text-[var(--p-red)]' : 'opacity-50'}`}
                                    title={`${miss.toFixed(0)}% of rows are missing this variable`}
                                >
                                    {miss.toFixed(0)}% NA
                                </span>
                            )}
                        </label>
                    );
                })}
                {numericVars.length === 0 && <div className="opacity-50 p-1">No numeric variables available.</div>}
            </div>
            <label className="flex justify-between items-center">
                <span className="opacity-70">Components: <b>{Math.min(k, maxK)}</b>{Math.min(k, maxK) === 1 ? ' (composite)' : ''}</span>
                <input type="range" min={1} max={maxK} step={1} value={Math.min(k, maxK)} onChange={e => setK(parseInt(e.target.value))} className="w-32" />
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={standardize} onChange={e => setStandardize(e.target.checked)} />
                <span className="opacity-80">Standardize variables (correlation PCA)</span>
                <InfoTip topic="standardize_pca" />
            </label>
            <input
                type="text"
                value={label}
                onChange={e => { labelTouched.current = e.target.value.trim().length > 0; setLabel(e.target.value); }}
                placeholder={selected.size < numericVars.length ? 'name this run (e.g. openness)' : 'run label (optional)'}
                title={'Names this run\'s columns: 1 component → COMP_<label>; several → PC1_<label>… Re-running the same label replaces its columns; different labels coexist, so subsets like "openness" and "neuroticism" can each keep their own scores. Empty = plain PC1…PCk.'}
                className="w-full bg-[var(--input)] border border-[var(--border)] p-1.5 text-xs outline-none"
            />
            {label && sanitizeLabel(label) && (
                <div className="text-[10px] opacity-50">
                    → {pcaColumnNames(sanitizeLabel(label), Math.min(k, maxK)).join(', ')}
                </div>
            )}
            <div className="space-y-1">
                <span className="opacity-70">Missing values<InfoTip topic="median_imputation" /></span>
                <div className="flex gap-1">
                    {([['median', 'Median impute'], ['complete', 'Complete cases']] as const).map(([v, lbl]) => (
                        <button
                            key={v}
                            onClick={() => setMissing(v)}
                            className={`flex-1 py-1 text-[10px] font-bold border ${missing === v
                                ? 'bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]'
                                : 'bg-[var(--input)] border-[var(--border)] opacity-60 hover:opacity-100'}`}
                        >
                            {lbl}
                        </button>
                    ))}
                </div>
                {missing === 'complete' && (
                    <div className={`text-[10px] leading-snug ${completeRows < 3 ? 'text-[var(--p-red)]' : 'opacity-60'}`}>
                        {completeRows} of {table.nRows} rows have no gaps in this selection
                        {completeRows < table.nRows && ' — the rest will have no score'}.
                    </div>
                )}
            </div>
            {heavilyMissing.length > 0 && (
                <div className="text-[10px] leading-snug text-[var(--p-red)]">
                    ⚠ {heavilyMissing.map(c => `"${c}"`).join(', ')} {heavilyMissing.length === 1 ? 'is' : 'are'} over 50% missing.
                    Imputing that much makes a column mostly one repeated value; dropping it is usually better than filling it.
                </div>
            )}
            <button
                onClick={submit}
                disabled={selected.size < 2}
                className={`w-full text-sm font-bold py-2 disabled:opacity-40 cursor-pointer ${theme === 'primary' ? 'bauhaus-btn bg-[var(--p-blue)] text-white' : 'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)] text-[var(--mauk)]'}`}
            >
                Run PCA
            </button>
            <p className="text-[10px] leading-snug opacity-60">
                Missing values are filled with the column median before the decomposition.
                <InfoTip topic="median_imputation" />
            </p>
            {pendingRun && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => setPendingRun(null)}>
                    <div
                        className={`max-w-sm w-full mx-4 p-4 space-y-3 text-xs bg-[var(--card)] text-[var(--foreground)] ${theme === 'primary' ? 'border-[3px] border-[var(--p-black)]' : 'border border-[var(--system-green)]'}`}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="font-bold text-sm">
                            Replace {pendingRun.label ? `"${pendingRun.label}"` : 'the unnamed PCA'}?
                        </div>
                        <p className="opacity-80">
                            A previous run with this label exists — running again replaces its
                            column{pendingRun.replaces.length > 1 ? 's' : ''} ({pendingRun.replaces.join(', ')}).
                            Use a different label to keep both.
                        </p>
                        <label className="flex items-center gap-2 cursor-pointer select-none opacity-70">
                            <input
                                type="checkbox"
                                onChange={e => localStorage.setItem('scatterlab.pca.confirmReplace', e.target.checked ? 'off' : 'on')}
                            />
                            Don't ask again
                        </label>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setPendingRun(null)}
                                className="px-3 py-1.5 border border-[var(--border)] hover:bg-[var(--border)] cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => { onRun(pendingRun.vars, pendingRun.k, pendingRun.standardize, pendingRun.label, pendingRun.missing); setPendingRun(null); }}
                                className={`px-3 py-1.5 font-bold cursor-pointer ${theme === 'primary' ? 'bauhaus-btn bg-[var(--p-red)] text-white' : 'bg-[var(--system-green)]/20 border border-[var(--system-green)] text-[var(--system-green)]'}`}
                            >
                                Replace
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {lastRun && (
                <div className="space-y-1 pt-1 border-t border-[var(--border)]/40">
                    <div className="font-bold uppercase tracking-wider opacity-60 text-[10px]">
                        Variance explained<InfoTip topic="variance_explained" />
                    </div>
                    <div className="flex items-end gap-1" style={{ height: `${screeHeight}px` }}>
                        {lastRun.varianceExplained.map((v, i) => (
                            <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`PC${i + 1}: ${(v * 100).toFixed(1)}% (cumulative ${(lastRun.cumulative[i] * 100).toFixed(1)}%)`}>
                                <div className="w-full" style={{ height: `${Math.max(2, v * 100 * 1.4)}px`, backgroundColor: theme === 'primary' ? 'var(--p-blue)' : 'var(--system-green)', opacity: 0.85 }} />
                                <span className="text-[9px] opacity-60">{i + 1}</span>
                            </div>
                        ))}
                    </div>
                    <div className="text-[10px] opacity-70">
                        {lastRun.varianceExplained.map((v, i) => `PC${i + 1} ${(v * 100).toFixed(0)}%`).join(' · ')} — cumulative {(lastRun.cumulative[lastRun.cumulative.length - 1] * 100).toFixed(0)}%
                    </div>
                </div>
            )}
        </div>
    );
};

// Cluster × attribute cross-tab: per cluster, what share each attribute value
// holds. Pure client-side compute over the columnar table.
const ClusterBreakdown = ({ table, attr, onAttrChange, direction, onDirectionChange, palette, onPaletteChange }: {
    table: DataTable, attr: string, onAttrChange: (v: string) => void,
    direction: BreakdownDirection, onDirectionChange: (v: BreakdownDirection) => void,
    palette: HeatmapPalette, onPaletteChange: (v: HeatmapPalette) => void,
}) => {
    // 'cluster': composition within each cluster (denominator = cluster size).
    // 'group': where each attribute group's members land (denominator = group size) —
    // normalizes away base rates, so dominant groups stop swamping every cluster.
    const [isSaving, setIsSaving] = useState(false);
    const candidates = useMemo(
        () => table.columns.filter(c => c !== 'Cluster' && getColorFieldKind(table.data[c] ?? []) === 'categorical'),
        [table]
    );
    const effAttr = candidates.includes(attr) ? attr : candidates[0];
    const crosstab = useMemo(() => effAttr ? buildClusterCrosstab(table, effAttr) : null, [table, effAttr]);

    if (!crosstab || !effAttr) return null;
    const sections = direction === 'cluster' ? crosstab.byCluster : crosstab.byGroup;
    const sectionKeys = direction === 'cluster'
        ? Object.keys(sections).sort(sortClusterLabels)
        : Object.keys(sections).sort((a, b) => sections[b].total - sections[a].total || a.localeCompare(b));
    const saveHeatmap = async () => {
        if (isSaving) return;
        setIsSaving(true);
        try {
            await downloadClusterHeatmapPng({
                heatmap: buildClusterHeatmap(crosstab, direction),
                attribute: effAttr,
                palette,
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-2 text-xs border-t border-[var(--border)] pt-3 mt-1">
            <div className="flex items-center justify-between gap-2">
                <span className="font-bold uppercase tracking-wider opacity-60 text-[10px] flex-shrink-0">Cluster Info by</span>
                <select
                    className="flex-1 min-w-0 bg-[var(--input)] border border-[var(--border)] p-1 text-xs outline-none"
                    value={effAttr}
                    onChange={e => onAttrChange(e.target.value)}
                >
                    {candidates.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
            <div className="flex gap-1">
                {(['cluster', 'group'] as const).map(d => (
                    <button
                        key={d}
                        onClick={() => onDirectionChange(d)}
                        className={`flex-1 py-1 text-[10px] font-bold border ${direction === d ? 'bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]' : 'bg-[var(--input)] border-[var(--border)] opacity-60 hover:opacity-100'}`}
                    >
                        % of {d}
                    </button>
                ))}
            </div>
            <div className="flex gap-1.5">
                <select
                    aria-label="Heatmap palette"
                    className="min-w-0 flex-1 bg-[var(--input)] border border-[var(--border)] p-1 text-[10px] outline-none"
                    value={palette}
                    onChange={e => onPaletteChange(e.target.value as HeatmapPalette)}
                >
                    {HEATMAP_PALETTES.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
                <button
                    onClick={saveHeatmap}
                    disabled={isSaving}
                    className="flex items-center justify-center gap-1 whitespace-nowrap border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-[10px] font-bold hover:bg-[var(--foreground)] hover:text-[var(--background)] disabled:opacity-40"
                    title="Download the selected cluster composition as a PNG heatmap"
                >
                    <Download className="h-3 w-3" /> {isSaving ? 'Saving…' : 'Save heatmap'}
                </button>
            </div>
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                {sectionKeys.map(sk => {
                    const { total, counts } = sections[sk];
                    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
                    return (
                        <div key={sk} className="leading-snug">
                            <div className="font-bold">{sk} <span className="opacity-50 font-normal">· n={total}</span></div>
                            {rows.slice(0, 8).map(([val, cnt]) => (
                                <div key={val} className="relative flex justify-between gap-2 px-1">
                                    <div className="absolute inset-y-0 left-0 bg-[var(--foreground)]/8" style={{ width: `${(cnt / total) * 100}%` }} />
                                    <span className="relative truncate opacity-80" title={val}>{val}</span>
                                    <span className="relative flex-shrink-0 opacity-70">{Math.round((cnt / total) * 100)}% <span className="opacity-60">({cnt})</span></span>
                                </div>
                            ))}
                            {rows.length > 8 && <div className="opacity-50 px-1">… +{rows.length - 8} more</div>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// Copy a column (typically a Cluster label) from another dataset into the active
// one, so e.g. romance-space points can be colored by sex-space clusters. The
// alignment guard matters: silently mis-joining respondents yields wrong science.
type TransferSpec = { sourceId: number, sourceCol: string, mode: 'order' | 'match', keyCol: string, name: string };
const ColumnTransfer = ({ datasets, activeId, onTransfer }: { datasets: Dataset[], activeId: number | null, onTransfer: (s: TransferSpec) => void }) => {
    const active = datasets.find(d => d.id === activeId) ?? null;
    const others = datasets.filter(d => d.id !== activeId);
    const [sourceId, setSourceId] = useState<number | null>(null);
    const [sourceCol, setSourceCol] = useState("");
    const [mode, setMode] = useState<'order' | 'match'>('order');
    const [keyCol, setKeyCol] = useState("");
    const [name, setName] = useState("");

    const src = others.find(d => d.id === sourceId) ?? others[0] ?? null;
    if (!active || !src) return null;

    const srcCols = src.table.columns;
    const effSrcCol = srcCols.includes(sourceCol) ? sourceCol : (srcCols.includes('Cluster') ? 'Cluster' : srcCols[0]);
    const shared = src.table.columns.filter(c => active.table.columns.includes(c));
    const effKey = shared.includes(keyCol) ? keyCol : shared[0];
    const countsMatch = src.table.nRows === active.table.nRows;
    const defaultName = `${effSrcCol}·${src.name}`;

    // Auto alignment probe (order mode): pick a stable identity/demographic column
    // to sanity-check row order — NOT a PC/axis score, which is recomputed per
    // dataset and will legitimately differ even when respondents ARE aligned.
    const probe = useMemo(() => {
        if (mode !== 'order' || !shared.length || !countsMatch) return null;
        const isAxisLike = (c: string) => /^(PC\d|Axis|Component)/i.test(c);
        const idLike = shared.find(c => /\bid\b/i.test(c) && !isAxisLike(c));
        const categoricalCandidates = shared.filter(c => !isAxisLike(c) && getColorFieldKind(src.table.data[c] ?? []) === 'categorical');
        const best = idLike ?? categoricalCandidates
            .map(c => ({ c, distinct: new Set(src.table.data[c]).size }))
            .sort((a, b) => b.distinct - a.distinct)[0]?.c;
        if (!best) return null;
        const a = src.table.data[best], b = active.table.data[best];
        let agree = 0;
        for (let i = 0; i < active.table.nRows; i++) if (String(a[i]) === String(b[i])) agree++;
        return { col: best, agree, total: active.table.nRows };
    }, [mode, shared, countsMatch, src, active]);

    const matchStats = useMemo(() => {
        if (mode !== 'match' || !effKey) return null;
        const sk = src.table.data[effKey], tk = active.table.data[effKey];
        const srcKeys = new Set(sk.map(String));
        const uniqueSrc = srcKeys.size === src.table.nRows;
        let matched = 0;
        for (let i = 0; i < active.table.nRows; i++) if (srcKeys.has(String(tk[i]))) matched++;
        return { matched, total: active.table.nRows, uniqueSrc };
    }, [mode, effKey, src, active]);

    const canTransfer = mode === 'order' ? countsMatch : (!!effKey && (matchStats?.matched ?? 0) > 0);

    return (
        <div className="space-y-2 text-xs border-t border-[var(--border)] pt-3 mt-1">
            <div className="font-bold uppercase tracking-wider opacity-60 text-[10px]">Transfer column from another dataset</div>
            <div className="flex items-center gap-1.5">
                <span className="opacity-60 w-10 flex-shrink-0">From</span>
                <select className="flex-1 min-w-0 bg-[var(--input)] border border-[var(--border)] p-1 outline-none" value={src.id} onChange={e => setSourceId(Number(e.target.value))}>
                    {others.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
            </div>
            <div className="flex items-center gap-1.5">
                <span className="opacity-60 w-10 flex-shrink-0">Column</span>
                <select className="flex-1 min-w-0 bg-[var(--input)] border border-[var(--border)] p-1 outline-none" value={effSrcCol} onChange={e => setSourceCol(e.target.value)}>
                    {srcCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
            <div className="flex gap-1">
                <button onClick={() => setMode('order')} className={`flex-1 py-1 text-[10px] font-bold border ${mode === 'order' ? 'bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]' : 'bg-[var(--input)] border-[var(--border)] opacity-60'}`}>By row order</button>
                <button onClick={() => setMode('match')} disabled={!shared.length} className={`flex-1 py-1 text-[10px] font-bold border disabled:opacity-30 ${mode === 'match' ? 'bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]' : 'bg-[var(--input)] border-[var(--border)] opacity-60'}`}>Match by column</button>
            </div>
            {mode === 'match' && (
                <div className="flex items-center gap-1.5">
                    <span className="opacity-60 w-10 flex-shrink-0">Key</span>
                    <select className="flex-1 min-w-0 bg-[var(--input)] border border-[var(--border)] p-1 outline-none" value={effKey} onChange={e => setKeyCol(e.target.value)}>
                        {shared.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
            )}
            {/* alignment feedback */}
            {mode === 'order' && (
                countsMatch ? (
                    <div className="opacity-70">
                        {active.table.nRows} rows, aligned by position.
                        {probe && <span className={probe.agree === probe.total ? ' text-green-600' : ' text-red-500'}> {' '}Check ({probe.col}): {probe.agree}/{probe.total} agree {probe.agree === probe.total ? '✓' : '⚠'}</span>}
                    </div>
                ) : (
                    <div className="text-red-500">Row counts differ ({src.table.nRows} vs {active.table.nRows}) — use Match by column.</div>
                )
            )}
            {mode === 'match' && matchStats && (
                <div className={matchStats.matched === matchStats.total ? 'text-green-600' : 'opacity-70'}>
                    {matchStats.matched}/{matchStats.total} rows matched{!matchStats.uniqueSrc && <span className="text-red-500"> · ⚠ key not unique in source</span>}
                </div>
            )}
            <div className="flex items-center gap-1.5">
                <span className="opacity-60 w-10 flex-shrink-0">Save as</span>
                <input type="text" className="flex-1 min-w-0 bg-[var(--input)] border border-[var(--border)] p-1" value={name} onChange={e => setName(e.target.value)} placeholder={defaultName} />
            </div>
            <button
                onClick={() => onTransfer({ sourceId: src.id, sourceCol: effSrcCol, mode, keyCol: effKey, name: name.trim() || defaultName })}
                disabled={!canTransfer}
                className="w-full py-1.5 text-xs font-bold border border-[var(--border)] bg-[var(--input)] hover:bg-[var(--border)] disabled:opacity-30"
            >
                Transfer →
            </button>
        </div>
    );
};

// Memoizes trace construction so camera/rotation re-renders don't rebuild the
// (potentially large) data arrays every frame — Plotly.react then diffs cheaply.
// Module-level (not inside Home): inline component definitions get a fresh
// identity per render, so React remounts their whole subtree on every state
// change — losing input focus and recreating plot divs.
// Ephemeral on-screen pointer: scrolls the target into view, then rings it and
// bounces an arrow beside it for ~5s. Position is re-read on an interval so it
// tracks sidebar scrolling and layout shifts while visible.
const GUIDE_SECTION: Record<string, string> = {
    workspace: 'workspace',
    'upload-dropzone': 'data',
    'add-dataset': 'data',
    'components-toggle': 'data',
    'datasets-list': 'data',
    variables: 'variables',
    pca: 'pca',
    cluster: 'cluster',
    view: 'view',
    export: 'export',
};

const flashGuide = (target: string, color: string): boolean => {
    let el = document.querySelector(`[data-guide="${target}"]`) as HTMLElement | null;
    // Puxel's Accordion only mounts an item's body while open. When the
    // assistant is aiming at a hidden control, open its titled section first
    // and let the ring move from that header to the actual target on render.
    if (!el) {
        const section = GUIDE_SECTION[target];
        el = section ? document.querySelector(`[data-guide="${section}"]`) as HTMLElement | null : null;
        const trigger = el?.closest('[data-scatter-section]')?.querySelector<HTMLButtonElement>('.px-accordion-trigger');
        if (trigger?.getAttribute('aria-expanded') === 'false') trigger.click();
    }
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const ring = document.createElement('div');
    const arrow = document.createElement('div');
    ring.style.cssText = `position:fixed;z-index:95;pointer-events:none;border:3px solid ${color};box-shadow:0 0 0 3px rgba(255,214,0,.4);border-radius:4px;`;
    arrow.textContent = '◀';
    arrow.style.cssText = `position:fixed;z-index:95;pointer-events:none;color:${color};font-size:22px;font-weight:bold;text-shadow:0 1px 3px rgba(0,0,0,.35);`;
    document.body.append(ring, arrow);
    const place = () => {
        const current = document.querySelector(`[data-guide="${target}"]`) as HTMLElement | null ?? el;
        const r = current.getBoundingClientRect();
        // generous padding so the target sits fully inside the ring
        const pad = 12;
        ring.style.left = `${r.left - pad}px`;
        ring.style.top = `${r.top - pad}px`;
        ring.style.width = `${r.width + pad * 2}px`;
        ring.style.height = `${r.height + pad * 2}px`;
        arrow.style.left = `${r.right + pad + 6}px`;
        arrow.style.top = `${r.top + r.height / 2 - 13}px`;
    };
    place();
    const tracker = setInterval(place, 100);
    ring.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 900, iterations: 6 });
    arrow.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 600, iterations: 9 });
    setTimeout(() => { clearInterval(tracker); ring.remove(); arrow.remove(); }, 5400);
    return true;
};

// Steps cycle through the Bauhaus triad; yellow flips to black text for contrast
const STEP_COLORS = [
    { bg: 'var(--p-red)', fg: '#FFFFFF' },
    { bg: 'var(--p-blue)', fg: '#FFFFFF' },
    { bg: 'var(--p-yellow)', fg: '#111111' },
];

// Keep an opened sidebar section in view without turning every accordion click
// into a distracting recenter. Extra-tall sections align their header instead:
// no scroll position can make an oversized panel fully visible at once.
const revealOpenedSidebarSection = (event: { target: EventTarget | null }, section: HTMLElement) => {
    const trigger = event.target instanceof Element ? event.target.closest('button') : null;
    if (!trigger) return;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const expanded = trigger.getAttribute('aria-expanded') === 'true' || trigger.textContent?.trim() === '▾';
        if (!expanded) return;
        const sidebar = section.closest('aside');
        if (!sidebar) return;
        const frame = sidebar.getBoundingClientRect();
        const box = section.getBoundingClientRect();
        const inset = 12;
        const top = frame.top + inset;
        const bottom = frame.bottom - inset;
        const availableHeight = bottom - top;
        let delta = 0;
        if (box.height > availableHeight) delta = box.top - top;
        else if (box.bottom > bottom) delta = box.bottom - bottom;
        else if (box.top < top) delta = box.top - top;
        if (Math.abs(delta) > 1) sidebar.scrollBy({ top: delta, behavior: 'smooth' });
    }));
};

// CyberContainer exposes only its tiny chevron as a toggle. Make the complete
// header a forgiving pointer target while retaining the package button for
// keyboard access and its aria-expanded state.
const toggleTerminalSectionFromHeader = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const header = target?.closest('header');
    const toggle = header?.querySelector<HTMLButtonElement>('button[type="button"]');
    if (header && toggle && !target?.closest('button')) toggle.click();
    revealOpenedSidebarSection(event, event.currentTarget);
};

const SidebarSection = ({ title, step, children, hasBorder = false, theme, guide, order }: { title: string, step?: number, children: React.ReactNode, hasBorder?: boolean, theme: string | undefined, guide?: string, order?: number }) => {
    const sectionId = guide ?? title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (theme === 'terminal') {
        return (
            <div data-guide={guide} data-scatter-section={sectionId} style={{ order }} onClick={toggleTerminalSectionFromHeader}>
                <CyberContainer title={step != null ? `${step}. ${title}` : title} collapsible defaultOpen width={"100%" as any} className="scatterlab-terminal-accordion [&>header]:!px-2 [&>div]:!px-2">
                    {children}
                </CyberContainer>
            </div>
        );
    }
    const c = step != null ? STEP_COLORS[(step - 1) % STEP_COLORS.length] : null;
    if (theme === 'primary') {
        return (
            <div data-scatter-section={sectionId} style={{ order }} onClick={event => revealOpenedSidebarSection(event, event.currentTarget)}>
                <AccordionItem
                    value={sectionId}
                    title={
                        <span data-guide={guide ?? sectionId} role="heading" aria-level={2} className="scatterlab-primary-accordion-title">
                            {c && <span className="bauhaus-step" style={{ backgroundColor: c.bg, color: c.fg }}>{step}</span>}
                            <span>{title}</span>
                        </span>
                    }
                >
                    <div className="space-y-3">{children}</div>
                </AccordionItem>
            </div>
        );
    }
    return (
        <div data-guide={guide} style={{ order }} className={`space-y-3 ${hasBorder ? 'border-t border-[var(--border)] pt-6' : ''}`}>
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                {c && <span className="bauhaus-step" style={{ backgroundColor: c.bg, color: c.fg }}>{step}</span>}
                <span className="opacity-60">{title}</span>
            </h2>
            {children}
        </div>
    );
};

const SidebarGroup = ({ children, theme }: { children: React.ReactNode, theme: string | undefined }) => {
    if (theme === 'terminal') {
        return <CyberStackGroup className="flex-grow flex flex-col !space-y-0 gap-3">{children}</CyberStackGroup>;
    }
    if (theme === 'primary') {
        return (
            <Accordion
                multiple
                defaultOpen={['workspace', 'data', 'variables', 'pca', 'cluster', 'view', 'export']}
                className="scatterlab-primary-accordion"
            >
                {children}
            </Accordion>
        );
    }
    return <div className="flex-grow flex flex-col gap-6">{children}</div>;
};

const ViewPlot = ({ view, layout, onRelayout }: { view: any, layout: any, onRelayout: (e: any) => void }) => {
    const { theme } = useTheme();
    const traces = useMemo(
        () => buildTraces(view.data, view.colorBy, view.viewMode, view.axes, view.labels, view.muted ?? {}, theme === 'terminal', view.shapeBy ?? ""),
        [view.data, view.colorBy, view.viewMode, view.axes, view.labels, view.muted, theme, view.shapeBy]
    );
    return (
        <Plot
            divId={view.id === 'active' ? 'active-plot' : `pin-plot-${view.id}`}
            data={traces}
            layout={layout}
            useResizeHandler={true}
            style={{ width: "100%", height: "100%" }}
            onRelayout={onRelayout}
        />
    );
};

export default function Home() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [componentsFile, setComponentsFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [isExporting, setIsExporting] = useState("");
  const [includeExportInfo, setIncludeExportInfo] = useState(true);
  
  // Data state: cached datasets (columnar — see DataTable), one active at a time
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [colorBy, setColorBy] = useState<string>("");
  // Second categorical channel, rendered as marker symbols. "" = off.
  const [shapeBy, setShapeBy] = useState<string>("");
  const activeDataset = datasets.find(d => d.id === activeId) ?? null;
  const processedData = activeDataset?.table ?? null;
  
  // Plot state
  const [viewMode, setViewMode] = useState<"3D" | "2D">("3D");
  const [showAxes, setShowAxes] = useState<{ "3D": boolean, "2D": boolean }>({ "3D": false, "2D": true });
  const [camera, setCamera] = useState({ eye: { x: 1.8, y: 1.2, z: 0.5 } });
  // 2D viewport, the flat-mode counterpart of `camera`. null = autorange (fit all
  // points). Set by assistant zoom/pan and by the user's own mouse zoom, so a
  // React re-render can't silently snap the plot back to the full extent.
  const [range2d, setRange2d] = useState<{ x: [number, number], y: [number, number] } | null>(null);
  const [isRotating, setIsRotating] = useState(false);
  const cntRef = useRef(0);
  const reqRef = useRef<number | undefined>(undefined);

  // Feature state
  const [pinnedViews, setPinnedViews] = useState<any[]>([]); // array of { id, data, colorBy, axes, labels, viewMode, label }
  const [notes, setNotes] = useState("");
  // Legend mute states for the active view's colorBy, keyed by String(value)
  const [mutedMap, setMutedMap] = useState<MuteMap>({});

  const toggleMuted = (val: any) => {
      const key = String(val);
      setMutedMap(prev => {
          const next = { ...prev };
          if (!prev[key]) next[key] = 'muted';
          else if (prev[key] === 'muted') next[key] = 'hidden';
          else delete next[key];
          return next;
      });
  };

  // Muting is scoped to one colorBy of one dataset — reset when either changes.
  // Skip once during a workspace load, which restores muted state deliberately.
  const skipMuteReset = useRef(false);
  useEffect(() => {
      if (skipMuteReset.current) { skipMuteReset.current = false; return; }
      setMutedMap({});
  }, [colorBy, activeId]);


  // A 2D viewport is only meaningful for the columns it was framed on — dropping
  // different variables onto the axes would leave the old window clipping the new
  // data (or showing empty space), so refit whenever the framing changes.
  const skipRangeReset = useRef(false);
  useEffect(() => {
      if (skipRangeReset.current) { skipRangeReset.current = false; return; }
      setRange2d(null);
  }, [activeId, activeDataset?.axes2d.x, activeDataset?.axes2d.y]);

  // Drop the shape encoding when the column it points at is gone (dataset switch,
  // Clear All) or has grown past the cap (a clustering run adding levels)
  useEffect(() => {
      if (!shapeBy) return;
      const vals = activeDataset?.table.data[shapeBy];
      if (!vals || shapeCategories(vals).length > MAX_SHAPE_CATEGORIES) setShapeBy("");
  }, [activeId, activeDataset?.table, shapeBy]);

  // PCA state: scree info from the most recent in-app run (per active dataset)
  const [pcaInfo, setPcaInfo] = useState<{ varianceExplained: number[]; cumulative: number[] } | null>(null);
  useEffect(() => { setPcaInfo(null); }, [activeId]);

  // Clustering state
  const [clusterMethod, setClusterMethod] = useState("NONE");
  const [eps, setEps] = useState(0.5);
  const [minSamples, setMinSamples] = useState(5);
  const [k, setK] = useState(3);
  const [standardize, setStandardize] = useState(false);
  const [isClustering, setIsClustering] = useState(false);
  const [breakdownBy, setBreakdownBy] = useState<string>("");
  const [breakdownDirection, setBreakdownDirection] = useState<BreakdownDirection>('cluster');
  const [heatmapPalette, setHeatmapPalette] = useState<HeatmapPalette>('Viridis');

  // The standardize toggle defaults by data regime (PC scores or shared-scale
  // columns → off, mixed scales → on; see suggestStandardize). Recomputed when
  // the clustered columns change; skipped once when a workspace load or undo
  // restore supplies a deliberate value.
  const skipStdReset = useRef(false);
  const axNow = activeDataset ? effectiveAxes(activeDataset, viewMode) : null;
  useEffect(() => {
      if (skipStdReset.current) { skipStdReset.current = false; return; }
      if (!activeDataset || !axNow) return;
      const t = activeDataset.table;
      const names = [axNow.x, axNow.y, ...(axNow.z ? [axNow.z] : [])];
      const cols = names.map(nm => t.data[nm]).filter(Boolean);
      setStandardize(suggestStandardize(cols, names));
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, axNow?.x, axNow?.y, axNow?.z]);

  // Workspace persistence (file-based via backend)
  const [workspaces, setWorkspaces] = useState<{ name: string, saved_at: string, bytes: number }[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState("");

  const dsInputRef = useRef<HTMLInputElement>(null);
  const compInputRef = useRef<HTMLInputElement>(null);
  const gifButtonRef = useRef<HTMLButtonElement>(null);
  // Which dropzone a file is currently being dragged over
  const [dragOver, setDragOver] = useState<'ds' | 'comp' | null>(null);
  // Components projection is the exception now, not the rule — hidden until asked for
  const [showComponents, setShowComponents] = useState(false);



  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isRotating && viewMode === "3D") {
        const rotate = () => {
            cntRef.current += 0.005;
            setCamera({
                eye: {
                    x: 2.2 * Math.cos(cntRef.current),
                    y: 2.2 * Math.sin(cntRef.current),
                    z: 0.6
                }
            });
            reqRef.current = requestAnimationFrame(rotate);
        };
        reqRef.current = requestAnimationFrame(rotate);
    } else {
        if (reqRef.current) cancelAnimationFrame(reqRef.current);
    }
    return () => { if (reqRef.current) cancelAnimationFrame(reqRef.current); }
  }, [isRotating, viewMode]);

  // Everything happens in the browser: parse → (optionally) project → plot.
  // No network round-trip, no server, data never leaves the machine.
  const uploadFiles = async (
    dsFile: File,
    compFile: File | null,
    initialView?: InitialUploadView,
  ): Promise<DataTable | null> => {
    setIsUploading(true);
    setUploadStatus("Processing…");
    try {
      // Yield a frame so the busy state paints before heavy parsing starts
      await new Promise(r => setTimeout(r, 30));
      const [dsParsed, compParsed] = await Promise.all([
        readTable(dsFile),
        compFile ? readTable(compFile) : Promise.resolve(null),
      ]);
      const result = processUpload(dsParsed.table, compParsed?.table ?? null);
      // Parser warnings describe things that silently changed the data, so they
      // lead — the success message is the part the user can already see.
      const warnings = [
        ...dsParsed.warnings,
        ...(compParsed?.warnings ?? []).map(w => `Components file: ${w}`),
      ];
      setUploadStatus(warnings.length
        ? `${warnings.map(w => `⚠ ${w}`).join('\n')}\n${result.message}`
        : result.message);
      const id = Date.now();
      const table = result.table;
      const axes = initialView?.axes ?? pickDefaultAxes(table);
      const dataset: Dataset = {
        id,
        name: dsFile.name.replace(/\.(csv|xlsx|parquet)$/i, ''),
        table,
        summary: result.topContributors ? { top_contributors: result.topContributors } : null,
        axes,
        labels: defaultLabels(axes),
        axes2d: { x: axes.x, y: axes.y },
        labels2d: { x: axes.x, y: axes.y },
      };
      setDatasets(prev => [...prev, dataset]);
      setActiveId(id);
      setColorBy(initialView?.colorBy ?? pickDefaultColorBy(table, colorBy));
      // Ordinary uploads preserve a compatible shape channel; the demo supplies
      // an initial view specifically so it can start with shape unassigned.
      if (initialView) setShapeBy(initialView.shapeBy ?? "");
      setViewMode(initialView?.viewMode ?? (axes.z ? viewMode : "2D"));
      // Consume the file selections so the slots are free for the next dataset
      setDatasetFile(null);
      setComponentsFile(null);
      if (dsInputRef.current) dsInputRef.current.value = "";
      if (compInputRef.current) compInputRef.current.value = "";
      return table;
    } catch (err: any) {
      setUploadStatus(`Error: ${err?.message ?? err}`);
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpload = () => { if (datasetFile) uploadFiles(datasetFile, componentsFile); };

  // Demo data ships with the app (public/demo) so the empty state can offer a
  // zero-friction first run: the public Iris CSV, no projection file required.
  const loadDemo = async (): Promise<DataTable | null> => {
    setIsUploading(true);
    setUploadStatus("Loading demo data…");
    try {
      const response = await fetch('/demo/iris.csv');
      if (!response.ok) throw new Error(`Demo data request failed (${response.status})`);
      const ds = await response.blob();
      return await uploadFiles(
        new File([ds], 'iris.csv', { type: 'text/csv' }),
        null,
        {
          axes: { x: 'PetalLengthCm', y: 'PetalWidthCm', z: 'SepalLengthCm' },
          colorBy: 'Species',
          viewMode: '3D',
        },
      );
    } catch {
      setUploadStatus("Demo data failed to load.");
      setIsUploading(false);
      return null;
    }
  };

  const selectDataset = (id: number) => {
      setActiveId(id);
      const ds = datasets.find(d => d.id === id);
      if (ds) {
          setColorBy(pickDefaultColorBy(ds.table, colorBy));
          if (!ds.axes.z) setViewMode("2D");
      }
  };

  // --- Workspace persistence (IndexedDB — fully local) -----------------------
  const refreshWorkspaces = async () => {
      try {
          setWorkspaces(await wsStore.listWorkspaces());
      } catch { /* IndexedDB unavailable — list stays empty */ }
  };
  useEffect(() => { refreshWorkspaces(); }, []);

  // Dedupe tables by object identity: datasets and pins that share a table
  // (or a pin's snapshot) are stored once and referenced by id
  const buildWorkspacePayload = () => {
      const registry = new Map<DataTable, string>();
      const regTable = (t: DataTable | null) => {
          if (!t) return null;
          if (!registry.has(t)) registry.set(t, `t${registry.size}`);
          return registry.get(t);
      };
      const datasetsOut = datasets.map(d => ({ ...d, table: regTable(d.table) }));
      const pinsOut = pinnedViews.map(v => ({ ...v, data: regTable(v.data) }));
      const tables: Record<string, DataTable> = {};
      registry.forEach((id, tbl) => { tables[id] = tbl; });
      return {
          version: 1,
          tables, datasets: datasetsOut, pinnedViews: pinsOut,
          activeId, colorBy, shapeBy, viewMode, showAxes, camera, range2d,
          notes, mutedMap,
          clusterMethod, eps, minSamples, k, standardize, breakdownBy, breakdownDirection, heatmapPalette, includeExportInfo,
      };
  };

  const saveWorkspace = async () => {
      const name = workspaceName.trim();
      if (!name) return;
      setWorkspaceBusy("Saving…");
      try {
          await wsStore.saveWorkspace(name, buildWorkspacePayload());
          setWorkspaceBusy("");
          await refreshWorkspaces();
      } catch (err: any) {
          setWorkspaceBusy("");
          setUploadStatus(`Save failed: ${err?.message ?? err}`);
      }
  };

  const exportWorkspace = () => {
      const name = workspaceName.trim() || activeDataset?.name || 'workspace';
      wsStore.exportWorkspaceFile(name, buildWorkspacePayload());
  };

  const importWorkspace = async (file: File) => {
      setWorkspaceBusy("Importing…");
      try {
          const { name, payload } = await wsStore.importWorkspaceFile(file);
          await wsStore.saveWorkspace(name, payload);
          await refreshWorkspaces();
          applyWorkspace(name, payload);
          setWorkspaceBusy("");
      } catch (err: any) {
          setWorkspaceBusy("");
          setUploadStatus(`Import failed: ${err?.message ?? err}`);
      }
  };

  const loadWorkspace = async (name: string) => {
      setWorkspaceBusy("Loading…");
      try {
          const ws = await wsStore.loadWorkspace(name);
          if (!ws) { setWorkspaceBusy(""); setUploadStatus("Workspace not found."); return; }
          applyWorkspace(name, ws);
          setWorkspaceBusy("");
      } catch (err: any) {
          setWorkspaceBusy("");
          setUploadStatus(`Load failed: ${err?.message ?? err}`);
      }
  };

  const applyWorkspace = (name: string, ws: any) => {
          const tables: Record<string, DataTable> = ws.tables ?? {};
          const rehydrate = (ref: any) => (typeof ref === 'string' ? tables[ref] : ref);
          // Restore muted state deliberately — suppress the reset that colorBy/activeId would trigger
          skipMuteReset.current = true;
          setIsRotating(false);
          setDatasets((ws.datasets ?? []).map((d: any) => ({ ...d, table: rehydrate(d.table) })));
          setPinnedViews((ws.pinnedViews ?? []).map((v: any) => ({ ...v, data: rehydrate(v.data) })));
          setActiveId(ws.activeId ?? null);
          setColorBy(ws.colorBy ?? "");
          setShapeBy(ws.shapeBy ?? "");
          setViewMode(ws.viewMode ?? "3D");
          setShowAxes(ws.showAxes ?? { "3D": false, "2D": true });
          setCamera(ws.camera ?? { eye: { x: 1.8, y: 1.2, z: 0.5 } });
          // Restored deliberately — suppress the refit that the axis change would trigger
          skipRangeReset.current = true;
          setRange2d(ws.range2d ?? null);
          setNotes(ws.notes ?? "");
          setMutedMap(ws.mutedMap ?? {});
          setClusterMethod(ws.clusterMethod ?? "NONE");
          setEps(ws.eps ?? 0.5);
          setMinSamples(ws.minSamples ?? 5);
          setK(ws.k ?? 3);
          skipStdReset.current = true;
          setStandardize(ws.standardize ?? false);
          setBreakdownBy(ws.breakdownBy ?? "");
          setBreakdownDirection(ws.breakdownDirection === 'group' ? 'group' : 'cluster');
          setHeatmapPalette(HEATMAP_PALETTES.includes(ws.heatmapPalette) ? ws.heatmapPalette : 'Viridis');
          setIncludeExportInfo(ws.includeExportInfo ?? true);
          setWorkspaceName(name);
          setUploadStatus(`Loaded workspace "${name}".`);
  };

  const handleTransfer = ({ sourceId, sourceCol, mode, keyCol, name }: TransferSpec) => {
      const src = datasets.find(d => d.id === sourceId);
      const tgt = activeDataset;
      if (!src || !tgt) return;
      const srcColArr = src.table.data[sourceCol];
      let newCol: any[];
      if (mode === 'order') {
          newCol = Array.from({ length: tgt.table.nRows }, (_, i) => srcColArr[i] ?? null);
      } else {
          const sk = src.table.data[keyCol], tk = tgt.table.data[keyCol];
          const map = new Map<string, any>();
          for (let i = 0; i < src.table.nRows; i++) map.set(String(sk[i]), srcColArr[i]);
          newCol = Array.from({ length: tgt.table.nRows }, (_, i) => map.get(String(tk[i])) ?? null);
      }
      const newTable: DataTable = {
          columns: tgt.table.columns.includes(name) ? tgt.table.columns : [...tgt.table.columns, name],
          data: { ...tgt.table.data, [name]: newCol },
          nRows: tgt.table.nRows,
      };
      setDatasets(prev => prev.map(d => d.id === tgt.id ? { ...d, table: newTable } : d));
      setColorBy(name);
      const filled = newCol.filter(v => v != null).length;
      setUploadStatus(`Transferred "${sourceCol}" from ${src.name} → "${name}" (${filled}/${tgt.table.nRows} rows filled).`);
      return newTable;
  };

  const deleteWorkspace = async (name: string) => {
      try {
          await wsStore.deleteWorkspace(name);
          await refreshWorkspaces();
      } catch { /* ignore */ }
  };

  const updateAxis = (axis: 'x' | 'y' | 'z', col: string | null) => {
      if (viewMode === "2D") {
          if (axis === 'z' || !col) return;
          setDatasets(prev => prev.map(d => d.id === activeId
              ? { ...d, axes2d: { ...d.axes2d, [axis]: col }, labels2d: { ...d.labels2d, [axis]: col } }
              : d));
          return;
      }
      setDatasets(prev => prev.map(d => d.id === activeId
          ? { ...d, axes: { ...d.axes, [axis]: col }, labels: { ...d.labels, [axis]: col ?? 'Z' } }
          : d));
      if (axis === 'z' && !col) setViewMode("2D");
  };

  const updateLabel = (axis: 'x' | 'y' | 'z', text: string) => {
      setDatasets(prev => prev.map(d => {
          if (d.id !== activeId) return d;
          return viewMode === "2D"
              ? { ...d, labels2d: { ...d.labels2d, [axis]: text } }
              : { ...d, labels: { ...d.labels, [axis]: text } };
      }));
  };

  const removeDataset = (id: number) => {
      const remaining = datasets.filter(d => d.id !== id);
      setDatasets(remaining);
      if (activeId === id) {
          const next = remaining[0] ?? null;
          setActiveId(next?.id ?? null);
          if (next) setColorBy(pickDefaultColorBy(next.table, colorBy));
      }
  };

  const handleClearData = () => {
      setDatasets([]);
      setActiveId(null);
      setColorBy("");
      setShapeBy("");
      setPinnedViews([]);
      setDatasetFile(null);
      setComponentsFile(null);
      setUploadStatus("");
      setClusterMethod("NONE");
      setIsRotating(false);
      // Reset the hidden inputs so re-selecting the same file fires onChange again
      if (dsInputRef.current) dsInputRef.current.value = "";
      if (compInputRef.current) compInputRef.current.value = "";
  };

  const handleCluster = async () => {
      if (clusterMethod === "NONE" || !processedData) return;
      setIsClustering(true);
      // Yield a frame so the busy state paints before the O(n²) work starts
      await new Promise(r => setTimeout(r, 30));
      try {
          const ax = effectiveAxes(activeDataset!, viewMode);
          const rawCols = [processedData.data[ax.x], processedData.data[ax.y]];
          if (ax.z) rawCols.push(processedData.data[ax.z]);
          const cols = standardize ? zscoreCellColumns(rawCols) : rawCols;
          const axNames = [ax.x, ax.y, ...(ax.z ? [ax.z] : [])];
          const imp = countImputed(rawCols, axNames);
          const labels = clusterMethod === "DBSCAN"
              ? dbscan(cols, eps, minSamples)
              : kmeans(cols, k);
          const newTable: DataTable = {
              columns: processedData.columns.includes("Cluster") ? processedData.columns : [...processedData.columns, "Cluster"],
              data: { ...processedData.data, Cluster: labels },
              nRows: processedData.nRows
          };
          setDatasets(prev => prev.map(d => d.id === activeId ? { ...d, table: newTable } : d));
          // The pre-cluster coloring is the natural default for composition breakdowns
          if (colorBy !== "Cluster") setBreakdownBy(colorBy);
          setColorBy("Cluster");
          const sizes = new Map<string, number>();
          for (const l of labels) sizes.set(l, (sizes.get(l) ?? 0) + 1);
          setUploadStatus(
              `${clusterMethod} on ${axNames.join(' · ')} — ${sortCategories(Array.from(sizes.keys())).map(l => `${l}: ${sizes.get(l)}`).join(', ')}.`
              + missingNote({ strategy: 'median', imputedCells: imp.cells, totalCells: imp.total, byVariable: imp.byVariable, rowsUsed: processedData.nRows, rowsDropped: 0 }, processedData.nRows));
      } catch (err: any) {
          setUploadStatus(`Clustering failed: ${err?.message ?? err}`);
      } finally {
          setIsClustering(false);
      }
  };

  const getLayout = (title: string, customAxisNames: AxisLabels, mode = viewMode, axesOn = false, window2d: { x: [number, number], y: [number, number] } | null = null) => {
      const dark = theme === 'terminal';
      const baseLayout: any = {
          autosize: true,
          // Terminal panes carry their own label — a Plotly title would duplicate it
          margin: { l: mode === "2D" ? 40 : 0, r: 20, b: mode === "2D" ? 40 : 0, t: dark ? 10 : 40 },
          template: 'plotly_white',
          ...(dark ? {} : { title: { text: title, font: { color: 'var(--foreground)', family: 'var(--font-sans)' } } }),
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          showlegend: false,
          legend: { title: { text: colorBy, font: { color: 'var(--foreground)' } }, font: { color: 'var(--foreground)' } }
      };

      // Grid/tick colors must read against each theme's canvas
      const gridC = dark ? '#3a3a3a' : '#bbbbbb';
      const gridC2d = dark ? '#333333' : '#cccccc';
      const tickC = dark ? '#9a9a9a' : '#888888';
      const zeroC = dark ? '#555555' : '#888888';

      if (mode === "3D") {
          const axis3d = (label: string) => ({
              showgrid: axesOn, zeroline: axesOn, showticklabels: axesOn,
              gridcolor: gridC, zerolinecolor: zeroC,
              tickfont: { size: 10, color: tickC },
              title: { text: label, font: { color: 'var(--foreground)' } }
          });
          baseLayout.scene = {
              camera: camera,
              xaxis: axis3d(customAxisNames.x),
              yaxis: axis3d(customAxisNames.y),
              zaxis: axis3d(customAxisNames.z),
              bgcolor: 'transparent'
          };
      } else {
          const axis2d = (label: string) => ({
              showgrid: axesOn, zeroline: axesOn, showticklabels: axesOn,
              gridcolor: gridC2d, zerolinecolor: zeroC,
              tickfont: { color: tickC },
              title: { text: label, font: { color: 'var(--foreground)' } }
          });
          baseLayout.xaxis = axis2d(customAxisNames.x);
          baseLayout.yaxis = axis2d(customAxisNames.y);
          // Each view brings its own viewport — the active one's live state, a
          // pin's captured one — since these are data-space bounds and pins are
          // framed on their own columns. `autorange` is set explicitly so a reset
          // actually refits: dropping `range` alone lets Plotly keep the old window.
          if (window2d) {
              baseLayout.xaxis.range = [...window2d.x];
              baseLayout.yaxis.range = [...window2d.y];
              baseLayout.xaxis.autorange = false;
              baseLayout.yaxis.autorange = false;
          } else {
              baseLayout.xaxis.autorange = true;
              baseLayout.yaxis.autorange = true;
          }
      }

      return baseLayout;
  };

  // Target by id — NOT .js-plotly-plot: Plotly.toImage spawns (and can leak) a
  // temporary clone div with that class, and grabbing the purged clone exports
  // empty default axes instead of the real plot
  const getActivePlotDiv = () => document.getElementById('active-plot') as any;

  // The window the user is actually looking at in 2D. When no explicit viewport
  // is set we read the autoranged bounds Plotly computed (`_fullLayout` is
  // internal, but it is the only place the resolved range exists), so a relative
  // zoom/pan starts from what is on screen rather than from raw data extents.
  const get2dRange = (): { x: [number, number], y: [number, number] } | null => {
      if (range2d) return range2d;
      const fl = getActivePlotDiv()?._fullLayout;
      const x = fl?.xaxis?.range, y = fl?.yaxis?.range;
      if (!Array.isArray(x) || !Array.isArray(y)) return null;
      const vals = [x[0], x[1], y[0], y[1]].map(Number);
      if (!vals.every(Number.isFinite) || x[0] === x[1] || y[0] === y[1]) return null;
      return { x: [vals[0], vals[1]], y: [vals[2], vals[3]] };
  };

  const fmtRange = (a: number, b: number) => {
      const p = Math.abs(b - a) >= 10 ? 0 : 2;
      return `${a.toFixed(p)}…${b.toFixed(p)}`;
  };

  // Temporarily dress the live plot with a descriptive title + legend for
  // capture, then undress. Any later re-render also restores the props-driven
  // layout, so a failed restore can't stick.
  const setExportDressing = async (Plotly: any, gd: any, on: boolean) => {
      if (!includeExportInfo || !activeDataset || !processedData) return;
      const labels = effectiveLabels(activeDataset, viewMode);
      const axesStr = viewMode === "3D" ? `${labels.x} × ${labels.y} × ${labels.z}` : `${labels.x} × ${labels.y}`;
      const kind = getColorFieldKind(processedData.data[colorBy] ?? []);
      await Plotly.relayout(gd, on
          ? {
              'title.text': `${axesStr} · colored by ${colorBy}`,
              'title.font.color': '#111111',
              showlegend: kind === "categorical",
              'legend.font.color': '#444444',
              'legend.bgcolor': 'rgba(255,255,255,0.7)',
            }
          : { 'title.text': `${activeDataset.name} · live`, showlegend: false });
      if (kind === "continuous") {
          // The single continuous trace is index 0 — show its colorbar instead of a legend
          await Plotly.restyle(gd, on
              ? {
                  'marker.showscale': true,
                  'marker.colorbar.title.text': colorBy,
                  'marker.colorbar.title.font.color': '#444444',
                  'marker.colorbar.tickfont.color': '#444444',
                  'marker.colorbar.thickness': 12,
                }
              : { 'marker.showscale': false }, [0]);
      }
  };

  const exportPNG = async (): Promise<string | null> => {
      if (!activeDataset) return 'No active dataset to export.';
      const Plotly = (await import('plotly.js-gl3d-dist-min')).default;
      const gd = getActivePlotDiv();
      if (!gd || !gd.data) return 'The active plot is not ready to export yet.';
      try {
          await setExportDressing(Plotly, gd, true);
          await Plotly.downloadImage(gd, {
              format: 'png',
              width: gd.offsetWidth || 900,
              height: gd.offsetHeight || 700,
              scale: 2,
              filename: `${activeDataset.name}_${colorBy}_${viewMode}`,
          });
      } catch (err) {
          console.error(err);
          const message = 'PNG export failed — see console.';
          setUploadStatus(message);
          return message;
      } finally {
          try { await setExportDressing(Plotly, gd, false); } catch { /* a re-render restores the live plot */ }
      }
      return null;
  };

  const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

  const exportGIF = async (): Promise<string | null> => {
      const gd = getActivePlotDiv();
      if (!gd || !activeDataset) return 'The active plot is not ready to export yet.';
      if (viewMode !== "3D") return 'A rotating GIF is available only for a 3D view.';
      if (isExporting) return 'Another export is already in progress.';
      const wasRotating = isRotating;
      setIsRotating(false);
      const prevEye = { ...camera.eye };
      const FRAMES = 36;
      // Cap size — GIF bytes grow fast with dimensions
      const W = Math.min(gd.offsetWidth || 700, 720);
      const H = Math.round(W * ((gd.offsetHeight || 600) / (gd.offsetWidth || 700)));
      // One state update up front, then NO React state changes until the loop
      // ends: a Plotly.react (from any re-render) landing mid-toImage deadlocks
      // WebGL capture. Progress is written straight into the button's DOM text.
      setIsExporting("Rendering GIF…");
      await new Promise(r => setTimeout(r, 100));
      try {
          const Plotly = (await import('plotly.js-gl3d-dist-min')).default;
          const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
          await setExportDressing(Plotly, gd, true);
          const canvas = document.createElement('canvas');
          canvas.width = W; canvas.height = H;
          const ctx = canvas.getContext('2d')!;
          const gif = GIFEncoder();
          const progressNode = gifButtonRef.current;
          for (let i = 0; i < FRAMES; i++) {
              if (progressNode) progressNode.textContent = `Rendering ${i + 1}/${FRAMES}…`;
              const t = (2 * Math.PI * i) / FRAMES;
              const frameGd = getActivePlotDiv();
              if (!frameGd || !frameGd.data) throw new Error("Plot div disappeared mid-export");
              await withTimeout(Plotly.relayout(frameGd, {
                  'scene.camera.eye': { x: 2.2 * Math.cos(t), y: 2.2 * Math.sin(t), z: 0.6 }
              }), 10000, "camera move");
              const url: string = await withTimeout(
                  Plotly.toImage(frameGd, { format: 'png', width: W, height: H, scale: 1 }) as Promise<string>,
                  15000, `frame ${i + 1} capture`);
              const img = new Image();
              await withTimeout(new Promise((res, rej) => {
                  img.onload = res;
                  img.onerror = () => rej(new Error("frame image decode failed"));
                  img.src = url;
              }), 10000, `frame ${i + 1} decode`);
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, W, H);
              ctx.drawImage(img, 0, 0, W, H);
              const { data: rgba } = ctx.getImageData(0, 0, W, H);
              const palette = quantize(rgba, 256);
              gif.writeFrame(applyPalette(rgba, palette), W, H, { palette, delay: 80 });
          }
          gif.finish();
          const blob = new Blob([gif.bytes()], { type: 'image/gif' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${activeDataset.name}_${colorBy}_rotation.gif`;
          a.click();
          URL.revokeObjectURL(a.href);
      } catch (err) {
          console.error(err);
          const message = "GIF export failed — see console.";
          setUploadStatus(message);
          return message;
      } finally {
          try {
              const Plotly = (await import('plotly.js-gl3d-dist-min')).default;
              const finalGd = getActivePlotDiv();
              if (finalGd && finalGd.data) await setExportDressing(Plotly, finalGd, false);
          } catch { /* a re-render restores the props-driven layout anyway */ }
          setCamera({ eye: prevEye });
          setIsRotating(wasRotating);
          setIsExporting("");
      }
      return null;
  };

  const exportHTML = async (): Promise<string | null> => {
      if (!activeDataset || !processedData) return 'No active dataset to export.';
      setIsExporting("Building HTML…");
      try {
          const labels = effectiveLabels(activeDataset, viewMode);
          const axes = effectiveAxes(activeDataset, viewMode);
          const axesStr = viewMode === "3D" ? `${labels.x} × ${labels.y} × ${labels.z}` : `${labels.x} × ${labels.y}`;
          const kind = getColorFieldKind(processedData.data[colorBy] ?? []);
          const title = includeExportInfo ? `${axesStr} · colored by ${colorBy}` : `${activeDataset.name}`;

          const data = buildTraces(processedData, colorBy, viewMode, axes, labels, mutedMap, false, shapeBy);
          if (includeExportInfo && kind === "continuous" && data[0]?.marker) {
              data[0].marker.showscale = true;
              data[0].marker.colorbar = { title: { text: colorBy }, thickness: 14 };
          }

          // Standalone layout — concrete colors only (no CSS vars, which won't
          // resolve in a bare file); start from the user's current camera angle
          const gd = getActivePlotDiv();
          const startCam = gd?.layout?.scene?.camera ?? camera;
          const axesOn = showAxes[viewMode];
          const layout: any = {
              autosize: true,
              margin: viewMode === "2D" ? { l: 50, r: 20, b: 50, t: 60 } : { l: 0, r: 0, b: 0, t: 60 },
              title: { text: title, font: { color: '#111111', size: 16 } },
              paper_bgcolor: 'white', plot_bgcolor: 'white',
              showlegend: includeExportInfo && kind === "categorical",
              legend: { font: { color: '#333333' }, bgcolor: 'rgba(255,255,255,0.8)' },
          };
          const axisCfg = (label: string, g: string) => ({
              showgrid: axesOn, zeroline: axesOn, showticklabels: axesOn,
              gridcolor: g, zerolinecolor: '#888888', tickfont: { color: '#888888' },
              title: { text: label, font: { color: '#111111' } },
          });
          if (viewMode === "3D") {
              layout.scene = { camera: startCam, bgcolor: 'white',
                  xaxis: axisCfg(labels.x, '#bbbbbb'), yaxis: axisCfg(labels.y, '#bbbbbb'), zaxis: axisCfg(labels.z, '#bbbbbb') };
          } else {
              layout.xaxis = axisCfg(labels.x, '#cccccc');
              layout.yaxis = axisCfg(labels.y, '#cccccc');
              // Same intent as startCam above: export the view as it is framed now
              const win = get2dRange();
              if (win) {
                  layout.xaxis.range = [...win.x];
                  layout.yaxis.range = [...win.y];
              }
          }

          // Inline the Plotly bundle so the file is fully self-contained (offline-safe).
          // Neutralize any "</script" so it can't close our inline <script> early.
          const bundle = (await (await fetch('/vendor/plotly-gl3d.min.js')).text()).replace(/<\/script/gi, '<\\/script');
          const safeJSON = (o: any) => JSON.stringify(o).replace(/<\//g, '<\\/');
          const rotate = viewMode === "3D";

          const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<title>${title.replace(/[<>&]/g, '')}</title>
<style>
  html,body{margin:0;height:100%;font-family:sans-serif;background:#fff}
  #plot{width:100vw;height:100vh}
  #ctrl{position:fixed;top:10px;right:12px;z-index:10;font-size:13px;
    padding:6px 12px;border:1px solid #333;background:#fff;cursor:pointer}
</style></head><body>
${rotate ? '<button id="ctrl">⏸ Pause rotation</button>' : ''}
<div id="plot"></div>
<script>${bundle}</script>
<script>
  var data=${safeJSON(data)},layout=${safeJSON(layout)};
  Plotly.newPlot('plot',data,layout,{responsive:true});
${rotate ? `  var rotating=true,t=Math.atan2(layout.scene.camera.eye.y,layout.scene.camera.eye.x)||0;
  function step(){ if(rotating){ t+=0.008;
    Plotly.relayout('plot',{'scene.camera.eye':{x:2.2*Math.cos(t),y:2.2*Math.sin(t),z:0.6}}); }
    requestAnimationFrame(step); }
  requestAnimationFrame(step);
  var btn=document.getElementById('ctrl');
  btn.onclick=function(){ rotating=!rotating; btn.textContent=rotating?'⏸ Pause rotation':'▶ Resume rotation'; };` : ''}
</script>
</body></html>`;

          const blob = new Blob([html], { type: 'text/html' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${activeDataset.name}_${colorBy}_${viewMode}.html`;
          a.click();
          URL.revokeObjectURL(a.href);
      } catch (err) {
          console.error(err);
          const message = "HTML export failed — see console.";
          setUploadStatus(message);
          return message;
      } finally {
          setIsExporting("");
      }
      return null;
  };

  const exportDatasetCsv = (): string | null => {
      const table = freshTableRef.current ?? processedData;
      if (!activeDataset || !table) return 'No active dataset to export.';
      const encode = (value: unknown) => {
          const text = value == null ? '' : String(value);
          return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const rows = [
          table.columns.map(encode).join(','),
          ...Array.from({ length: table.nRows }, (_, row) =>
              table.columns.map(column => encode(table.data[column]?.[row])).join(',')
          ),
      ];
      const blob = new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${activeDataset.name}_data.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      return null;
  };

  const pinCurrentView = () => {
      if (pinnedViews.length >= 3) {
          setUploadStatus("Pin limit reached — the grid holds the live view plus 3 pins. Remove one to pin another.");
          return;
      }
      setPinnedViews([
          ...pinnedViews,
          // Tables are replaced wholesale on change, so sharing the reference is a safe snapshot
          { id: Date.now(), data: processedData, colorBy, shapeBy,
            axes: effectiveAxes(activeDataset!, viewMode), labels: effectiveLabels(activeDataset!, viewMode), viewMode,
            showAxes: showAxes[viewMode],
            // Freeze the 2D framing too, so a pin keeps showing the region it was
            // taken on after the live view is zoomed elsewhere or reset
            range2d: viewMode === "2D" ? get2dRange() : null,
            muted: { ...mutedMap },
            label: `${activeDataset?.name ?? 'Pinned'} · ${colorBy}` }
      ]);
  };

  const removePin = (id: number) => {
      setPinnedViews(pinnedViews.filter(v => v.id !== id));
  };

  const handleRunPCA = (vars: string[], k: number, standardize: boolean, label = '', missing: MissingStrategy = 'median'): string => {
      const t = freshTableRef.current ?? processedData;
      if (!t || !activeDataset) return 'No dataset loaded.';
      try {
          const res = runPCA(t, vars, { k, standardize, label, missing });
          freshTableRef.current = res.table;
          const topContributors = Object.fromEntries(
              Object.entries(res.loadings).map(([pc, rows]) => [pc, rows.slice(0, 5)])
          );
          const cols = res.columns;
          const run: PcaRun = {
              label: res.label, columns: cols, variables: vars, k: res.k, standardize,
              savedAt: new Date().toISOString(), varianceExplained: res.varianceExplained,
              missing: res.missing,
          };
          setDatasets(prev => prev.map(d => {
              if (d.id !== activeId) return d;
              // A single kept component (a composite score) lands on the X axis and
              // leaves the rest of the framing alone — the workflow is "build several
              // composites, then plot them against each other", so wiping Y/Z on each
              // run would fight the user. Multi-component runs re-frame fully.
              const inTable = (c: string | null) => (c && res.table.columns.includes(c) ? c : null);
              const axes = res.k === 1
                  ? { x: cols[0], y: inTable(d.axes.y) ?? cols[0], z: inTable(d.axes.z) }
                  : { x: cols[0], y: cols[1], z: res.k >= 3 ? cols[2] : null };
              const axes2d = res.k === 1
                  ? { x: cols[0], y: inTable(d.axes2d.y) ?? cols[0] }
                  : { x: cols[0], y: cols[1] };
              return {
                  ...d,
                  table: res.table,
                  summary: { ...(d.summary ?? {}), top_contributors: { ...(d.summary?.top_contributors ?? {}), ...topContributors } },
                  axes, labels: { x: axes.x, y: axes.y, z: axes.z ?? 'Z' },
                  axes2d, labels2d: { ...axes2d },
                  pcaRuns: [...(d.pcaRuns ?? []).filter(r => r.label !== res.label), run],
              };
          }));
          if (res.k < 3) setViewMode('2D');
          setPcaInfo({ varianceExplained: res.varianceExplained, cumulative: res.cumulative });
          const pct = res.varianceExplained.map((v, i) => `${cols[i] ?? `PC${i + 1}`} ${(v * 100).toFixed(0)}%`).join(', ');
          const replacedNote = res.replaced.length
              ? ` Replaced the previous ${res.label ? `"${res.label}"` : 'unnamed'} run (${res.replaced.join(', ')}).`
              : '';
          const impNote = missingNote(res.missing, t.nRows);
          const msg = res.k === 1
              ? `PCA on ${vars.length} variables (${standardize ? 'standardized' : 'unstandardized'}): kept the top component as composite "${cols[0]}" — ${pct} of variance.${replacedNote} It is plotted on the X axis.${impNote}`
              : `PCA on ${vars.length} variables (${standardize ? 'standardized' : 'unstandardized'}): kept ${res.k} components — ${pct} (cumulative ${(res.cumulative[res.cumulative.length - 1] * 100).toFixed(0)}%).${replacedNote} Scores added as ${res.label ? `${res.label}-labeled` : 'PC'} columns and plotted.${impNote}`;
          setUploadStatus(msg);
          return msg;
      } catch (err: any) {
          const msg = `PCA failed: ${err?.message ?? err}`;
          setUploadStatus(msg);
          return msg;
      }
  };

  // --- Assistant bridge ------------------------------------------------------
  // Tool calls in one model response run back-to-back, before React re-renders,
  // so a clustering result must be readable by the next tool immediately:
  // freshTableRef carries the just-computed table until the next render.
  const freshTableRef = useRef<DataTable | null>(null);
  useEffect(() => { freshTableRef.current = null; }, [processedData]);
  const latestTable = (): DataTable | null => freshTableRef.current ?? processedData;

  const columnProfiles = (): ColumnProfile[] => {
      const t = latestTable();
      if (!t) return [];
      return t.columns.map(col => {
          const vals = t.data[col] ?? [];
          let missing = 0, isNumeric = false, min = Infinity, max = -Infinity;
          const counts = new Map<string, number>();
          for (const v of vals) {
              if (v == null) { missing++; continue; }
              if (typeof v === 'number') { isNumeric = true; if (v < min) min = v; if (v > max) max = v; }
              else counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
          }
          if (isNumeric) return { name: col, kind: 'numeric' as const, min, max, missing };
          return {
              name: col, kind: 'categorical' as const, missing, nUnique: counts.size,
              topCategories: Array.from(counts.entries())
                  .sort((a, b) => b[1] - a[1]).slice(0, 8)
                  .map(([value, count]) => ({ value, count })),
          };
      });
  };

  const bridgeRef = useRef<AppBridge>(null as any);
  // Lets the sidebar open the assistant with a prefilled question (upload errors)
  const askAssistantRef = useRef<((q: string) => void) | null>(null);
  // Assistant dock mode: right column (default) / bottom row / floating overlay
  const [assistantDock, setAssistantDock] = useState<'right' | 'bottom' | 'float'>('right');
  useEffect(() => {
      const saved = localStorage.getItem('scatterlab.assistant.dock');
      if (saved === 'right' || saved === 'bottom' || saved === 'float') setAssistantDock(saved);
  }, []);
  const changeDock = (d: 'right' | 'bottom' | 'float') => {
      setAssistantDock(d);
      localStorage.setItem('scatterlab.assistant.dock', d);
  };
  bridgeRef.current = {
      getState: () => ({
          datasets: datasets.map(d => ({ name: d.name, nRows: d.table.nRows, active: d.id === activeId })),
          columns: columnProfiles(),
          axes: activeDataset ? effectiveAxes(activeDataset, viewMode) : { x: '', y: '', z: null },
          colorBy,
          shapeBy,
          viewMode,
          pinnedViews: pinnedViews.length,
          clusterSettings: { method: clusterMethod, eps, minSamples, k, standardize },
          clusterBreakdown: { attribute: breakdownBy, direction: breakdownDirection, palette: heatmapPalette },
          pcaRuns: (activeDataset?.pcaRuns ?? []).map(r => ({
              label: r.label || '(unnamed)', columns: r.columns, variables: r.variables,
              standardize: r.standardize, savedAt: r.savedAt,
              varianceExplained: r.varianceExplained.map(v => Math.round(v * 1000) / 1000),
              missing: r.missing && { strategy: r.missing.strategy, imputedCells: r.missing.imputedCells, rowsUsed: r.missing.rowsUsed, rowsDropped: r.missing.rowsDropped },
          })),
      }),

      setPlot: (opts) => {
          const t = latestTable();
          if (!t) return 'No dataset loaded — the user can load one (or the demo) first.';
          const numeric = new Set(numericColumns(t));
          const problems: string[] = [];
          const targetMode = opts.view_mode ?? viewMode;
          for (const [axis, col] of [['x', opts.x], ['y', opts.y], ['z', opts.z]] as const) {
              if (col && !numeric.has(col)) problems.push(`"${col}" is not a numeric column (${axis} axis).`);
          }
          if (opts.color_by && !t.columns.includes(opts.color_by)) problems.push(`"${opts.color_by}" is not a column.`);
          // "" / "none" is the documented way to switch the shape channel off
          const clearShape = opts.shape_by != null && ['', 'none'].includes(String(opts.shape_by).toLowerCase());
          if (opts.shape_by && !clearShape) {
              if (!t.columns.includes(opts.shape_by)) {
                  problems.push(`"${opts.shape_by}" is not a column.`);
              } else {
                  const levels = shapeCategories(t.data[opts.shape_by] ?? []);
                  if (levels.length > MAX_SHAPE_CATEGORIES) {
                      problems.push(`"${opts.shape_by}" has ${levels.length} distinct values — shape encodes at most ${MAX_SHAPE_CATEGORIES}, and is only readable up to about 5. Use color_by for it instead, or shape a coarser column.`);
                  }
              }
          }
          if (problems.length) return `Not applied. ${problems.join(' ')} Numeric columns: ${numericColumns(t).join(', ')}.`;

          if (opts.view_mode) setViewMode(opts.view_mode);
          if (opts.x || opts.y || opts.z) {
              setDatasets(prev => prev.map(d => {
                  if (d.id !== activeId) return d;
                  if (targetMode === '2D') {
                      const axes2d = { x: opts.x ?? d.axes2d.x, y: opts.y ?? d.axes2d.y };
                      return { ...d, axes2d, labels2d: { x: opts.x ?? d.labels2d.x, y: opts.y ?? d.labels2d.y } };
                  }
                  const axes = { x: opts.x ?? d.axes.x, y: opts.y ?? d.axes.y, z: opts.z ?? d.axes.z };
                  return { ...d, axes, labels: { x: axes.x, y: axes.y, z: axes.z ?? 'Z' } };
              }));
          }
          if (opts.color_by) setColorBy(opts.color_by);
          if (opts.shape_by != null) setShapeBy(clearShape ? "" : opts.shape_by);
          const parts = [
              opts.view_mode && `view=${opts.view_mode}`,
              opts.x && `x=${opts.x}`, opts.y && `y=${opts.y}`, opts.z && `z=${opts.z}`,
              opts.color_by && `color=${opts.color_by}`,
              opts.shape_by != null && (clearShape ? 'shape=off' : `shape=${opts.shape_by}`),
          ].filter(Boolean);
          if (!parts.length) return 'Nothing requested — pass at least one of x, y, z, color_by, shape_by, view_mode.';
          const shapeNote = opts.shape_by && !clearShape
              ? ` Marker symbols now encode ${opts.shape_by} (${shapeCategories(t.data[opts.shape_by] ?? []).join(', ')}); a shape key is listed under the legend.`
              : '';
          return `Applied: ${parts.join(', ')}.${shapeNote}`;
      },

      runClustering: (method, opts) => {
          const t = latestTable();
          if (!t || !activeDataset) return 'No dataset loaded.';
          const ax = effectiveAxes(activeDataset, viewMode);
          const rawCols = [t.data[ax.x], t.data[ax.y]];
          if (ax.z) rawCols.push(t.data[ax.z]);
          const useEps = opts.eps ?? eps, useMin = opts.min_samples ?? minSamples, useK = opts.k ?? k;
          const useStd = opts.standardize ?? standardize;
          const cols = useStd ? zscoreCellColumns(rawCols) : rawCols;
          const imp = countImputed(rawCols, [ax.x, ax.y, ...(ax.z ? [ax.z] : [])]);
          const labels = method === 'DBSCAN' ? dbscan(cols, useEps, useMin) : kmeans(cols, useK);
          const newTable: DataTable = {
              columns: t.columns.includes('Cluster') ? t.columns : [...t.columns, 'Cluster'],
              data: { ...t.data, Cluster: labels },
              nRows: t.nRows,
          };
          freshTableRef.current = newTable;
          setDatasets(prev => prev.map(d => d.id === activeId ? { ...d, table: newTable } : d));
          setClusterMethod(method);
          if (opts.eps != null) setEps(opts.eps);
          if (opts.min_samples != null) setMinSamples(opts.min_samples);
          if (opts.k != null) setK(opts.k);
          if (opts.standardize != null) { skipStdReset.current = true; setStandardize(opts.standardize); }
          if (colorBy !== 'Cluster') setBreakdownBy(colorBy);
          setColorBy('Cluster');
          const sizes = new Map<string, number>();
          for (const l of labels) sizes.set(l, (sizes.get(l) ?? 0) + 1);
          const summary = sortCategories(Array.from(sizes.keys())).map(l => `${l}: ${sizes.get(l)}`).join(', ');
          const stdNote = useStd
              ? ` Variables were z-scored first${method === 'DBSCAN' ? ' (eps is in SD units)' : ''}.`
              : ' Variables were used on their raw scales.';
          return `${method} done on ${ax.z ? '3' : '2'} axes (${[ax.x, ax.y, ax.z].filter(Boolean).join(', ')}). Sizes — ${summary}.${stdNote}${missingNote({ strategy: 'median', imputedCells: imp.cells, totalCells: imp.total, byVariable: imp.byVariable, rowsUsed: t.nRows, rowsDropped: 0 }, t.nRows)} Points are now colored by cluster.`;
      },

      getClusterBreakdown: (attribute) => {
          const t = latestTable();
          if (!t) return 'No dataset loaded.';
          const clusterCol = t.data['Cluster'];
          if (!clusterCol) return 'No clustering has been run yet — call run_clustering first.';
          if (!attribute || !t.columns.includes(attribute)) {
              const cats = t.columns.filter(c => c !== 'Cluster' && getColorFieldKind(t.data[c] ?? []) === 'categorical');
              return `"${attribute}" is not a column. Categorical columns: ${cats.join(', ')}.`;
          }
          const attrVals = t.data[attribute];
          const byCluster: Record<string, { total: number, counts: Record<string, number> }> = {};
          for (let i = 0; i < t.nRows; i++) {
              const c = String(clusterCol[i] ?? 'N/A');
              const a = String(attrVals[i] ?? 'N/A');
              if (!byCluster[c]) byCluster[c] = { total: 0, counts: {} };
              byCluster[c].total++;
              byCluster[c].counts[a] = (byCluster[c].counts[a] || 0) + 1;
          }
          return sortCategories(Object.keys(byCluster)).map(ck => {
              const { total, counts } = byCluster[ck];
              const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
                  .map(([v, n]) => `${v} ${Math.round((n / total) * 100)}% (${n})`).join(', ');
              return `${ck} (n=${total}): ${rows}`;
          }).join('\n');
      },

      saveClusterHeatmap: async ({ attribute, direction, palette }) => {
          const t = latestTable();
          if (!t) return 'No dataset loaded.';
          if (!t.data.Cluster) return 'No clustering has been run yet — call run_clustering first.';
          const candidates = t.columns.filter(c => c !== 'Cluster' && getColorFieldKind(t.data[c] ?? []) === 'categorical');
          if (!candidates.includes(attribute)) {
              return `"${attribute}" is not available for a cluster heatmap. Categorical columns: ${candidates.join(', ')}.`;
          }
          const useDirection = direction === 'group' ? 'group' : 'cluster';
          const usePalette = HEATMAP_PALETTES.includes(palette as HeatmapPalette) ? palette as HeatmapPalette : heatmapPalette;
          const crosstab = buildClusterCrosstab(t, attribute);
          if (!crosstab) return 'No composition values are available to export.';
          setBreakdownBy(attribute);
          setBreakdownDirection(useDirection);
          setHeatmapPalette(usePalette);
          await downloadClusterHeatmapPng({
              heatmap: buildClusterHeatmap(crosstab, useDirection),
              attribute,
              palette: usePalette,
          });
          return `Saved a ${usePalette} cluster-composition heatmap by ${attribute} (% of ${useDirection}); its 0–100% colour scale is included in the PNG.`;
      },

      saveRotatingGif: async () => {
          const error = await exportGIF();
          return error ?? `Saved a rotating GIF of the current 3D view (${colorBy} color${shapeBy ? `, ${shapeBy} marker shape` : ''}).`;
      },

      saveActiveViewPng: async () => {
          const error = await exportPNG();
          return error ?? `Saved a 2× PNG of the current ${viewMode} view.`;
      },

      saveInteractiveHtml: async () => {
          const error = await exportHTML();
          return error ?? `Saved an offline interactive HTML version of the current ${viewMode} view.`;
      },

      saveActiveDatasetCsv: () => {
          const error = exportDatasetCsv();
          return error ?? 'Saved the active dataset as CSV, including any PCA scores and Cluster labels.';
      },

      pinView: () => {
          if (pinnedViews.length >= 3) return 'Pin limit reached (3). Ask the user to remove a pin first.';
          pinCurrentView();
          return `Pinned the current view. ${pinnedViews.length + 1}/3 pins used.`;
      },

      loadDemoData: async () => {
          const existing = datasets.find(d => d.name === 'iris');
          if (existing) {
              if (existing.id !== activeId) selectDataset(existing.id);
              freshTableRef.current = existing.table;
              return `The demo dataset is already loaded (${existing.table.nRows} rows) and is now the active dataset — no need to load it again.`;
          }
          const table = await loadDemo();
          if (!table) return 'Demo data failed to load.';
          freshTableRef.current = table;
          return `Iris demo loaded: ${table.nRows} flowers, columns: ${table.columns.join(', ')}. It is now active in 3D: petal length × petal width × sepal length, colored by species. Marker shape is available for the tour to demonstrate.`;
      },

      runPCA: (opts) => {
          const t = latestTable();
          if (!t) return 'No dataset loaded.';
          const numeric = numericColumns(t).filter(c => !/^PC\d+(_|$)/.test(c) && c !== 'Cluster');
          const vars = (opts.variables?.length ? opts.variables : numeric.filter(c => !isIdentifierColumn(c)));
          const bad = vars.filter(v => !numeric.includes(v));
          if (bad.length) return `Not usable numeric variables: ${bad.join(', ')}. Available: ${numeric.join(', ')}.`;
          const label = sanitizeLabel(opts.label ?? '');
          if (opts.label && !label) return `"${opts.label}" is not usable as a run label — use letters, digits, _ or -.`;
          const missing: MissingStrategy = opts.missing === 'complete' ? 'complete' : 'median';
          return handleRunPCA(vars, Math.min(Math.max(opts.n_components ?? 3, 1), 10), opts.standardize ?? true, label, missing);
      },

      correlate: (colA, colB) => {
          const t = latestTable();
          if (!t) return 'No dataset loaded.';
          const bad = [colA, colB].filter(c => !c || !numericColumns(t).includes(c));
          if (bad.length) return `Not numeric columns: ${bad.join(', ')}. Numeric: ${numericColumns(t).join(', ')}.`;
          const { n, pearson, spearman } = correlation(t.data[colA], t.data[colB]);
          if (pearson == null) return `Not enough complete pairs (n=${n}) to correlate ${colA} and ${colB}.`;
          return `${colA} × ${colB}: Pearson r=${pearson.toFixed(3)}, Spearman rho=${spearman?.toFixed(3) ?? 'n/a'}, n=${n} (pairwise complete).`;
      },

      compareGroups: (numericCol, groupCol) => {
          const t = latestTable();
          if (!t) return 'No dataset loaded.';
          if (!numericColumns(t).includes(numericCol)) return `"${numericCol}" is not a numeric column. Numeric: ${numericColumns(t).join(', ')}.`;
          if (!t.columns.includes(groupCol)) return `"${groupCol}" is not a column.`;
          const res = statsCompareGroups(t.data[numericCol], t.data[groupCol]);
          if (!res.groups.length) return 'No complete observations to compare.';
          const lines = res.groups.map(g => `${g.group}: mean=${g.mean.toFixed(2)}, sd=${g.sd.toFixed(2)}, n=${g.n}`);
          return `${numericCol} by ${groupCol} (overall mean=${res.overall.mean.toFixed(2)}, sd=${res.overall.sd.toFixed(2)}, n=${res.overall.n}):\n${lines.join('\n')}\neta-squared=${res.etaSquared?.toFixed(3) ?? 'n/a'} (share of variance explained by group).`;
      },

      suggestK: (maxK) => {
          const t = latestTable();
          if (!t || !activeDataset) return 'No dataset loaded.';
          const ax = effectiveAxes(activeDataset, viewMode);
          // Diagnostics must see the same units the clustering will use, or the
          // suggestion answers a different question than the run
          const rawCols = [t.data[ax.x], t.data[ax.y], ...(ax.z ? [t.data[ax.z]] : [])];
          const cols = standardize ? zscoreCellColumns(rawCols) : rawCols;
          const rows = silhouetteByK(cols, kmeans, maxK);
          if (!rows.length) return 'Too few complete rows on the current axes to evaluate.';
          const best = rows.reduce((a, b) => (b.silhouette > a.silhouette ? b : a));
          return `Mean silhouette by k on (${[ax.x, ax.y, ax.z].filter(Boolean).join(', ')})${standardize ? ', z-scored' : ', raw scales'}:\n${rows.map(r => `k=${r.k}: ${r.silhouette.toFixed(3)}${r.k === best.k ? '  ← best' : ''}`).join('\n')}\n(Computed on up to 1200 sampled rows. Higher = better separated; values under ~0.25 suggest weak structure.)`;
      },

      suggestEps: (minSamplesArg) => {
          const t = latestTable();
          if (!t || !activeDataset) return 'No dataset loaded.';
          const ms = minSamplesArg ?? minSamples;
          const ax = effectiveAxes(activeDataset, viewMode);
          const rawCols = [t.data[ax.x], t.data[ax.y], ...(ax.z ? [t.data[ax.z]] : [])];
          const cols = standardize ? zscoreCellColumns(rawCols) : rawCols;
          if (ms < 2) return 'min_samples must be at least 2 for an eps suggestion — at min_samples=1 every point is its own core point, so eps stops affecting the result.';
          const res = kDistancePercentiles(cols, ms);
          if (!res) return 'Too few complete rows on the current axes.';
          const p = res.percentiles;
          return `k-distance percentiles for min_samples=${ms} on (${[ax.x, ax.y, ax.z].filter(Boolean).join(', ')})${standardize ? ' after z-scoring (eps will be in SD units)' : ' on raw scales'}: p50=${p.p50.toFixed(3)}, p75=${p.p75.toFixed(3)}, p90=${p.p90.toFixed(3)}, p95=${p.p95.toFixed(3)}, max=${p.max.toFixed(3)}. These are distances to each point's ${res.kthNeighbor}-nearest neighbour — min_samples counts the point itself, so that is the eps at which a point becomes a core point. A good eps usually sits near the knee (~p90–p95); smaller eps → more points labeled Noise. Computed on ${res.n} rows${res.n >= 2000 ? ' (an evenly-spaced sample, capped at 2000)' : ''}.`;
      },

      switchDataset: (name) => {
          const ds = datasets.find(d => d.name === name) ?? datasets.find(d => d.name.toLowerCase() === String(name).toLowerCase());
          if (!ds) return `No dataset named "${name}". Loaded: ${datasets.map(d => d.name).join(', ') || 'none'}.`;
          if (ds.id === activeId) return `"${ds.name}" is already active.`;
          selectDataset(ds.id);
          freshTableRef.current = ds.table;
          return `Switched active dataset to "${ds.name}" (${ds.table.nRows} rows).`;
      },

      setCategoryVisibility: (categories, state) => {
          const t = latestTable();
          if (!t) return 'No dataset loaded.';
          const vals = new Set((t.data[colorBy] ?? []).map(v => String(v ?? 'N/A')));
          const unknown = categories.filter(c => !vals.has(String(c)));
          if (unknown.length) return `Not categories of "${colorBy}": ${unknown.join(', ')}. Available: ${Array.from(vals).slice(0, 20).join(', ')}.`;
          setMutedMap(prev => {
              const next = { ...prev };
              for (const c of categories) {
                  if (state === 'normal') delete next[String(c)];
                  else next[String(c)] = state;
              }
              return next;
          });
          return `${state === 'normal' ? 'Restored' : state === 'muted' ? 'Muted' : 'Hid'} ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} of ${colorBy}.`;
      },

      transferColumn: ({ source_dataset, column, mode = 'order', key_column, new_name }) => {
          const tgt = activeDataset;
          if (!tgt) return 'No dataset loaded.';
          const src = datasets.find(d => d.name === source_dataset) ?? datasets.find(d => d.name.toLowerCase() === String(source_dataset).toLowerCase());
          if (!src) return `No dataset named "${source_dataset}". Loaded: ${datasets.map(d => d.name).join(', ')}.`;
          if (src.id === tgt.id) return 'Source and target are the same dataset.';
          if (!src.table.columns.includes(column)) return `"${column}" is not a column of ${src.name}. Its columns: ${src.table.columns.join(', ')}.`;
          if (mode === 'order' && src.table.nRows !== tgt.table.nRows) {
              return `Row counts differ (${src.table.nRows} vs ${tgt.table.nRows}) — order alignment would mis-join. Use mode=match with a shared key column. Shared columns: ${src.table.columns.filter(c => tgt.table.columns.includes(c)).join(', ') || 'none'}.`;
          }
          if (mode === 'match' && (!key_column || !src.table.columns.includes(key_column) || !tgt.table.columns.includes(key_column))) {
              return `mode=match needs a key_column present in both datasets. Shared columns: ${src.table.columns.filter(c => tgt.table.columns.includes(c)).join(', ') || 'none'}.`;
          }
          const name = (new_name?.trim() || `${column}·${src.name}`);
          const nt = handleTransfer({ sourceId: src.id, sourceCol: column, mode, keyCol: key_column ?? '', name });
          if (nt) freshTableRef.current = nt;
          const srcColArr = src.table.data[column];
          let filled = tgt.table.nRows;
          if (mode === 'match' && key_column) {
              const keys = new Set(src.table.data[key_column].map(String));
              filled = tgt.table.data[key_column].filter(v => keys.has(String(v))).length;
          }
          return `Transferred "${column}" from ${src.name} into the active dataset as "${name}" (${mode} mode, ~${filled}/${tgt.table.nRows} rows filled). Points are now colored by it.`;
      },

      removePin: (index) => {
          if (!pinnedViews.length) return 'There are no pinned views.';
          const i = Math.floor(index) - 1;
          if (i < 0 || i >= pinnedViews.length) return `Pin index out of range — there ${pinnedViews.length === 1 ? 'is 1 pin' : `are ${pinnedViews.length} pins`} (1-based). Pins: ${pinnedViews.map((v: any, j: number) => `${j + 1}: ${v.label}`).join('; ')}.`;
          const removed = pinnedViews[i];
          setPinnedViews(pinnedViews.filter((_: any, j: number) => j !== i));
          return `Removed pin ${index} (“${removed.label}”).`;
      },

      saveWorkspaceAs: async (name) => {
          const trimmed = String(name ?? '').trim();
          if (!trimmed) return 'Workspace name required.';
          if (datasets.length === 0) return 'Nothing to save — no dataset loaded.';
          try {
              await wsStore.saveWorkspace(trimmed, buildWorkspacePayload());
              await refreshWorkspaces();
              setWorkspaceName(trimmed);
              return `Workspace "${trimmed}" saved locally (IndexedDB). Note: this persists outside the view state and is not covered by undo.`;
          } catch (err: any) {
              return `Save failed: ${err?.message ?? err}`;
          }
      },

      controlView: ({ rotation, zoom, pan, pan_amount, reset_camera }) => {
          if (viewMode === '2D') {
              if (rotation) return 'Auto-rotation is 3D-only — the plot is currently 2D. Switch to 3D with set_plot first if you want to rotate.';
              if (reset_camera) {
                  setRange2d(null);
                  return zoom != null || pan
                      ? 'Done: 2D view reset to fit all points. The zoom/pan in the same call was skipped — call control_view again to re-frame from the full extent.'
                      : 'Done: 2D view reset to fit all points.';
              }
              if (zoom == null && !pan) return 'Nothing requested — in 2D pass zoom, pan, or reset_camera.';
              if (zoom != null && !(zoom > 0)) return 'zoom must be a positive number (e.g. 1.5 to zoom in, 0.7 to zoom out).';
              const cur = get2dRange();
              if (!cur) return 'Could not read the current axis ranges — the plot may not have finished rendering. Try again.';
              let [x0, x1] = cur.x;
              let [y0, y1] = cur.y;
              const acts2d: string[] = [];
              if (zoom != null) {
                  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
                  const hx = (x1 - x0) / 2 / zoom, hy = (y1 - y0) / 2 / zoom;
                  [x0, x1, y0, y1] = [cx - hx, cx + hx, cy - hy, cy + hy];
                  acts2d.push(`zoomed ${zoom > 1 ? 'in' : 'out'} (×${zoom})`);
              }
              if (pan) {
                  // Fraction of the visible span per step — clamped so one call
                  // can't fling the viewport somewhere with no points in it
                  const amt = Math.min(Math.max(pan_amount ?? 0.5, 0.05), 2);
                  const dx = (x1 - x0) * amt, dy = (y1 - y0) * amt;
                  if (pan === 'left') { x0 -= dx; x1 -= dx; }
                  else if (pan === 'right') { x0 += dx; x1 += dx; }
                  else if (pan === 'down') { y0 -= dy; y1 -= dy; }
                  else if (pan === 'up') { y0 += dy; y1 += dy; }
                  else return `Unknown pan direction "${pan}". Use left, right, up, or down.`;
                  acts2d.push(`panned ${pan} by ${Math.round(amt * 100)}% of the view`);
              }
              setRange2d({ x: [x0, x1], y: [y0, y1] });
              return `Done: ${acts2d.join('; ')}. Visible window is now x ${fmtRange(x0, x1)}, y ${fmtRange(y0, y1)}.`;
          }
          if (pan) return 'Directional pan is 2D-only — the plot is currently 3D, where framing is the camera angle. Use rotation/zoom/reset_camera, or switch to 2D with set_plot.';
          const acts: string[] = [];
          if (reset_camera) {
              setIsRotating(false);
              setCamera({ eye: { x: 1.8, y: 1.2, z: 0.5 } });
              acts.push('camera reset');
          }
          if (zoom != null) {
              if (!(zoom > 0)) return 'zoom must be a positive number (e.g. 1.5 to zoom in, 0.7 to zoom out).';
              setIsRotating(false);
              const eye = camera.eye;
              const dist = Math.sqrt(eye.x ** 2 + eye.y ** 2 + eye.z ** 2) || 2.2;
              const target = Math.min(Math.max(dist / zoom, 0.4), 12);
              const f = target / dist;
              setCamera({ eye: { x: eye.x * f, y: eye.y * f, z: eye.z * f } });
              acts.push(`zoomed ${zoom > 1 ? 'in' : 'out'} (×${zoom})`);
          }
          if (rotation) {
              setIsRotating(rotation === 'start');
              acts.push(`auto-rotation ${rotation === 'start' ? 'started' : 'stopped'}`);
          }
          return acts.length ? `Done: ${acts.join('; ')}.` : 'Nothing requested — in 3D pass rotation, zoom, or reset_camera.';
      },

      highlightUI: (target) => {
          if (!(GUIDE_TARGETS as readonly string[]).includes(target)) {
              return `Unknown target "${target}". Valid targets: ${GUIDE_TARGETS.join(', ')}.`;
          }
          const ok = flashGuide(target, theme === 'terminal' ? '#10ff50' : '#EB1A26');
          if (!ok) return `"${target}" is not on screen right now${datasets.length === 0 ? ' — sections after Data appear once a dataset is loaded' : ''}.`;
          return `Highlighted ${target} with an ephemeral arrow (~5s). Continue explaining while the user looks.`;
      },

      snapshot: () => ({
          datasets, activeId, colorBy, shapeBy, viewMode, showAxes, pinnedViews,
          clusterMethod, eps, minSamples, k, standardize, breakdownBy, breakdownDirection, heatmapPalette, mutedMap,
      }),

      restore: (snap: any) => {
          if (!snap) return;
          skipMuteReset.current = true;
          setDatasets(snap.datasets);
          setActiveId(snap.activeId);
          setColorBy(snap.colorBy);
          setShapeBy(snap.shapeBy ?? "");
          setViewMode(snap.viewMode);
          setShowAxes(snap.showAxes);
          setPinnedViews(snap.pinnedViews);
          setClusterMethod(snap.clusterMethod);
          setEps(snap.eps);
          setMinSamples(snap.minSamples);
          setK(snap.k);
          skipStdReset.current = true;
          setStandardize(snap.standardize ?? false);
          setBreakdownBy(snap.breakdownBy);
          setBreakdownDirection(snap.breakdownDirection === 'group' ? 'group' : 'cluster');
          setHeatmapPalette(HEATMAP_PALETTES.includes(snap.heatmapPalette) ? snap.heatmapPalette : 'Viridis');
          setMutedMap(snap.mutedMap);
          freshTableRef.current = null;
      },
  };
  // Console/testing access to the assistant bridge (local state only)
  if (typeof window !== 'undefined') (window as any).__scatterlabBridge = bridgeRef;

  const renderView = (view: any, index: number) => {
      // view object is either the active state or a pinned state
      const isPinned = view.id !== 'active';
      return (
          <div className="w-full h-full relative">
              {isPinned && (
                  <button 
                      onClick={() => removePin(view.id)}
                      className="absolute top-2 right-2 z-20 bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--border)] text-xs px-2 py-1 transition-colors"
                  >
                      <X className="w-4 h-4" />
                  </button>
              )}
              <ViewPlot
                  view={view}
                  layout={getLayout(view.label ?? (isPinned ? "Pinned View" : "Active View"), view.labels, view.viewMode, view.showAxes ?? false, (isPinned ? view.range2d : range2d) ?? null)}
                  onRelayout={(e: any) => {
                      if (view.id !== 'active') return;
                      if (view.viewMode === "3D") {
                          if (e['scene.camera'] && isRotating) {
                              setIsRotating(false);
                              setCamera(e['scene.camera']);
                          }
                          return;
                      }
                      // Mirror the user's own box-zoom/pan into state; without this
                      // the next re-render would re-apply the old layout and snap
                      // the plot back. Double-click sends autorange instead.
                      if (e['xaxis.autorange'] || e['yaxis.autorange']) { setRange2d(null); return; }
                      const x0 = e['xaxis.range[0]'], x1 = e['xaxis.range[1]'];
                      const y0 = e['yaxis.range[0]'], y1 = e['yaxis.range[1]'];
                      if ([x0, x1, y0, y1].every(v => typeof v === 'number' && Number.isFinite(v))) {
                          setRange2d({ x: [x0, x1], y: [y0, y1] });
                      }
                  }}
              />
          </div>
      );
  };

  if (!mounted) return null;

  // We construct the views array for TmuxGrid: active view is always first, then pinned views
  const allViews = processedData
      ? [{ id: 'active', data: processedData, colorBy, shapeBy, axes: effectiveAxes(activeDataset!, viewMode), labels: effectiveLabels(activeDataset!, viewMode), viewMode, showAxes: showAxes[viewMode], muted: mutedMap, label: `${activeDataset?.name} · live` }, ...pinnedViews]
      : [];

  return (
    <div className={`flex w-full h-screen bg-[var(--background)] text-[var(--foreground)] ${theme === 'terminal' ? 'moving-scanlines' : ''}`}>
      
      {/* Sidebar Controls */}
      <aside className="w-[320px] h-full bg-[var(--card)] border-r border-[var(--border)] flex flex-col p-6 overflow-y-auto relative z-10 flex-shrink-0">
        <div className="flex justify-between items-center mb-2">
            <h1 className={`flex items-center gap-2 text-xl font-bold tracking-tight ${theme === 'terminal' ? 'text-[var(--system-green)] system-green-glow' : ''}`}>
                {theme === 'primary' && (
                    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true" className="flex-shrink-0">
                        <rect x="3" y="14" width="13" height="13" fill="var(--p-blue)" stroke="#111111" strokeWidth="2" />
                        <circle cx="21" cy="11" r="7.5" fill="var(--p-red)" stroke="#111111" strokeWidth="2" />
                        <path d="M 16 28 L 22.5 17 L 29 28 Z" fill="var(--p-yellow)" stroke="#111111" strokeWidth="2" />
                    </svg>
                )}
                {APP_NAME}
            </h1>
            <button
                onClick={() => setTheme(theme === 'dark' || theme === 'terminal' ? 'primary' : 'terminal')}
                title={theme === 'terminal' ? 'Switch to Bauhaus theme' : 'Switch to Terminal theme'}
                className={`p-2 border ${theme === 'primary' ? 'bauhaus-btn bg-[var(--p-blue)] text-white' : 'border-[var(--border)] hover:bg-[var(--border)] text-[var(--system-green)] rounded'}`}
            >
                <Monitor className="w-4 h-4" />
            </button>
        </div>

        <div className="flex items-center gap-1.5 mb-6 text-[10px] uppercase tracking-wider opacity-70" title="All parsing, projection, and clustering run in your browser. Nothing is uploaded anywhere.">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
          All local — data never leaves your browser
        </div>

        <SidebarGroup theme={theme}>

          {/* Workspace persistence */}
          <SidebarSection title="Workspace" theme={theme} guide="workspace">
            <div className="flex gap-2">
              <input
                type="text"
                value={workspaceName}
                onChange={e => setWorkspaceName(e.target.value)}
                placeholder="Workspace name"
                className="flex-1 min-w-0 bg-[var(--input)] border border-[var(--border)] p-1.5 text-xs outline-none"
              />
              <button
                onClick={saveWorkspace}
                disabled={!workspaceName.trim() || !!workspaceBusy || datasets.length === 0}
                className={`px-3 text-xs font-bold disabled:opacity-40 ${theme === 'primary' ? 'bauhaus-btn bg-[var(--p-blue)] text-white' : 'bg-[var(--input)] border border-[var(--system-green)]/55 hover:bg-[var(--system-green)]/10 text-[var(--system-green)] cursor-pointer'}`}
              >
                Save
              </button>
            </div>
            {workspaces.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {workspaces.map(w => (
                  <div key={w.name} className="flex items-center justify-between gap-2 px-2 py-1 border border-[var(--border)] bg-[var(--input)] text-xs">
                    <button onClick={() => loadWorkspace(w.name)} className="flex-1 min-w-0 text-left hover:opacity-70" title={`Load "${w.name}" (saved ${w.saved_at.replace('T', ' ')})`}>
                      <span className="font-bold truncate block">{w.name}</span>
                      <span className="opacity-50 text-[10px]">{w.saved_at.replace('T', ' ')}</span>
                    </button>
                    <button onClick={() => deleteWorkspace(w.name)} className="flex-shrink-0 hover:opacity-50" title="Delete workspace">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {(datasets.length > 0 || workspaces.length > 0) && (
              <div className="flex gap-2 text-[11px]">
                {datasets.length > 0 && (
                  <button onClick={exportWorkspace} className="underline-offset-2 hover:underline opacity-60 hover:opacity-100 cursor-pointer">
                    Export as file
                  </button>
                )}
                <label className="underline-offset-2 hover:underline opacity-60 hover:opacity-100 cursor-pointer">
                  Import file
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) importWorkspace(f); e.target.value = ""; }}
                  />
                </label>
              </div>
            )}
            {workspaceBusy && <p className="text-[11px] opacity-70">{workspaceBusy}</p>}
          </SidebarSection>

          {/* Section 1: Ingestion */}
          <SidebarSection title="Data" step={1} theme={theme} guide="data" order={1}>
            {!processedData && (
              <div className={`flex justify-center mb-2 ${theme === 'terminal' ? 'text-[var(--system-green)] opacity-70' : 'opacity-40'}`}>
                <UploadCloud className="w-10 h-10" />
              </div>
            )}
            {([
              { key: 'ds' as const, ref: dsInputRef, file: datasetFile, set: setDatasetFile, empty: 'Drop dataset here or click to browse' },
              ...(showComponents || componentsFile
                ? [{ key: 'comp' as const, ref: compInputRef, file: componentsFile, set: setComponentsFile, empty: 'Drop PCA components file' }]
                : []),
            ]).map(zone => (
              <div
                key={zone.key}
                data-guide={zone.key === 'ds' ? 'upload-dropzone' : undefined}
                onClick={() => zone.ref.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(zone.key); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => {
                  e.preventDefault();
                  setDragOver(null);
                  const f = e.dataTransfer.files?.[0];
                  if (f) zone.set(f);
                }}
                className={`border-2 border-dashed p-3 flex flex-col items-center cursor-pointer transition-colors ${theme === 'primary' ? 'border-[3px] bg-white' : theme === 'terminal' ? 'border-[var(--system-green)]/45 text-[var(--system-green)] hover:border-[var(--system-green)] hover:bg-[var(--system-green)]/10' : ''} ${dragOver === zone.key
                  ? (theme === 'primary' ? 'border-[var(--p-blue)] bg-blue-50' : 'border-[var(--system-green)] bg-[var(--system-green)]/10')
                  : 'border-[var(--border)] hover:bg-[var(--foreground)]/5'}`}
              >
                <input type="file" className="hidden" accept=".csv,.xlsx,.parquet" ref={zone.ref} onChange={(e) => e.target.files && zone.set(e.target.files[0])} />
                {zone.file
                  ? <span className="text-xs font-medium text-center break-all">{zone.file.name}</span>
                  : <span className="text-xs font-medium opacity-50 text-center">{zone.empty}</span>}
              </div>
            ))}
            <button
              data-guide="components-toggle"
              onClick={() => { if (showComponents) setComponentsFile(null); setShowComponents(!showComponents); }}
              className="text-[11px] underline-offset-2 hover:underline opacity-60 hover:opacity-100 text-left cursor-pointer"
            >
              {showComponents || componentsFile ? '− Remove components file' : '+ Project through a PCA components file'}
            </button>
            <button data-guide="add-dataset" onClick={handleUpload} disabled={!datasetFile || isUploading} className={`scatterlab-action-button w-full text-sm font-bold py-2 disabled:opacity-50 ${theme === 'primary' ? 'bauhaus-btn bg-[var(--p-blue)] text-white' : 'bg-[var(--input)] border border-[var(--system-green)]/55 hover:bg-[var(--system-green)]/10 text-[var(--system-green)] cursor-pointer'}`}>
              {isUploading ? "Processing..." : "Add Dataset"}
            </button>
            {(datasetFile || componentsFile || processedData) && (
              <button onClick={handleClearData} className={`scatterlab-action-button w-full flex items-center justify-center gap-2 text-sm font-bold py-2 ${theme === 'primary' ? 'bauhaus-btn bg-white text-[var(--p-red)]' : 'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)] text-red-400'}`}>
                <Trash2 className="w-4 h-4" /> Clear All Data
              </button>
            )}
            {uploadStatus && (
              // whitespace-pre-line: parser warnings are newline-separated
              <p className="text-[11px] leading-snug opacity-70 break-words whitespace-pre-line">{uploadStatus}</p>
            )}
            {/^Error|failed|⚠/i.test(uploadStatus) && (
              <button
                onClick={() => askAssistantRef.current?.(/^Error|failed/i.test(uploadStatus)
                  ? `My upload failed with this message: "${uploadStatus}". Explain what's wrong with my file and how to fix it.`
                  : `My upload produced these warnings: "${uploadStatus}". Explain what they mean for my data and how to fix the file.`)}
                className="text-[11px] underline-offset-2 hover:underline opacity-60 hover:opacity-100 text-left cursor-pointer"
              >
                ✳ Ask the assistant about {/^Error|failed/i.test(uploadStatus) ? 'this error' : 'these warnings'}
              </button>
            )}
            {datasets.length > 0 && (
              <div className="space-y-1.5 pt-1" data-guide="datasets-list">
                {datasets.map(d => (
                  <div key={d.id} onClick={() => selectDataset(d.id)}
                    className={`flex items-center justify-between gap-2 px-2 py-1.5 cursor-pointer border text-xs ${d.id === activeId
                      ? (theme === 'primary' ? 'border-[3px] border-[var(--border)] bg-[var(--p-yellow)] font-bold' : 'border-[var(--primary)] text-[var(--primary)] bg-[var(--border)]')
                      : 'border-[var(--border)] bg-[var(--input)] opacity-70 hover:opacity-100'}`}>
                    <span className="truncate" title={d.name}>{d.name}</span>
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="opacity-60">{d.table.nRows} rows</span>
                      <button onClick={(e) => { e.stopPropagation(); removeDataset(d.id); }} className="hover:opacity-50" title="Remove dataset">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {datasets.length >= 2 && (
              <ColumnTransfer datasets={datasets} activeId={activeId} onTransfer={handleTransfer} />
            )}
          </SidebarSection>

          {processedData && (
            <>
              <SidebarSection title="Variables" step={2} hasBorder theme={theme} guide="variables" order={2}>
                <div className="text-[11px] opacity-60 -mt-1">
                  {processedData.nRows} rows × {processedData.columns.length} columns — click X · Y · Z to plot, C to color, S to shape
                </div>
                {activeDataset?.summary?.top_contributors && (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-bold uppercase tracking-wider opacity-60 text-[10px]">
                      Top PC contributors
                    </summary>
                    <div className="text-[10px] opacity-60 pt-1">
                      Unit-norm eigenvector weights (scikit-learn <code>components_</code>).
                      <InfoTip topic="pca_loadings" />
                    </div>
                    <div className="pt-1 space-y-1">
                      {Object.entries(activeDataset.summary.top_contributors).map(([pc, vars]: [string, any]) => (
                        <div key={pc} className="leading-snug">
                          <span className="font-bold">{pc}:</span>{' '}
                          {vars.slice(0, 4).map((v: any, i: number) => (
                            <span key={v.var}>{i > 0 && ', '}{v.var} <span className="opacity-60">{v.loading > 0 ? '+' : ''}{v.loading}</span></span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {activeDataset && (
                  <VariablesPanel
                    dataset={activeDataset}
                    viewMode={viewMode}
                    colorBy={colorBy}
                    shapeBy={shapeBy}
                    theme={theme}
                    onAxis={(axis, col) => updateAxis(axis, col)}
                    onColor={setColorBy}
                    onShape={col => setShapeBy(prev => (prev === col ? "" : col))}
                  />
                )}
              </SidebarSection>

              <SidebarSection title="PCA" step={3} hasBorder theme={theme} guide="pca" order={3}>
                {processedData && (
                  <PCASection
                    table={processedData}
                    datasetId={activeId ?? -1}
                    theme={theme}
                    lastRun={pcaInfo}
                    runs={activeDataset?.pcaRuns ?? []}
                    onRun={handleRunPCA}
                  />
                )}
              </SidebarSection>

              <SidebarSection title="View" step={5} hasBorder theme={theme} guide="view" order={5}>
                <div className="flex gap-2 mb-2">
                    <button onClick={() => setViewMode("2D")} className={`scatterlab-action-button flex-1 py-1 text-xs font-bold border ${viewMode === "2D" ? (theme==='primary'?'bg-[var(--p-yellow)] border-[var(--p-black)] border-[3px]':'bg-[var(--primary)] border-[var(--primary)] text-white') : 'border-[var(--border)] bg-[var(--input)] opacity-60'}`}>2D</button>
                    <button onClick={() => setViewMode("3D")} className={`scatterlab-action-button flex-1 py-1 text-xs font-bold border ${viewMode === "3D" ? (theme==='primary'?'bg-[var(--p-yellow)] border-[var(--p-black)] border-[3px]':'bg-[var(--primary)] border-[var(--primary)] text-white') : 'border-[var(--border)] bg-[var(--input)] opacity-60'}`}>3D</button>
                </div>

                <button
                    onClick={() => setShowAxes({ ...showAxes, [viewMode]: !showAxes[viewMode] })}
                    className={`scatterlab-action-button w-full py-1 mb-2 text-xs font-bold border ${showAxes[viewMode] ? (theme==='primary'?'bg-[var(--p-yellow)] border-[var(--p-black)] border-[3px]':'bg-[var(--system-green)] border-[var(--system-green)] text-black') : (theme==='primary'?'border-[var(--border)] bg-[var(--input)] opacity-60':'bg-[var(--primary)] border-[var(--primary)] text-white')}`}
                >
                    {showAxes[viewMode] ? "Axes: On" : "Axes: Off"}
                </button>

                <div className="space-y-1">
                    <label className="text-xs font-medium opacity-70">Axis labels</label>
                    {(viewMode === "2D" ? (['x', 'y'] as const) : (['x', 'y', 'z'] as const)).map((axis: 'x' | 'y' | 'z') => {
                        const is2D = viewMode === "2D";
                        const colValue = is2D
                            ? (axis === 'z' ? '' : activeDataset?.axes2d[axis] ?? '')
                            : (activeDataset?.axes[axis] ?? '');
                        const labelValue = is2D
                            ? (axis === 'z' ? '' : activeDataset?.labels2d[axis] ?? '')
                            : (activeDataset?.labels[axis] ?? '');
                        return (
                            <div key={axis} className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold w-3 uppercase opacity-60">{axis}</span>
                                <span className="w-24 truncate text-[11px] opacity-60" title={colValue}>{colValue || '—'}</span>
                                <input
                                    type="text"
                                    value={labelValue}
                                    onChange={e => updateLabel(axis, e.target.value)}
                                    className="flex-1 min-w-0 bg-[var(--input)] border border-[var(--border)] p-1.5 text-xs"
                                    placeholder="display label"
                                    disabled={!colValue}
                                />
                            </div>
                        );
                    })}
                </div>

                <button onClick={() => setIsRotating(!isRotating)} disabled={viewMode === '2D'} className={`scatterlab-action-button w-full flex items-center justify-center gap-2 py-2 text-sm font-bold transition-colors disabled:opacity-30 ${isRotating ? (theme==='primary'?'bauhaus-btn bg-[var(--p-red)] text-white':'bg-[var(--primary)] text-white border border-[var(--primary)]') : (theme==='primary'?'bauhaus-btn bg-[var(--p-black)] text-white':'bg-[var(--system-green)] text-black border border-[var(--system-green)]')}`}>
                    {isRotating ? <><Square className="w-4 h-4" /> Stop Rotation</> : <><Play className="w-4 h-4" /> Start Rotation</>}
                </button>
                <Separator dashed className="scatterlab-view-divider" />
                <button onClick={pinCurrentView} className={`scatterlab-action-button w-full flex items-center justify-center gap-2 py-2 text-sm font-bold ${theme==='primary'?'bauhaus-btn bg-[var(--p-red)] text-white':'bg-[var(--primary)] border border-[var(--primary)] text-white'}`}>
                    <Pin className="w-4 h-4" /> Pin View
                </button>
              </SidebarSection>

              <SidebarSection title="Cluster" step={4} hasBorder theme={theme} guide="cluster" order={4}>
                <select className="w-full bg-[var(--input)] border border-[var(--border)] p-2 text-sm outline-none" value={clusterMethod} onChange={(e) => setClusterMethod(e.target.value)}>
                    <option value="NONE">None</option>
                    <option value="DBSCAN">DBSCAN (density-based)</option>
                    <option value="KMEANS">K-Means (deterministic)</option>
                </select>

                {/* B3: clustering runs on the plotted axes and nothing else. Naming
                    them live also makes the limitation self-evident the moment
                    someone plots two arbitrary raw columns. */}
                {clusterMethod !== "NONE" && activeDataset && (
                    <div className="text-[11px] leading-snug opacity-70">
                        Clusters on the plotted {viewMode === "2D" ? 'axes' : 'axes'}:{' '}
                        <b>{[axNow?.x, axNow?.y, axNow?.z].filter(Boolean).join(' · ')}</b>
                        <InfoTip topic="clusters_plotted_axes" />
                    </div>
                )}

                {clusterMethod === "DBSCAN" && (
                    <div className="space-y-2 text-sm">
                        <label className="flex justify-between">
                            <span className="opacity-70">
                                EPS <span className="opacity-70">({standardize ? 'SD units' : 'axis units'})</span>:
                                <InfoTip topic="dbscan_parameters" />
                            </span>
                            <span>{eps}</span>
                        </label>
                        <input type="range" min="0.1" max="5" step="0.1" value={eps} onChange={e => setEps(parseFloat(e.target.value))} className="w-full" />
                        <label className="flex justify-between"><span className="opacity-70">Min Samples:</span> <span>{minSamples}</span></label>
                        <input type="range" min="1" max="50" step="1" value={minSamples} onChange={e => setMinSamples(parseInt(e.target.value))} className="w-full" />
                        {minSamples < 2 && (
                            <p className="text-[10px] leading-snug text-[var(--p-red)]">
                                At min samples = 1 every point is its own core point, so eps stops affecting the result.
                            </p>
                        )}
                    </div>
                )}
                {clusterMethod === "KMEANS" && (
                    <div className="space-y-2 text-sm">
                        <label className="flex justify-between">
                            <span className="opacity-70">K (Clusters):<InfoTip topic="kmeans_deterministic" /></span>
                            <span>{k}</span>
                        </label>
                        <input type="range" min="2" max="20" step="1" value={k} onChange={e => setK(parseInt(e.target.value))} className="w-full" />
                    </div>
                )}
                {clusterMethod !== "NONE" && (
                    <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                        <input type="checkbox" checked={standardize} onChange={e => setStandardize(e.target.checked)} />
                        <span className="opacity-80">Standardize variables (z-score)</span>
                        <InfoTip topic="standardize_clustering" />
                    </label>
                )}
                {clusterMethod !== "NONE" && (
                    <button onClick={handleCluster} disabled={isClustering} className={`w-full text-sm font-bold py-2 disabled:opacity-50 ${theme === 'primary' ? 'bauhaus-btn bg-[var(--p-red)] text-white' : 'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)] text-[var(--abaci)]'}`}>
                        {isClustering ? "Clustering..." : "Run Clustering"}
                    </button>
                )}
                {clusterMethod !== "NONE" && (
                    <p className="text-[10px] leading-snug opacity-60">
                        Missing values are filled with the column median before the distance maths.
                        <InfoTip topic="median_imputation" />
                    </p>
                )}
                {processedData.columns.includes('Cluster') && (
                    <ClusterBreakdown
                        table={processedData}
                        attr={breakdownBy}
                        onAttrChange={setBreakdownBy}
                        direction={breakdownDirection}
                        onDirectionChange={setBreakdownDirection}
                        palette={heatmapPalette}
                        onPaletteChange={setHeatmapPalette}
                    />
                )}
                  </SidebarSection>

              <SidebarSection title="Export" step={6} hasBorder theme={theme} guide="export" order={6}>
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={exportPNG} disabled={!!isExporting} title="Save PNG of the active view" className={`scatterlab-action-button flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 text-[10px] font-bold disabled:opacity-40 ${theme==='primary'?'bauhaus-btn bg-[var(--p-blue)] text-white':'bg-[var(--input)] border border-[var(--primary)] text-[var(--primary)]'}`}>
                      <Download className="h-4 w-4" /> PNG
                    </button>
                    <button ref={gifButtonRef} onClick={exportGIF} disabled={viewMode === "2D" || !!isExporting} title="Save rotating GIF (3D only)" className={`scatterlab-action-button flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 text-[10px] font-bold disabled:opacity-40 ${theme==='primary'?'bauhaus-btn bg-[var(--p-yellow)] text-[#111111]':'bg-[var(--input)] border border-[var(--primary)] text-[var(--primary)]'}`}>
                      <Download className="h-4 w-4" /> GIF
                    </button>
                    <button onClick={exportHTML} disabled={!!isExporting} title="Save interactive HTML" className={`scatterlab-action-button flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 text-[10px] font-bold disabled:opacity-40 ${theme==='primary'?'bauhaus-btn bg-[var(--p-red)] text-white':'bg-[var(--input)] border border-[var(--primary)] text-[var(--primary)]'}`}>
                      <Download className="h-4 w-4" /> HTML
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                      <input type="checkbox" checked={includeExportInfo} onChange={e => setIncludeExportInfo(e.target.checked)} />
                      <span className="opacity-80">Add title & legend to exports</span>
                  </label>
                  <button onClick={exportDatasetCsv} disabled={!!isExporting} className={`scatterlab-action-button w-full flex items-center justify-center gap-2 py-2 text-sm font-bold disabled:opacity-40 ${theme==='primary'?'bauhaus-btn bg-white text-black':'bg-[var(--system-green)] border border-[var(--system-green)] text-black'}`}>
                      <Download className="w-4 h-4" /> Save Dataset CSV
                  </button>
              </SidebarSection>
            </>
          )}
        </SidebarGroup>
      </aside>

      {/* Dynamic Divider for Terminal Theme */}
      {theme === 'terminal' && (
        <div className="h-full px-1 flex items-center justify-center bg-transparent relative z-20 w-[6px]">
          <div className="vertical-neon-line h-full w-[2px] mx-auto" />
        </div>
      )}

      {/* Main visualizer area */}
      <main className={`flex-1 relative bg-[var(--background)] z-10 flex overflow-hidden ${assistantDock === 'bottom' ? 'flex-col' : ''}`}>
        <div className="flex-1 relative min-w-0 min-h-0 flex overflow-hidden">
          {allViews.length > 0 ? (
              <>
                  <TmuxGrid views={allViews} renderView={renderView} />
                  <ThemedNotes notes={notes} setNotes={setNotes} theme={theme} />
                  <ThemedLegend view={allViews[0]} theme={theme} muted={mutedMap} onToggle={toggleMuted} />
              </>
          ) : (
              <EmptyState theme={theme} onLoadDemo={loadDemo} onUpload={() => dsInputRef.current?.click()} busy={isUploading} />
          )}
        </div>
        <AssistantPanel bridgeRef={bridgeRef} theme={theme} askRef={askAssistantRef} dock={assistantDock} onDockChange={changeDock} />
      </main>
    </div>
  );
}
