// What the app tells the user about its own methods.
//
// Single source of truth on purpose. These strings are read by the sidebar
// tooltips, and are intended to back an information page and the assistant's
// system prompt too. Writing them in three places is how the implementation and
// `methods.ts` came to disagree about the k-distance convention (finding A3) —
// the same drift would be worse here, because a wrong disclosure is more
// harmful than a missing one.
//
// Scope: these describe METHOD, not results. Anything specific to a particular
// run — how many cells were imputed, which columns were clustered, how many
// rows a diagnostic sampled — belongs inline next to that result, where it
// cannot be missed, not behind a tooltip the user has to go looking for.
//
// `methods.ts` remains the long-form, citation-backed reference the assistant
// retrieves from. These are the short, plain-language versions of the specific
// choices this app makes, which is a different job.

export type Disclosure = {
  /** Short label for an info page's table of contents. */
  title: string;
  /** One or two sentences, plain language, no citations. Shown in tooltips. */
  text: string;
  /** Optional matching topic in methods.ts, for "read more" links. */
  methodsTopic?: string;
};

export const DISCLOSURES = {
  kmeans_deterministic: {
    title: 'K-Means is deterministic here',
    text:
      'This app seeds K-Means with k-means++ from fixed seeds and keeps the best of 10 initialisations (up to 300 iterations), so the same data and the same k always give byte-identical clusters. That is reproducibility, not evidence of stable structure — to test whether the clusters are real, vary k and re-run on subsamples rather than re-running unchanged.',
    methodsTopic: 'kmeans_interpretation',
  },

  dbscan_parameters: {
    title: 'What eps and min samples do',
    text:
      'A point is a core point when at least "min samples" points lie within distance eps, counting itself. Clusters grow from connected core points; anything left over is labelled Noise. eps is in the units of the plotted axes — or in standard deviations when Standardize is on. Too small fragments the data into Noise; too large merges everything into one cluster.',
    methodsTopic: 'dbscan_interpretation',
  },

  median_imputation: {
    title: 'Missing values are median-imputed',
    text:
      'Before PCA and clustering, any missing value is replaced with its column median — the row is used rather than dropped. This shrinks variance and attenuates correlations in proportion to how much was imputed, so with substantial missingness check the result against complete cases. Column-by-column missing counts are in the Variables panel.',
    methodsTopic: 'pca_caveats',
  },

  clusters_plotted_axes: {
    title: 'Clustering uses the plotted axes',
    text:
      'Clustering runs on the two or three columns currently assigned to X, Y and Z — nothing else. Choosing the axes is therefore choosing the features. That is a good fit for PC scores, and a weak one for two arbitrary raw columns, where the result describes only those two variables.',
    methodsTopic: 'standardize_clustering',
  },

  standardize_pca: {
    title: 'Standardizing before PCA',
    text:
      'On: each variable is z-scored first, making this a correlation-based PCA where every variable carries equal weight — the right choice when scales differ, which is most questionnaire data. Off: covariance-based, where high-variance variables dominate the components. The two can give very different answers; report which you used.',
    methodsTopic: 'standardize_or_not',
  },

  standardize_clustering: {
    title: 'Standardizing before clustering',
    text:
      'Z-scoring gives every variable equal weight in the distance. Suggested on for mixed scales (age alongside 1–7 items), off for PC scores — their declining variance is the point of PCA — and off by default for items sharing a response scale, where variance differences are themselves signal. A judgement call, not a rule.',
    methodsTopic: 'standardize_clustering',
  },

  pca_loadings: {
    title: 'What the loadings are',
    text:
      'The numbers shown are unit-norm eigenvector weights — the same quantity scikit-learn calls components_. Note that in psychometrics "loading" often means the variable-component correlation instead, which is this value scaled by the square root of the eigenvalue; the familiar "above 0.3–0.4 is meaningful" rule of thumb refers to that other quantity. Signs are relative: a component and its mirror image are the same component.',
    methodsTopic: 'loadings_vs_scores',
  },

  variance_explained: {
    title: 'Variance explained',
    text:
      'Each bar is that component\'s share of the total variance across all the variables you selected. Only the components you chose to keep are shown, so this chart cannot be used to pick how many to keep — for that you want the full spectrum.',
    methodsTopic: 'how_many_components',
  },

  group_stats: {
    title: 'How group statistics are computed',
    text:
      'Standard deviations are population values, dividing by n rather than n-1. Eta-squared is the share of variance accounted for by group membership: a descriptive effect size, not a significance test, and upwardly biased with small groups. Always read it alongside the per-group means and ns.',
    methodsTopic: 'eta_squared',
  },

  diagnostics_sampled: {
    title: 'Diagnostics run on a sample',
    text:
      'Silhouette-by-k and the k-distance curve are O(n squared), so on large tables they are computed on a capped sample of rows (1,200 and 2,000 respectively) while the clustering itself runs on everything. Treat them as a starting point for choosing parameters rather than an exact answer.',
    methodsTopic: 'silhouette',
  },
} as const satisfies Record<string, Disclosure>;

export type DisclosureKey = keyof typeof DISCLOSURES;

export const disclosure = (key: DisclosureKey): Disclosure => DISCLOSURES[key];

/** Ordered for an information page; grouped by where they apply in the app. */
export const DISCLOSURE_SECTIONS: { heading: string; keys: DisclosureKey[] }[] = [
  { heading: 'Missing data', keys: ['median_imputation'] },
  { heading: 'PCA', keys: ['standardize_pca', 'pca_loadings', 'variance_explained'] },
  {
    heading: 'Clustering',
    keys: ['clusters_plotted_axes', 'kmeans_deterministic', 'dbscan_parameters', 'standardize_clustering', 'diagnostics_sampled'],
  },
  { heading: 'Statistics', keys: ['group_stats'] },
];
