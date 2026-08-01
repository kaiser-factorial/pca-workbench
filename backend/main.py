from fastapi import FastAPI, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
import uvicorn
import pandas as pd
import numpy as np
import io
import json
import re
from datetime import datetime
from pathlib import Path
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import DBSCAN, KMeans

app = FastAPI(title="PCA-Viz Workbench API")

# Setup CORS to allow Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

SUPPORTED_EXTENSIONS = ('.csv', '.xlsx', '.parquet')
# Display payload only — converted/master files stay full precision
FLOAT_DECIMALS = 4

# File-based workspace store, one JSON per named workspace — the seam for a
# future real backend is exactly these four endpoints
WORKSPACES_DIR = Path(__file__).resolve().parent.parent / "workspaces"


def safe_workspace_name(name):
    name = (name or "").strip()
    return name if re.fullmatch(r"[\w\- ]{1,60}", name) else None


def read_table(filename, content):
    if filename.endswith('.csv'):
        return pd.read_csv(io.BytesIO(content))
    if filename.endswith('.xlsx'):
        return pd.read_excel(io.BytesIO(content))
    if filename.endswith('.parquet'):
        return pd.read_parquet(io.BytesIO(content))
    return None


def error(msg, status=400):
    return JSONResponse(status_code=status, content={"error": msg})


@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "Backend Connected"}


@app.post("/api/upload")
async def upload_files(dataset: UploadFile = File(...), components: UploadFile = File(None)):
    try:
        comp_name, comp_content = (components.filename, await components.read()) if components else (None, None)
        return process_upload(dataset.filename, await dataset.read(), comp_name, comp_content)
    except Exception as e:
        # Returning (rather than raising) keeps CORS headers on the response —
        # an uncaught 500 reaches the browser headerless and reads as a CORS error
        print(f"Upload processing failed: {e!r}")
        return error(f"Processing failed: {e}", 500)


def top_pc_contributors(sub_comp, n=5):
    # Per PC: variables ranked by |loading|, signed values kept for interpretation
    contributors = {}
    for i, col in enumerate(sub_comp.columns[:3]):
        s = pd.to_numeric(sub_comp[col], errors='coerce').dropna()
        top = s.reindex(s.abs().sort_values(ascending=False).index)[:n]
        contributors[f"PC{i + 1}"] = [{"var": str(v), "loading": round(float(l), 3)} for v, l in top.items()]
    return contributors


def build_summary(df, top_contributors=None):
    columns = []
    for c in df.columns:
        if c in ('PC1', 'PC2', 'PC3'):
            continue
        s = df[c]
        missing = int(s.isna().sum())
        if pd.api.types.is_numeric_dtype(s):
            info = {"name": c, "kind": "numeric", "missing": missing}
            if s.notna().any():
                info.update({
                    "min": round(float(s.min()), 3),
                    "max": round(float(s.max()), 3),
                    "mean": round(float(s.mean()), 3),
                })
            columns.append(info)
        else:
            vc = s.value_counts(dropna=True)
            columns.append({
                "name": c, "kind": "categorical", "missing": missing,
                "n_unique": int(vc.size),
                "values": [{"value": str(k), "count": int(v)} for k, v in vc.head(10).items()],
            })
    return {
        "n_rows": len(df),
        "n_cols": len(columns),
        "columns": columns,
        "top_contributors": top_contributors,
    }


def process_upload(dataset_name, dataset_content, components_name=None, components_content=None):
    print(f"Received dataset: {dataset_name}, components: {components_name}")

    df = read_table(dataset_name, dataset_content)
    if df is None:
        return error(f"Dataset must be one of: {', '.join(SUPPORTED_EXTENSIONS)}")
    df = df.replace([np.inf, -np.inf], np.nan)

    top_contributors = None
    if components_name:
        comp_df = read_table(components_name, components_content)
        if comp_df is None:
            return error(f"Components must be one of: {', '.join(SUPPORTED_EXTENSIONS)}")

        if 'Unnamed: 0' in comp_df.columns:
            comp_df = comp_df.set_index('Unnamed: 0')
        elif not pd.api.types.is_numeric_dtype(comp_df.iloc[:, 0]):
            comp_df = comp_df.set_index(comp_df.columns[0])

        var_names = comp_df.index.tolist()
        intersect_vars = [v for v in var_names if v in df.columns]

        if len(intersect_vars) == 0:
            return error(f"No overlapping variables found between the Components file and Dataset columns. Components vars found: {var_names[:5]}...")

        # Coerce text junk in numeric columns to NaN so the imputer treats them as missing
        sub_df = df[intersect_vars].apply(pd.to_numeric, errors='coerce')
        all_nan = sub_df.columns[sub_df.isna().all()].tolist()
        if all_nan:
            return error(f"These columns contain no usable numeric values: {all_nan}")
        sub_comp = comp_df.loc[intersect_vars]

        imputer = SimpleImputer(strategy='median')
        X_imputed = imputer.fit_transform(sub_df)
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X_imputed)

        coords = X_scaled @ sub_comp.values

        if coords.shape[1] >= 3:
            coords = coords[:, :3]
        elif coords.shape[1] == 2:
            coords = np.hstack([coords, np.zeros((coords.shape[0], 1))])
        else:
            coords = np.hstack([coords, np.zeros((coords.shape[0], 2))])

        df['PC1'] = coords[:, 0]
        df['PC2'] = coords[:, 1]
        df['PC3'] = coords[:, 2]

        top_contributors = top_pc_contributors(sub_comp)
        message = f"Successfully calculated 3D coordinates using {len(intersect_vars)} overlapping variables ({len(df)} rows)."
    else:
        # No components file: any numeric columns can serve as plot axes,
        # chosen on the frontend (defaults to the first numeric columns)
        numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        if len(numeric_cols) < 2:
            return error("Dataset needs at least two numeric columns to plot (or provide a components file).")
        message = f"Loaded {len(df)} rows. No components file — pick plot axes in Visual Settings (defaults: first numeric columns)."

    summary = build_summary(df, top_contributors)

    float_cols = df.select_dtypes(include='float').columns
    df[float_cols] = df[float_cols].round(FLOAT_DECIMALS)
    # astype(object) first: on float columns, where(..., None) silently re-coerces
    # None back to NaN, which the JSON serializer rejects
    df = df.astype(object).where(df.notnull(), None)

    # Columnar payload: no per-row key repetition, and the frontend hands
    # these arrays to Plotly directly without reshaping
    return {
        "columns": df.columns.tolist(),
        "data": {col: df[col].tolist() for col in df.columns},
        "n_rows": len(df),
        "summary": summary,
        "message": message
    }


