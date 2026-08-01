"use client";
import { useEffect, useState, useRef, useMemo } from "react";
import { UploadCloud, FileSpreadsheet, Play, Square, Download, Pin, Layers, Monitor, X, Trash2 } from "lucide-react";
import dynamic from 'next/dynamic';
import { useTheme } from "next-themes";
import { TmuxGrid } from "@/components/TmuxGrid";
import { CyberStackGroup, CyberContainer, CyberPanel, CyberInput, CyberTextArea } from "ccru/components";


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

const ThemedLegend = ({ view, theme, muted = {}, onToggle }: { view: any, theme: string | undefined, muted?: MuteMap, onToggle?: (val: any) => void }) => {
    const legendInfo = useMemo(() => {
        const colVals: any[] = view.data?.data?.[view.colorBy] ?? [];
        const kind = getColorFieldKind(colVals);
        if (kind === "categorical") {
            return { kind, values: Array.from(new Set(colVals.map((v: any) => v ?? "N/A"))) };
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
                            style={{ backgroundColor: state ? 'transparent' : colors[i % colors.length] }}
                        />
                        <span className={`truncate ${textClass} ${state === 'hidden' ? 'opacity-25 line-through' : state === 'muted' ? 'opacity-40' : ''}`} title={String(val)}>{String(val)}</span>
                    </button>
                );
            })}
        </div>
    );

    if (theme === 'terminal') {
        return (
            <div className="absolute top-1/4 right-0 z-30">
                <CyberPanel id="legend-panel" title="Legend" width={200} collapseDirection="side" positionMode="relative" position={{x:0, y:0}} onDragStart={() => {}}>
                    <div className="p-3 w-full">
                        <div className="text-[10px] font-bold mb-2 uppercase tracking-widest text-[#10ff50]/70">{view.colorBy}</div>
                        {innerContent}
                    </div>
                </CyberPanel>
            </div>
        );
    }
    
    return (
        <div className="absolute top-1/4 right-0 z-30">
            <PrimaryCollapsible title={view.colorBy} mode="side" width={200}>
                {innerContent}
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

// A cached upload: processed table, upload-time profile, and its plot-axis choices.
// 3D (axes) and 2D (axes2d) are independent so picking a 2D pair never disturbs
// the 3D triple. labels are display overrides — they default to the column names.
type Dataset = {
    id: number, name: string, table: DataTable, summary: any,
    axes: Axes, labels: AxisLabels,
    axes2d: Axes2D, labels2d: Axes2D,
};

// The axes a view actually plots, given its mode
const effectiveAxes = (d: Dataset, mode: "3D" | "2D"): Axes =>
    mode === "2D" ? { x: d.axes2d.x, y: d.axes2d.y, z: null } : d.axes;
const effectiveLabels = (d: Dataset, mode: "3D" | "2D"): AxisLabels =>
    mode === "2D" ? { x: d.labels2d.x, y: d.labels2d.y, z: 'Z' } : d.labels;

// Keep the color selection when the target dataset shares the column
const pickColorBy = (columns: string[], current: string) => {
    if (current && columns.includes(current)) return current;
    return columns.includes("Cluster") ? "Cluster" : columns[0];
};

const numericColumns = (table: DataTable) =>
    table.columns.filter(c => (table.data[c] ?? []).some(v => typeof v === 'number'));

// PC columns (from a components run) win; otherwise the first numeric columns
const pickAxes = (table: DataTable): Axes => {
    if (['PC1', 'PC2', 'PC3'].every(c => table.columns.includes(c))) {
        return { x: 'PC1', y: 'PC2', z: 'PC3' };
    }
    const nums = numericColumns(table);
    return { x: nums[0], y: nums[1], z: nums[2] ?? null };
};

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

const buildTraces = (table: DataTable | null, colorField: string, mode: "3D" | "2D", axes: Axes, labels: AxisLabels, muted: MuteMap = {}) => {
    if (!table || table.nRows === 0) return [];
    const n = table.nRows;
    const px = table.data[axes.x] ?? [];
    const py = table.data[axes.y] ?? [];
    const pz = axes.z ? (table.data[axes.z] ?? []) : new Array(n).fill(0);
    const colorVals = table.data[colorField] ?? [];

    const traces: any[] = [];
    const colors = ['#4195DE', '#D23B72', '#FFD600', '#5F4690', '#1D6996', '#38A6A5', '#0F8554', '#73AF48', '#EDAD08', '#E17C05'];
    const hovertemplate = mode === "3D"
        ? `${labels.x}: %{x:.2f}<br>${labels.y}: %{y:.2f}<br>${labels.z}: %{z:.2f}<extra></extra>`
        : `${labels.x}: %{x:.2f}<br>${labels.y}: %{y:.2f}<extra></extra>`;

    const kind = getColorFieldKind(colorVals);

    if (kind === "categorical") {
        const grouped: any = {};
        for (let i = 0; i < n; i++) {
            const val = colorVals[i] ?? "N/A";
            if (!grouped[val]) grouped[val] = { x: [], y: [], z: [] };
            grouped[val].x.push(px[i]);
            grouped[val].y.push(py[i]);
            grouped[val].z.push(pz[i]);
        }
        Object.keys(grouped).forEach((key, i) => {
            // Muted/hidden categories keep their trace slot so colors don't shift:
            // 'muted' renders hollow with a thin grey outline, 'hidden' is invisible
            const state = muted[key];
            traces.push({
                x: grouped[key].x,
                y: grouped[key].y,
                z: mode === "3D" ? grouped[key].z : undefined,
                visible: state !== 'hidden',
                mode: 'markers',
                type: mode === "3D" ? 'scatter3d' : 'scatter',
                name: String(key),
                marker: state === 'muted'
                    ? { size: mode === "3D" ? 4 : 6, color: 'rgba(0,0,0,0)', opacity: 0.5, line: { color: '#999999', width: 1 } }
                    : { size: mode === "3D" ? 4 : 6, color: colors[i % colors.length], opacity: 0.7 },
                hovertemplate
            });
        });
    } else {
        // Single trace: the columnar arrays go to Plotly as-is, no reshaping.
        // Continuous fields get a Viridis colorscale, overflowing categoricals a flat color.
        traces.push({
            x: px,
            y: py,
            z: mode === "3D" ? pz : undefined,
            mode: 'markers',
            type: mode === "3D" ? 'scatter3d' : 'scatter',
            name: colorField,
            marker: {
                size: mode === "3D" ? 4 : 6,
                opacity: 0.7,
                ...(kind === "continuous"
                    ? { color: colorVals, colorscale: 'Viridis', showscale: false }
                    : { color: '#4195DE' })
            },
            hovertemplate
        });
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

        traces.push({
            x: shadow_x,
            y: shadow_y,
            z: new Array(shadow_x.length).fill(z_floor),
            mode: 'markers',
            type: 'scatter3d',
            marker: { size: 2, color: '#111111', opacity: 0.1 },
            showlegend: false,
            hoverinfo: 'skip'
        });

        traces.push({
            x: [x_min, x_max, x_max, x_min],
            y: [y_min, y_min, y_max, y_max],
            z: [z_floor, z_floor, z_floor, z_floor],
            type: 'mesh3d',
            color: '#111111',
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
const VariablesPanel = ({ dataset, viewMode, colorBy, theme, onAxis, onColor }: {
    dataset: Dataset, viewMode: "3D" | "2D", colorBy: string, theme: string | undefined,
    onAxis: (axis: 'x' | 'y' | 'z', col: string) => void, onColor: (col: string) => void,
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
    const AXIS_STYLE: Record<string, string> = { x: 'var(--p-red)', y: 'var(--p-blue)', z: 'var(--p-yellow)', c: 'var(--p-black)' };
    const activeStyle = (slot: string) => theme === 'primary'
        ? { backgroundColor: AXIS_STYLE[slot], color: slot === 'z' ? '#111111' : '#FFFFFF', borderColor: '#111111' }
        : { backgroundColor: 'var(--system-green)', color: '#000000', borderColor: 'var(--system-green)' };

    const slotBtn = (slot: 'x' | 'y' | 'z' | 'c', p: { col: string }, active: boolean, disabled = false) => (
        <button
            key={slot}
            disabled={disabled}
            onClick={() => slot === 'c' ? onColor(p.col) : onAxis(slot, p.col)}
            title={slot === 'c' ? `Color by ${p.col}` : `Plot ${p.col} on the ${slot.toUpperCase()} axis`}
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
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// First-run landing: an abstract scatter built from the Bauhaus glyphs, three
// steps, and a zero-friction demo loader. Occupies the otherwise-blank canvas.
const EmptyState = ({ theme, onLoadDemo, busy }: { theme: string | undefined, onLoadDemo: () => void, busy: boolean }) => {
    const steps = [
        "Add a dataset — CSV, XLSX, or Parquet",
        "Assign variables to X · Y · Z and color",
        "Cluster, pin comparisons, export",
    ];

    if (theme === 'terminal') {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <div className="max-w-md w-full mx-6 border border-[var(--system-green)]/40 bg-black/60 p-8 space-y-5">
                    <div className="text-[var(--system-green)] text-lg font-bold tracking-widest uppercase mauk-glow">Awaiting data_</div>
                    <div className="space-y-2">
                        {steps.map((s, i) => (
                            <div key={i} className="flex gap-3 text-sm text-[var(--foreground)]">
                                <span className="text-[var(--system-green)] flex-shrink-0">[{i + 1}]</span>
                                <span>{s}</span>
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={onLoadDemo}
                        disabled={busy}
                        className="w-full py-2 text-sm font-bold border border-[var(--system-green)] text-[var(--system-green)] hover:bg-[var(--system-green)]/10 disabled:opacity-40 cursor-pointer"
                    >
                        {busy ? "Loading…" : "> load demo data"}
                    </button>
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
                <button
                    onClick={onLoadDemo}
                    disabled={busy}
                    className="bauhaus-btn w-full py-2.5 text-sm font-bold bg-[var(--p-yellow)] text-[#111111] disabled:opacity-40 cursor-pointer"
                >
                    {busy ? "Loading…" : "Load demo data"}
                </button>
            </div>
        </div>
    );
};

// Cluster × attribute cross-tab: per cluster, what share each attribute value
// holds. Pure client-side compute over the columnar table.
const ClusterBreakdown = ({ table, attr, onAttrChange }: { table: DataTable, attr: string, onAttrChange: (v: string) => void }) => {
    // 'cluster': composition within each cluster (denominator = cluster size).
    // 'group': where each attribute group's members land (denominator = group size) —
    // normalizes away base rates, so dominant groups stop swamping every cluster.
    const [dir, setDir] = useState<'cluster' | 'group'>('cluster');
    const candidates = useMemo(
        () => table.columns.filter(c => c !== 'Cluster' && getColorFieldKind(table.data[c] ?? []) === 'categorical'),
        [table]
    );
    const effAttr = candidates.includes(attr) ? attr : candidates[0];
    const crosstab = useMemo(() => {
        const clusterCol = table.data.Cluster;
        const attrVals = effAttr ? table.data[effAttr] : null;
        if (!clusterCol || !attrVals) return null;
        type Section = { total: number, counts: Record<string, number> };
        const byCluster: Record<string, Section> = {};
        const byGroup: Record<string, Section> = {};
        for (let i = 0; i < table.nRows; i++) {
            const c = String(clusterCol[i] ?? 'N/A');
            const a = String(attrVals[i] ?? 'N/A');
            if (!byCluster[c]) byCluster[c] = { total: 0, counts: {} };
            byCluster[c].total++;
            byCluster[c].counts[a] = (byCluster[c].counts[a] || 0) + 1;
            if (!byGroup[a]) byGroup[a] = { total: 0, counts: {} };
            byGroup[a].total++;
            byGroup[a].counts[c] = (byGroup[a].counts[c] || 0) + 1;
        }
        return { byCluster, byGroup };
    }, [table, effAttr]);

    if (!crosstab || !effAttr) return null;
    const clusterSort = (a: string, b: string) => {
        if (a === 'Noise') return 1;
        if (b === 'Noise') return -1;
        return a.localeCompare(b, undefined, { numeric: true });
    };
    const sections = dir === 'cluster' ? crosstab.byCluster : crosstab.byGroup;
    const sectionKeys = dir === 'cluster'
        ? Object.keys(sections).sort(clusterSort)
        : Object.keys(sections).sort((a, b) => sections[b].total - sections[a].total);

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
                        onClick={() => setDir(d)}
                        className={`flex-1 py-1 text-[10px] font-bold border ${dir === d ? 'bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]' : 'bg-[var(--input)] border-[var(--border)] opacity-60 hover:opacity-100'}`}
                    >
                        % of {d}
                    </button>
                ))}
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
// Steps cycle through the Bauhaus triad; yellow flips to black text for contrast
const STEP_COLORS = [
    { bg: 'var(--p-red)', fg: '#FFFFFF' },
    { bg: 'var(--p-blue)', fg: '#FFFFFF' },
    { bg: 'var(--p-yellow)', fg: '#111111' },
];

const SidebarSection = ({ title, step, children, hasBorder = false, theme }: { title: string, step?: number, children: React.ReactNode, hasBorder?: boolean, theme: string | undefined }) => {
    if (theme === 'terminal') {
        return (
            <CyberContainer title={step != null ? `${step}. ${title}` : title} collapsible defaultOpen width={"100%" as any}>
                {children}
            </CyberContainer>
        );
    }
    const c = step != null ? STEP_COLORS[(step - 1) % STEP_COLORS.length] : null;
    return (
        <div className={`space-y-3 ${hasBorder ? 'border-t border-[var(--border)] pt-6' : ''}`}>
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
        return <CyberStackGroup className="flex-grow">{children}</CyberStackGroup>;
    }
    return <div className="flex-grow flex flex-col gap-6">{children}</div>;
};

const ViewPlot = ({ view, layout, onRelayout }: { view: any, layout: any, onRelayout: (e: any) => void }) => {
    const traces = useMemo(
        () => buildTraces(view.data, view.colorBy, view.viewMode, view.axes, view.labels, view.muted ?? {}),
        [view.data, view.colorBy, view.viewMode, view.axes, view.labels, view.muted]
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
  const [healthStatus, setHealthStatus] = useState<string>("Checking backend connection...");
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [componentsFile, setComponentsFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isExporting, setIsExporting] = useState("");
  const [includeExportInfo, setIncludeExportInfo] = useState(true);
  
  // Data state: cached datasets (columnar — see DataTable), one active at a time
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [colorBy, setColorBy] = useState<string>("");
  const activeDataset = datasets.find(d => d.id === activeId) ?? null;
  const processedData = activeDataset?.table ?? null;
  const availableColumns = processedData?.columns ?? [];
  
  // Plot state
  const [viewMode, setViewMode] = useState<"3D" | "2D">("3D");
  const [showAxes, setShowAxes] = useState<{ "3D": boolean, "2D": boolean }>({ "3D": false, "2D": true });
  const [camera, setCamera] = useState({ eye: { x: 1.8, y: 1.2, z: 0.5 } });
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


  // Clustering state
  const [clusterMethod, setClusterMethod] = useState("NONE");
  const [eps, setEps] = useState(0.5);
  const [minSamples, setMinSamples] = useState(5);
  const [k, setK] = useState(3);
  const [isClustering, setIsClustering] = useState(false);
  const [breakdownBy, setBreakdownBy] = useState<string>("");

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
    fetch("http://localhost:8000/api/health")
      .then((res) => res.json())
      .then((data) => setHealthStatus(data.message))
      .catch(() => setHealthStatus("Backend Disconnected / Error"));
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

  const uploadFiles = async (dsFile: File, compFile: File | null) => {
    setIsUploading(true);
    setUploadStatus("Uploading...");

    const formData = new FormData();
    formData.append("dataset", dsFile);
    if (compFile) formData.append("components", compFile);

    try {
      const res = await fetch("http://localhost:8000/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.error) {
        setUploadStatus(`Error: ${data.error}`);
      } else {
        setUploadStatus(data.message);
        const id = Date.now();
        const table: DataTable = { columns: data.columns, data: data.data, nRows: data.n_rows };
        const axes = pickAxes(table);
        const dataset: Dataset = {
          id,
          name: dsFile.name.replace(/\.(csv|xlsx|parquet)$/i, ''),
          table,
          summary: data.summary,
          axes,
          labels: defaultLabels(axes),
          axes2d: { x: axes.x, y: axes.y },
          labels2d: { x: axes.x, y: axes.y },
        };
        setDatasets(prev => [...prev, dataset]);
        setActiveId(id);
        setColorBy(pickColorBy(data.columns, colorBy));
        if (!axes.z) setViewMode("2D");
        // Consume the file selections so the slots are free for the next dataset
        setDatasetFile(null);
        setComponentsFile(null);
        if (dsInputRef.current) dsInputRef.current.value = "";
        if (compInputRef.current) compInputRef.current.value = "";
      }
    } catch (err) {
      setUploadStatus("Upload failed. Ensure backend is running.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpload = () => { if (datasetFile) uploadFiles(datasetFile, componentsFile); };

  // Demo data ships with the app (public/demo) so the empty state can offer a
  // zero-friction first run: synthetic survey + components, nothing sensitive
  const loadDemo = async () => {
    setIsUploading(true);
    setUploadStatus("Loading demo data…");
    try {
      const [ds, comp] = await Promise.all([
        fetch('/demo/demo_dataset.csv').then(r => r.blob()),
        fetch('/demo/demo_components.csv').then(r => r.blob()),
      ]);
      await uploadFiles(
        new File([ds], 'demo_dataset.csv', { type: 'text/csv' }),
        new File([comp], 'demo_components.csv', { type: 'text/csv' }),
      );
    } catch {
      setUploadStatus("Demo data failed to load.");
      setIsUploading(false);
    }
  };

  const selectDataset = (id: number) => {
      setActiveId(id);
      const ds = datasets.find(d => d.id === id);
      if (ds) {
          setColorBy(pickColorBy(ds.table.columns, colorBy));
          if (!ds.axes.z) setViewMode("2D");
      }
  };

  // --- Workspace persistence -------------------------------------------------
  const refreshWorkspaces = async () => {
      try {
          const res = await fetch("http://localhost:8000/api/workspaces");
          const data = await res.json();
          if (data.workspaces) setWorkspaces(data.workspaces);
      } catch { /* backend down — list stays empty */ }
  };
  useEffect(() => { refreshWorkspaces(); }, []);

  const saveWorkspace = async () => {
      const name = workspaceName.trim();
      if (!name) return;
      setWorkspaceBusy("Saving…");
      // Dedupe tables by object identity: datasets and pins that share a table
      // (or a pin's snapshot) are stored once and referenced by id
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
      const payload = {
          version: 1,
          tables, datasets: datasetsOut, pinnedViews: pinsOut,
          activeId, colorBy, viewMode, showAxes, camera,
          notes, mutedMap,
          clusterMethod, eps, minSamples, k, breakdownBy, includeExportInfo,
      };
      try {
          const res = await fetch(`http://localhost:8000/api/workspaces/${encodeURIComponent(name)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) { setWorkspaceBusy(""); setUploadStatus(`Save failed: ${data.error ?? res.status}`); return; }
          setWorkspaceBusy("");
          await refreshWorkspaces();
      } catch {
          setWorkspaceBusy("");
          setUploadStatus("Save failed — is the backend running?");
      }
  };

  const loadWorkspace = async (name: string) => {
      setWorkspaceBusy("Loading…");
      try {
          const res = await fetch(`http://localhost:8000/api/workspaces/${encodeURIComponent(name)}`);
          if (!res.ok) { setWorkspaceBusy(""); setUploadStatus(`Load failed: ${res.status}`); return; }
          const ws = await res.json();
          const tables: Record<string, DataTable> = ws.tables ?? {};
          const rehydrate = (ref: any) => (typeof ref === 'string' ? tables[ref] : ref);
          // Restore muted state deliberately — suppress the reset that colorBy/activeId would trigger
          skipMuteReset.current = true;
          setIsRotating(false);
          setDatasets((ws.datasets ?? []).map((d: any) => ({ ...d, table: rehydrate(d.table) })));
          setPinnedViews((ws.pinnedViews ?? []).map((v: any) => ({ ...v, data: rehydrate(v.data) })));
          setActiveId(ws.activeId ?? null);
          setColorBy(ws.colorBy ?? "");
          setViewMode(ws.viewMode ?? "3D");
          setShowAxes(ws.showAxes ?? { "3D": false, "2D": true });
          setCamera(ws.camera ?? { eye: { x: 1.8, y: 1.2, z: 0.5 } });
          setNotes(ws.notes ?? "");
          setMutedMap(ws.mutedMap ?? {});
          setClusterMethod(ws.clusterMethod ?? "NONE");
          setEps(ws.eps ?? 0.5);
          setMinSamples(ws.minSamples ?? 5);
          setK(ws.k ?? 3);
          setBreakdownBy(ws.breakdownBy ?? "");
          setIncludeExportInfo(ws.includeExportInfo ?? true);
          setWorkspaceName(name);
          setUploadStatus(`Loaded workspace "${name}".`);
          setWorkspaceBusy("");
      } catch {
          setWorkspaceBusy("");
          setUploadStatus("Load failed — is the backend running?");
      }
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
  };

  const deleteWorkspace = async (name: string) => {
      try {
          await fetch(`http://localhost:8000/api/workspaces/${encodeURIComponent(name)}`, { method: "DELETE" });
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
          if (next) setColorBy(pickColorBy(next.table.columns, colorBy));
      }
  };

  const handleConvertToParquet = async () => {
      if (!datasetFile) return;
      setIsConverting(true);
      const formData = new FormData();
      formData.append("file", datasetFile);
      try {
          const res = await fetch("http://localhost:8000/api/convert", { method: "POST", body: formData });
          if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              setUploadStatus(`Error: ${data.error ?? "Conversion failed"}`);
              return;
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = datasetFile.name.replace(/\.(csv|xlsx)$/i, '.parquet');
          a.click();
          URL.revokeObjectURL(url);
          setUploadStatus(`Saved ${a.download} — upload it here next time for faster loads.`);
      } catch {
          setUploadStatus("Conversion failed. Ensure backend is running.");
      } finally {
          setIsConverting(false);
      }
  };

  const handleClearData = () => {
      setDatasets([]);
      setActiveId(null);
      setColorBy("");
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

      try {
          const res = await fetch("http://localhost:8000/api/cluster", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                  x: processedData.data[effectiveAxes(activeDataset!, viewMode).x],
                  y: processedData.data[effectiveAxes(activeDataset!, viewMode).y],
                  z: effectiveAxes(activeDataset!, viewMode).z ? processedData.data[effectiveAxes(activeDataset!, viewMode).z!] : undefined,
                  method: clusterMethod, eps, min_samples: minSamples, k
              })
          });
          const data = await res.json();
          if (data.labels) {
              const newTable: DataTable = {
                  columns: processedData.columns.includes("Cluster") ? processedData.columns : [...processedData.columns, "Cluster"],
                  data: { ...processedData.data, Cluster: data.labels },
                  nRows: processedData.nRows
              };
              setDatasets(prev => prev.map(d => d.id === activeId ? { ...d, table: newTable } : d));
              // The pre-cluster coloring is the natural default for composition breakdowns
              if (colorBy !== "Cluster") setBreakdownBy(colorBy);
              setColorBy("Cluster");
          }
      } catch (err) {
          console.error(err);
      } finally {
          setIsClustering(false);
      }
  };

  const getLayout = (title: string, customAxisNames: AxisLabels, mode = viewMode, axesOn = false) => {
      const baseLayout: any = {
          autosize: true,
          margin: { l: mode === "2D" ? 40 : 0, r: 20, b: mode === "2D" ? 40 : 0, t: 40 },
          template: 'plotly_white',
          title: { text: title, font: { color: 'var(--foreground)', family: 'var(--font-sans)' } },
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          showlegend: false,
          legend: { title: { text: colorBy, font: { color: 'var(--foreground)' } }, font: { color: 'var(--foreground)' } }
      };

      if (mode === "3D") {
          const axis3d = (label: string) => ({
              showgrid: axesOn, zeroline: axesOn, showticklabels: axesOn,
              gridcolor: '#bbbbbb', zerolinecolor: '#888888',
              tickfont: { size: 10, color: '#888888' },
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
              gridcolor: '#cccccc', zerolinecolor: '#888888',
              tickfont: { color: '#888888' },
              title: { text: label, font: { color: 'var(--foreground)' } }
          });
          baseLayout.xaxis = axis2d(customAxisNames.x);
          baseLayout.yaxis = axis2d(customAxisNames.y);
      }

      return baseLayout;
  };

  // Target by id — NOT .js-plotly-plot: Plotly.toImage spawns (and can leak) a
  // temporary clone div with that class, and grabbing the purged clone exports
  // empty default axes instead of the real plot
  const getActivePlotDiv = () => document.getElementById('active-plot') as any;

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

  const exportPNG = async () => {
      if (!activeDataset) return;
      const Plotly = (await import('plotly.js-gl3d-dist-min')).default;
      const gd = getActivePlotDiv();
      if (!gd || !gd.data) return;
      try {
          await setExportDressing(Plotly, gd, true);
          await Plotly.downloadImage(gd, {
              format: 'png',
              width: gd.offsetWidth || 900,
              height: gd.offsetHeight || 700,
              scale: 2,
              filename: `${activeDataset.name}_${colorBy}_${viewMode}`,
          });
      } finally {
          await setExportDressing(Plotly, gd, false);
      }
  };

  const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

  const exportGIF = async () => {
      const gd = getActivePlotDiv();
      if (!gd || !activeDataset || viewMode !== "3D" || isExporting) return;
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
          setUploadStatus("GIF export failed — see console.");
      } finally {
          try {
              const Plotly = (await import('plotly.js-gl3d-dist-min')).default;
              const finalGd = getActivePlotDiv();
              if (finalGd && finalGd.data) await setExportDressing(Plotly, finalGd, false);
          } catch { /* a re-render restores the props-driven layout anyway */ }
          setCamera({ eye: prevEye });
          setIsExporting("");
      }
  };

  const exportHTML = async () => {
      if (!activeDataset || !processedData) return;
      setIsExporting("Building HTML…");
      try {
          const labels = effectiveLabels(activeDataset, viewMode);
          const axes = effectiveAxes(activeDataset, viewMode);
          const axesStr = viewMode === "3D" ? `${labels.x} × ${labels.y} × ${labels.z}` : `${labels.x} × ${labels.y}`;
          const kind = getColorFieldKind(processedData.data[colorBy] ?? []);
          const title = includeExportInfo ? `${axesStr} · colored by ${colorBy}` : `${activeDataset.name}`;

          const data = buildTraces(processedData, colorBy, viewMode, axes, labels, mutedMap);
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
          setUploadStatus("HTML export failed — see console.");
      } finally {
          setIsExporting("");
      }
  };

  const pinCurrentView = () => {
      if (pinnedViews.length >= 3) {
          setUploadStatus("Pin limit reached — the grid holds the live view plus 3 pins. Remove one to pin another.");
          return;
      }
      setPinnedViews([
          ...pinnedViews,
          // Tables are replaced wholesale on change, so sharing the reference is a safe snapshot
          { id: Date.now(), data: processedData, colorBy,
            axes: effectiveAxes(activeDataset!, viewMode), labels: effectiveLabels(activeDataset!, viewMode), viewMode,
            showAxes: showAxes[viewMode],
            muted: { ...mutedMap },
            label: `${activeDataset?.name ?? 'Pinned'} · ${colorBy}` }
      ]);
  };

  const removePin = (id: number) => {
      setPinnedViews(pinnedViews.filter(v => v.id !== id));
  };

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
                  layout={getLayout(view.label ?? (isPinned ? "Pinned View" : "Active View"), view.labels, view.viewMode, view.showAxes ?? false)}
                  onRelayout={(e: any) => {
                      if (view.id === 'active' && view.viewMode === "3D" && e['scene.camera'] && isRotating) {
                          setIsRotating(false);
                          setCamera(e['scene.camera']);
                      }
                  }}
              />
          </div>
      );
  };

  if (!mounted) return null;

  // We construct the views array for TmuxGrid: active view is always first, then pinned views
  const allViews = processedData
      ? [{ id: 'active', data: processedData, colorBy, axes: effectiveAxes(activeDataset!, viewMode), labels: effectiveLabels(activeDataset!, viewMode), viewMode, showAxes: showAxes[viewMode], muted: mutedMap, label: `${activeDataset?.name} · live` }, ...pinnedViews]
      : [];

  return (
    <div className={`flex w-full h-screen bg-[var(--background)] text-[var(--foreground)] ${theme === 'terminal' ? 'moving-scanlines' : ''}`}>
      
      {/* Sidebar Controls */}
      <aside className="w-[320px] h-full bg-[var(--card)] border-r border-[var(--border)] flex flex-col p-6 overflow-y-auto relative z-10 flex-shrink-0">
        <div className="flex justify-between items-center mb-2">
            <h1 className={`flex items-center gap-2 text-xl font-bold tracking-tight ${theme === 'terminal' ? 'text-[var(--mauk)] mauk-glow' : ''}`}>
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

        <div className="flex items-center gap-1.5 mb-6 text-[10px] uppercase tracking-wider opacity-70">
          <span className={`inline-block w-2 h-2 rounded-full ${healthStatus === "Backend Connected" ? 'bg-green-500' : 'bg-red-500'}`} />
          {healthStatus === "Backend Connected" ? "Engine ready" : healthStatus}
        </div>

        <SidebarGroup theme={theme}>

          {/* Workspace persistence */}
          <SidebarSection title="Workspace" theme={theme}>
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
                className={`px-3 text-xs font-bold disabled:opacity-40 ${theme === 'primary' ? 'bauhaus-btn bg-[var(--p-blue)] text-white' : 'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)] text-[var(--primary)]'}`}
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
            {workspaceBusy && <p className="text-[11px] opacity-70">{workspaceBusy}</p>}
          </SidebarSection>

          {/* Section 1: Ingestion */}
          <SidebarSection title="Data" step={1} theme={theme}>
            {!processedData && (
              <div className="flex justify-center opacity-40 mb-2">
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
                onClick={() => zone.ref.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(zone.key); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => {
                  e.preventDefault();
                  setDragOver(null);
                  const f = e.dataTransfer.files?.[0];
                  if (f) zone.set(f);
                }}
                className={`border-2 border-dashed p-3 flex flex-col items-center cursor-pointer transition-colors ${theme === 'primary' ? 'border-[3px] bg-white' : ''} ${dragOver === zone.key
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
              onClick={() => { if (showComponents) setComponentsFile(null); setShowComponents(!showComponents); }}
              className="text-[11px] underline-offset-2 hover:underline opacity-60 hover:opacity-100 text-left cursor-pointer"
            >
              {showComponents || componentsFile ? '− Remove components file' : '+ Project through a PCA components file'}
            </button>
            <button onClick={handleUpload} disabled={!datasetFile || isUploading} className={`w-full text-sm font-bold py-2 disabled:opacity-50 ${theme === 'primary' ? 'bauhaus-btn bg-[var(--p-blue)] text-white' : 'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)] text-[var(--primary)]'}`}>
              {isUploading ? "Processing..." : "Add Dataset"}
            </button>
            {datasetFile && !datasetFile.name.endsWith('.parquet') && (
              <button onClick={handleConvertToParquet} disabled={isConverting} className={`w-full flex items-center justify-center gap-2 text-sm font-bold py-2 disabled:opacity-50 ${theme === 'primary' ? 'bauhaus-btn bg-[var(--p-yellow)] text-[#111111]' : 'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)] text-[var(--primary)]'}`}>
                <Download className="w-4 h-4" /> {isConverting ? "Converting..." : "Save as Parquet"}
              </button>
            )}
            {(datasetFile || componentsFile || processedData) && (
              <button onClick={handleClearData} className={`w-full flex items-center justify-center gap-2 text-sm font-bold py-2 ${theme === 'primary' ? 'bauhaus-btn bg-white text-[var(--p-red)]' : 'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)] text-red-400'}`}>
                <Trash2 className="w-4 h-4" /> Clear All Data
              </button>
            )}
            {uploadStatus && (
              <p className="text-[11px] leading-snug opacity-70 break-words">{uploadStatus}</p>
            )}
            {datasets.length > 0 && (
              <div className="space-y-1.5 pt-1">
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
              <SidebarSection title="Variables" step={2} hasBorder theme={theme}>
                <div className="text-[11px] opacity-60 -mt-1">
                  {processedData.nRows} rows × {processedData.columns.length} columns — click X · Y · Z to plot, C to color
                </div>
                {activeDataset?.summary?.top_contributors && (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-bold uppercase tracking-wider opacity-60 text-[10px]">Top PC contributors</summary>
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
                    theme={theme}
                    onAxis={(axis, col) => updateAxis(axis, col)}
                    onColor={setColorBy}
                  />
                )}
              </SidebarSection>

              <SidebarSection title="View" step={3} hasBorder theme={theme}>
                <div className="flex gap-2 mb-2">
                    <button onClick={() => setViewMode("2D")} className={`flex-1 py-1 text-xs font-bold border ${viewMode === "2D" ? (theme==='primary'?'bg-[var(--p-yellow)] border-[var(--p-black)] border-[3px]':'bg-[var(--border)] border-[var(--primary)] text-[var(--primary)]') : 'border-[var(--border)] bg-[var(--input)] opacity-60'}`}>2D</button>
                    <button onClick={() => setViewMode("3D")} className={`flex-1 py-1 text-xs font-bold border ${viewMode === "3D" ? (theme==='primary'?'bg-[var(--p-yellow)] border-[var(--p-black)] border-[3px]':'bg-[var(--border)] border-[var(--primary)] text-[var(--primary)]') : 'border-[var(--border)] bg-[var(--input)] opacity-60'}`}>3D</button>
                </div>

                <button
                    onClick={() => setShowAxes({ ...showAxes, [viewMode]: !showAxes[viewMode] })}
                    className={`w-full py-1 mb-2 text-xs font-bold border ${showAxes[viewMode] ? (theme==='primary'?'bg-[var(--p-yellow)] border-[var(--p-black)] border-[3px]':'bg-[var(--border)] border-[var(--primary)] text-[var(--primary)]') : 'border-[var(--border)] bg-[var(--input)] opacity-60'}`}
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

                <button onClick={() => setIsRotating(!isRotating)} disabled={viewMode === '2D'} className={`w-full flex items-center justify-center gap-2 py-2 text-sm font-bold transition-colors disabled:opacity-30 ${isRotating ? (theme==='primary'?'bauhaus-btn bg-[var(--p-red)] text-white':'bg-[var(--border)] text-[var(--primary)] border border-[var(--primary)]') : (theme==='primary'?'bauhaus-btn bg-[var(--p-black)] text-white':'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)]')}`}>
                    {isRotating ? <><Square className="w-4 h-4" /> Stop Rotation</> : <><Play className="w-4 h-4" /> Start Rotation</>}
                </button>
              </SidebarSection>

              <SidebarSection title="Cluster" step={4} hasBorder theme={theme}>
                <select className="w-full bg-[var(--input)] border border-[var(--border)] p-2 text-sm outline-none" value={clusterMethod} onChange={(e) => setClusterMethod(e.target.value)}>
                    <option value="NONE">None</option>
                    <option value="DBSCAN">DBSCAN</option>
                    <option value="KMEANS">K-Means</option>
                </select>
                
                {clusterMethod === "DBSCAN" && (
                    <div className="space-y-2 text-sm">
                        <label className="flex justify-between"><span className="opacity-70">EPS:</span> <span>{eps}</span></label>
                        <input type="range" min="0.1" max="5" step="0.1" value={eps} onChange={e => setEps(parseFloat(e.target.value))} className="w-full" />
                        <label className="flex justify-between"><span className="opacity-70">Min Samples:</span> <span>{minSamples}</span></label>
                        <input type="range" min="1" max="50" step="1" value={minSamples} onChange={e => setMinSamples(parseInt(e.target.value))} className="w-full" />
                    </div>
                )}
                {clusterMethod === "KMEANS" && (
                    <div className="space-y-2 text-sm">
                        <label className="flex justify-between"><span className="opacity-70">K (Clusters):</span> <span>{k}</span></label>
                        <input type="range" min="2" max="20" step="1" value={k} onChange={e => setK(parseInt(e.target.value))} className="w-full" />
                    </div>
                )}
                {clusterMethod !== "NONE" && (
                    <button onClick={handleCluster} disabled={isClustering} className={`w-full text-sm font-bold py-2 disabled:opacity-50 ${theme === 'primary' ? 'bauhaus-btn bg-[var(--p-red)] text-white' : 'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)] text-[var(--abaci)]'}`}>
                        {isClustering ? "Clustering..." : "Run Clustering"}
                    </button>
                )}
                {processedData.columns.includes('Cluster') && (
                    <ClusterBreakdown table={processedData} attr={breakdownBy} onAttrChange={setBreakdownBy} />
                )}
                  </SidebarSection>

              <SidebarSection title="Export & Pin" step={5} hasBorder theme={theme}>
                  <button onClick={pinCurrentView} className={`w-full flex items-center justify-center gap-2 py-2 text-sm font-bold ${theme==='primary'?'bauhaus-btn bg-white text-black':'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)] text-[var(--system-green)]'}`}>
                      <Pin className="w-4 h-4" /> Pin View
                  </button>
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                      <input type="checkbox" checked={includeExportInfo} onChange={e => setIncludeExportInfo(e.target.checked)} />
                      <span className="opacity-80">Add title & legend to exports</span>
                  </label>
                  <button onClick={exportPNG} disabled={!!isExporting} className={`w-full flex items-center justify-center gap-2 py-2 text-sm font-bold disabled:opacity-40 ${theme==='primary'?'bauhaus-btn bg-[var(--p-blue)] text-white':'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)] text-[var(--primary)]'}`}>
                      <Download className="w-4 h-4" /> Save PNG (active view)
                  </button>
                  <button onClick={exportHTML} disabled={!!isExporting} className={`w-full flex items-center justify-center gap-2 py-2 text-sm font-bold disabled:opacity-40 ${theme==='primary'?'bauhaus-btn bg-white text-black':'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)] text-[var(--primary)]'}`}>
                      <Download className="w-4 h-4" /> {isExporting === "Building HTML…" ? isExporting : "Save Interactive HTML"}
                  </button>
                  <button ref={gifButtonRef} onClick={exportGIF} disabled={viewMode === "2D" || !!isExporting} className={`w-full flex items-center justify-center gap-2 py-2 text-sm font-bold disabled:opacity-40 ${theme==='primary'?'bauhaus-btn bg-[var(--p-yellow)] text-[#111111]':'bg-[var(--input)] border border-[var(--border)] hover:bg-[var(--border)] text-[var(--primary)]'}`}>
                      <Layers className="w-4 h-4" /> {(isExporting && isExporting.startsWith("Rendering")) ? isExporting : "Save Rotating GIF (3D)"}
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
      <main className="flex-1 relative bg-[var(--background)] z-10 flex overflow-hidden">
        {allViews.length > 0 ? (
            <>
                <TmuxGrid views={allViews} renderView={renderView} />
                <ThemedNotes notes={notes} setNotes={setNotes} theme={theme} />
                <ThemedLegend view={allViews[0]} theme={theme} muted={mutedMap} onToggle={toggleMuted} />
            </>
        ) : (
            <EmptyState theme={theme} onLoadDemo={loadDemo} busy={isUploading} />
        )}
      </main>
    </div>
  );
}
