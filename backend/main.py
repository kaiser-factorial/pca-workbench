from fastapi import FastAPI, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import pandas as pd
import numpy as np
import io
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

@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "Backend Connected"}

@app.post("/api/upload")
async def upload_files(dataset: UploadFile = File(...), components: UploadFile = File(...)):
    print(f"Received dataset: {dataset.filename}, components: {components.filename}")
    
    ds_content = await dataset.read()
    if dataset.filename.endswith('.csv'):
        df = pd.read_csv(io.BytesIO(ds_content))
    elif dataset.filename.endswith('.xlsx'):
        df = pd.read_excel(io.BytesIO(ds_content))
    else:
        return {"error": "Dataset must be CSV or XLSX"}
    
    comp_content = await components.read()
    if components.filename.endswith('.csv'):
        comp_df = pd.read_csv(io.BytesIO(comp_content))
    elif components.filename.endswith('.xlsx'):
        comp_df = pd.read_excel(io.BytesIO(comp_content))
    else:
        return {"error": "Components must be CSV or XLSX"}

    if 'Unnamed: 0' in comp_df.columns:
        comp_df = comp_df.set_index('Unnamed: 0')
    elif not pd.api.types.is_numeric_dtype(comp_df.iloc[:, 0]):
        comp_df = comp_df.set_index(comp_df.columns[0])
    
    var_names = comp_df.index.tolist()
    intersect_vars = [v for v in var_names if v in df.columns]
    
    if len(intersect_vars) == 0:
        return {"error": f"No overlapping variables found between the Components file and Dataset columns. Components vars found: {var_names[:5]}..."}

    sub_df = df[intersect_vars]
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

    df = df.where(pd.notnull(df), None)

    return {
        "data": df.to_dict(orient="records"),
        "columns": df.columns.tolist(),
        "message": f"Successfully calculated 3D coordinates using {len(intersect_vars)} overlapping variables."
    }

@app.post("/api/cluster")
async def cluster_data(request: Request):
    payload = await request.json()
    coords = payload.get("coords") # list of [PC1, PC2, PC3]
    method = payload.get("method")
    eps = float(payload.get("eps", 0.5))
    min_samples = int(payload.get("min_samples", 5))
    k = int(payload.get("k", 3))
    
    if not coords:
        return {"error": "No coordinates provided"}
        
    X = np.array(coords)
    
    if method == "DBSCAN":
        model = DBSCAN(eps=eps, min_samples=min_samples)
        labels = model.fit_predict(X)
    elif method == "KMEANS":
        model = KMeans(n_clusters=k, random_state=42)
        labels = model.fit_predict(X)
    else:
        return {"error": "Unknown method"}
        
    return {"labels": [f"Cluster {x}" if x != -1 else "Noise" for x in labels]}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