@app.post("/api/cluster")
async def cluster_data(request: Request):
    try:
        return run_cluster(await request.json())
    except Exception as e:
        print(f"Clustering failed: {e!r}")
        return error(f"Clustering failed: {e}", 500)


def run_cluster(payload):
    x = payload.get("x")
    y = payload.get("y")
    z = payload.get("z")
    method = payload.get("method")
    eps = float(payload.get("eps", 0.5))
    min_samples = int(payload.get("min_samples", 5))
    k = int(payload.get("k", 3))

    if not x or not y:
        return error("No coordinates provided")

    cols = [x, y] + ([z] if z else [])
    X = np.array(cols, dtype=float).T  # None entries become NaN
    # Axis columns may carry missing values — impute so DBSCAN/KMeans don't choke
    X = SimpleImputer(strategy='median').fit_transform(X)

    if method == "DBSCAN":
        model = DBSCAN(eps=eps, min_samples=min_samples)
        labels = model.fit_predict(X)
    elif method == "KMEANS":
        model = KMeans(n_clusters=k, random_state=42)
        labels = model.fit_predict(X)
    else:
        return error("Unknown method")

    return {"labels": [f"Cluster {x}" if x != -1 else "Noise" for x in labels]}


@app.post("/api/convert")
async def convert_to_parquet(file: UploadFile = File(...)):
    try:
        return run_convert(file.filename, await file.read())
    except Exception as e:
        print(f"Conversion failed: {e!r}")
        return error(f"Conversion failed: {e}", 500)


def run_convert(filename, content):
    if filename.endswith('.parquet'):
        return error("File is already Parquet")
    df = read_table(filename, content)
    if df is None:
        return error(f"File must be one of: {', '.join(SUPPORTED_EXTENSIONS)}")

    # Lossless: full precision, snappy compression + automatic dictionary
    # encoding on string columns come from the parquet defaults
    buf = io.BytesIO()
    df.to_parquet(buf, index=False)
    buf.seek(0)
    stem = filename.rsplit('.', 1)[0]
    return StreamingResponse(
        buf,
        media_type="application/vnd.apache.parquet",
        headers={"Content-Disposition": f'attachment; filename="{stem}.parquet"'}
    )


@app.get("/api/workspaces")
def list_workspaces():
    try:
        WORKSPACES_DIR.mkdir(exist_ok=True)
        items = [
            {
                "name": f.stem,
                "saved_at": datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec="seconds"),
                "bytes": f.stat().st_size,
            }
            for f in sorted(WORKSPACES_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        ]
        return {"workspaces": items}
    except Exception as e:
        print(f"Listing workspaces failed: {e!r}")
        return error(f"Listing workspaces failed: {e}", 500)


@app.post("/api/workspaces/{name}")
async def save_workspace(name: str, request: Request):
    try:
        safe = safe_workspace_name(name)
        if not safe:
            return error("Workspace name must be 1-60 characters: letters, numbers, spaces, - or _")
        WORKSPACES_DIR.mkdir(exist_ok=True)
        payload = await request.json()
        with open(WORKSPACES_DIR / f"{safe}.json", "w") as f:
            json.dump(payload, f)
        return {"ok": True, "name": safe}
    except Exception as e:
        print(f"Saving workspace failed: {e!r}")
        return error(f"Saving workspace failed: {e}", 500)


@app.get("/api/workspaces/{name}")
def load_workspace(name: str):
    try:
        safe = safe_workspace_name(name)
        path = WORKSPACES_DIR / f"{safe}.json" if safe else None
        if not path or not path.exists():
            return error("Workspace not found", 404)
        return FileResponse(path, media_type="application/json")
    except Exception as e:
        print(f"Loading workspace failed: {e!r}")
        return error(f"Loading workspace failed: {e}", 500)


@app.delete("/api/workspaces/{name}")
def delete_workspace(name: str):
    try:
        safe = safe_workspace_name(name)
        path = WORKSPACES_DIR / f"{safe}.json" if safe else None
        if not path or not path.exists():
            return error("Workspace not found", 404)
        path.unlink()
        return {"ok": True}
    except Exception as e:
        print(f"Deleting workspace failed: {e!r}")
        return error(f"Deleting workspace failed: {e}", 500)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
