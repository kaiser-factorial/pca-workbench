# Iris demo data

The classic Iris dataset: 150 observations, four numeric flower measurements, a three-class `Species` label.

Use `Species` for categorical colour encoding; it is also suitable for a marker-shape demonstration. Do not use `Id` as an analysis feature.

## Source

Downloaded 2026-08-05 from the UCI Machine Learning Repository's Iris dataset, file **`bezdekIris.data`**:

<https://archive.ics.uci.edu/ml/machine-learning-databases/iris/bezdekIris.data>

- SHA-256 of the upstream `bezdekIris.data`: `0fed2a99db77ec533a62dc66894d3ec6df3b58b6a8f3cf4a6b47e4086b7f97dc`
- SHA-256 of `iris.csv` as shipped: `aebd964609a8dadd05b0bc146f034767475b1e038022408fc671b0ea2a5105d0`

**Cite as:** Fisher, R. A. (1936). *Iris* [Dataset]. UCI Machine Learning Repository. <https://doi.org/10.24432/C56C76>

Original publications: Fisher, R. A. (1936). "The use of multiple measurements in taxonomic problems." *Annals of Eugenics*, 7(2), 179–188. Measurements collected by Anderson, E. (1935).

### Transformation applied

The four measurements and the species labels are **verbatim** from `bezdekIris.data`. Two presentational changes were made so the file reads as a CSV in the app:

1. A header row was added: `Id,SepalLengthCm,SepalWidthCm,PetalLengthCm,PetalWidthCm,Species`
2. An `Id` column was added, numbering rows 1–150 in upstream file order.

Both match the schema of the Kaggle mirror this demo previously used, so nothing downstream changed. To reproduce:

```sh
curl -sL https://archive.ics.uci.edu/ml/machine-learning-databases/iris/bezdekIris.data \
  | awk -F, 'NF>=5 {printf "%d,%s,%s,%s,%s,%s\n", ++i, $1,$2,$3,$4,$5}' \
  | sed '1i Id,SepalLengthCm,SepalWidthCm,PetalLengthCm,PetalWidthCm,Species'
```

## Why `bezdekIris.data` and not `iris.data`

UCI ships two copies of this dataset, and they are not the same. `iris.data` — which the Kaggle `uciml/iris` mirror reproduces, and which this demo used until 2026-08-05 — contains two transcription errors relative to Fisher's paper. UCI's `iris.names` documents them:

> This data differs from the data presented in Fishers article (identified by Steve Chadwick, spchadwick@espeedaz.net)
> The 35th sample should be: 4.9,3.1,1.5,0.2,"Iris-setosa" where the error is in the fourth feature.
> The 38th sample: 4.9,3.6,1.4,0.1,"Iris-setosa" where the errors are in the second and third features.

`bezdekIris.data` carries the corrected values. Verified: the two files differ at exactly rows 35 and 38 and nowhere else, and `bezdekIris.data` agrees measurement-for-measurement with scikit-learn's `load_iris` (corrected in 0.23) and with `seaborn-data/iris.csv` — three independent Fisher-correct sources, all 600 values identical.

This matters because it is the difference between the app looking correct and looking broken. With the errata in place, a correlation PCA of these four columns reports 72.77% variance on PC1 where R, scikit-learn and every textbook say 72.96% — close enough to read as a bug in Scatter Lab's eigensolver rather than a difference in the data.

## Verification

`src/lib/__tests__/demoData.test.ts` pins this file against published statistics for R's `iris`, which matches Fisher. All agree to six decimal places:

| Quantity | Value |
|---|---|
| Column means | 5.843333, 3.057333, 3.758000, 1.199333 |
| Column sd (n − 1) | 0.828066, 0.435866, 1.765298, 0.762238 |
| `prcomp(scale.=TRUE)` sdev | 1.708361, 0.956049, 0.383089, 0.143926 |
| Variance explained (correlation) | 72.9624%, 22.8508%, 3.6689%, 0.5179% |
| Variance explained (covariance) | 92.4619%, 5.3066%, 1.7103%, 0.5212% |

The test also asserts the two corrected rows directly, so re-downloading from `iris.data` instead of `bezdekIris.data` fails the suite rather than silently regressing the demo.
