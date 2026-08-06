// What the app tells the user about its own methods.
//
// Single source of truth on purpose. These strings are read by the sidebar
// tooltips and by the About page. Writing them in two places is how the
// implementation and `methods.ts` came to disagree about the k-distance
// convention (finding A3) — the same drift would be worse here, because a wrong
// disclosure is more harmful than a missing one.
//
// TWO TIERS, one source. A tooltip should say *what the app did* and stop; the
// reader can bring their own knowledge, ask the assistant, or open the About
// page. So each entry splits:
//
//   text  — shown in the tooltip AND on the About page. What we did.
//   more  — shown ONLY on the About page. Why it matters, and what it costs.
//
// Both are arrays, one string per line, and both surfaces render them as
// separate bullets. The single dense paragraph they replace was the thing that
// made the tooltips overwhelming.
//
// Scope: these describe METHOD, not results. Anything specific to a particular
// run — how many cells were imputed, which columns were clustered, how many
// rows a diagnostic sampled — belongs inline next to that result, where it
// cannot be missed, not behind a tooltip the user has to go looking for.
//
// `methods.ts` remains the long-form, citation-backed reference the assistant
// retrieves from. These are the short, plain-language versions of the specific
// choices this app makes, which is a different job.
//
// No Markdown: these strings are rendered as plain text in both surfaces, so
// asterisks and backticks would show up literally.

export type Disclosure = {
  /** Short label — the tooltip heading and the About page entry title. */
  title: string;
  /**
   * What the app does. Shown in the tooltip AND on the About page, one bullet
   * per string. Keep each line to a sentence or two of plain language.
   */
  text: string[];
  /**
   * Why it matters, what it costs, and the caveats. About page only — this is
   * the material that made tooltips too long to read at a glance.
   */
  more?: string[];
  /** Optional matching topic in methods.ts, for "read more" links. */
  methodsTopic?: string;
};

export const DISCLOSURES = {
  kmeans_deterministic: {
    title: 'K-Means Is Reproducible, Not Optimal',
    text: [
      'This app seeds K-Means with k-means++ from fixed seeds and keeps the lowest-inertia of 10 fixed starts (up to 300 iterations each). It does not search for the global optimum.',
      'The same data and the same k therefore always give byte-identical clusters in this app.',
    ],
    more: [
      'Another tool, or another set of starts, may well land somewhere else.',
      'This tool guarantees reproducibility, not evidence of stable structure. To test whether the clusters are stable, vary k and re-run on subsamples rather than re-running unchanged.',
    ],
    methodsTopic: 'kmeans_interpretation',
  },

  dbscan_parameters: {
    title: 'Eps And Min-Samples',
    text: [
      'A point is a core point when at least "min samples" points lie within distance eps, counting itself. Clusters grow from connected core points; anything left over is labelled Noise.',
      'eps is in the units of the plotted axes — or in standard deviations when Standardize is on.',
    ],
    more: [
      'Too small fragments the data into Noise; too large merges everything into one cluster.',
      'Counting the point itself is the standard convention — both scikit-learn and the original Ester et al. definition do it — but tutorials often describe min samples as neighbours excluding the point, which is a common source of off-by-one disagreement between tools.',
    ],
    methodsTopic: 'dbscan_interpretation',
  },

  median_imputation: {
    title: 'How Missing Values Are Handled',
    text: [
      "Median imputation fills each gap with that variable's median.",
      'Iterative PCA reconstructs each gap from the low-rank structure of the other variables and repeats until the fill settles (the missMDA imputePCA method).',
      'Complete cases drops any row with a missing value.',
      'Clustering always median-imputes.',
    ],
    more: [
      'Median imputation is simple, but it ignores the correlation structure and shrinks variance.',
      "Iterative PCA is better when variables are correlated, but it can be biased when there are many gaps. On this app's own test it recovers punched-out iris values with about half the error of the median, though it is marginally worse on noise (uncorrelated variables).",
      'Complete cases keeps the covariance honest but reduces n and could bias the sample.',
      'All three are single imputation, so none of them carry the uncertainty of the filled values into what follows; with substantial missingness, run more than one and compare.',
      'Every run reports what it filled or dropped, and in which variables.',
    ],
    methodsTopic: 'pca_caveats',
  },

  clusters_plotted_axes: {
    title: 'Clustering Uses The Plotted Axes',
    text: [
      'Clustering runs on the two or three columns currently assigned to X, Y and Z — nothing else.',
    ],
    more: [
      'Choosing the axes is therefore choosing the features. That is a good fit for PC scores, and a weak one for two arbitrary raw columns, where the result describes only those two variables.',
    ],
    // Was pointing at 'standardize_clustering', which is a different subject.
    // This disclosure is about which features the clustering sees, and how much
    // weight to put on the result — which is what cluster_validity covers.
    methodsTopic: 'cluster_validity',
  },

  standardize_pca: {
    title: 'Standardizing Before PCA',
    text: [
      'ON: each variable is z-scored first, making this a correlation-based PCA where every variable carries equal weight.',
      'OFF: covariance-based, where high-variance variables dominate the components.',
    ],
    more: [
      'ON is the right choice when scales differ, which is most questionnaire data.',
      'The two can give very different answers. Report which you used.',
    ],
    methodsTopic: 'standardize_or_not',
  },

  standardize_clustering: {
    title: 'Standardizing Before Clustering',
    text: [
      'Z-scoring gives every variable equal weight in the distance.',
      'Suggested ON for mixed scales, for example age alongside Likert items.',
      'OFF for PC scores — their declining variance is the point of PCA.',
      'OFF by default for items sharing a response scale, where variance differences are themselves signal.',
    ],
    methodsTopic: 'standardize_clustering',
  },

  pca_loadings: {
    title: 'PCA Loadings',
    text: [
      'The numbers shown are unit-norm eigenvector weights (the quantity scikit-learn calls components_).',
    ],
    more: [
      'In psychometrics, "loading" often means the variable-component correlation instead, which is this value scaled by the square root of the eigenvalue; the familiar "above 0.3 to 0.4 is meaningful" rule of thumb refers to that other quantity.',
      'Signs are relative: a component and its mirror image are the same component.',
    ],
    methodsTopic: 'loadings_vs_scores',
  },

  variance_explained: {
    title: 'Variance Explained',
    text: [
      "Each bar in the variance breakdown is that component's share of the total variance across all the variables you selected.",
    ],
    more: [
      'Only the components you chose to keep appear here, so this breakdown cannot be used to pick how many to keep — for that, see the scree chart, which draws the full spectrum.',
    ],
    methodsTopic: 'how_many_components',
  },

  group_stats: {
    title: 'Standard Deviation And Group Statistics',
    text: [
      'Standard deviations here are sample values, dividing by n-1.',
      'Eta-squared is the share of variance accounted for by group membership.',
      'Omega-squared is the same quantity corrected for the upward bias that grows with the number of groups, and is the one to prefer when there are many.',
      'Comparing by a column with one row per group is refused: eta-squared would be exactly 1.000 by construction.',
    ],
    more: [
      'Both are descriptive effect sizes, not significance tests, and a sizable value can be driven by one small extreme group — so always read them alongside the per-group means and ns.',
    ],
    methodsTopic: 'eta_squared',
  },

  missing_value_codes: {
    title: 'Missing Value Codes',
    text: [
      "This app flags values that are shaped like traditional sentinel codes AND sit far outside the rest of their column, but it never removes them: which code means what is your knowledge, not the app's.",
      'Two cases cannot be detected — a code that falls inside the range of real values, and a negative code in a variable that is negative anyway.',
    ],
    more: [
      'SPSS, Qualtrics and most survey platforms write "refused" or "not applicable" as out-of-range numbers — -99, -999, 9999 — and a CSV carries no sign of that alternate meaning. Read as measurements, they land in means, correlations, the PCA and the distances used for clustering.',
      'If a flagged value is a code, replace it with a blank before analysing.',
    ],
    methodsTopic: 'survey_data_notes',
  },

  scree_full_spectrum: {
    title: 'Scree Full Spectrum',
    text: [
      'The scree chart draws every component, with the ones you kept solid and the rest faded.',
    ],
    more: [
      'The two rules the methods reference describes both need the full spectrum: the Cattell elbow is invisible if the chart stops at the elbow, and the Kaiser eigenvalue-above-1 count needs every eigenvalue.',
      'Kaiser is only shown for a standardized run, where each variable contributes exactly 1.',
    ],
    methodsTopic: 'how_many_components',
  },

  diagnostics_sampled: {
    title: 'Diagnostics Are Sampled',
    text: [
      'Silhouette-by-k and the k-distance curve are O(n squared), so on large tables they are computed on a capped sample of rows (1,200 and 2,000 respectively) while the clustering itself runs on everything.',
      'The sample is random but seeded, so repeated runs agree. Random rather than evenly spaced, because a fixed step lands on one stratum of any file ordered by wave, block or condition.',
    ],
    more: [
      'Treat them as a starting point for choosing parameters rather than an exact answer.',
    ],
    methodsTopic: 'silhouette',
  },
} as const satisfies Record<string, Disclosure>;

export type DisclosureKey = keyof typeof DISCLOSURES;

export const disclosure = (key: DisclosureKey): Disclosure => DISCLOSURES[key];

/** Ordered for an information page; grouped by where they apply in the app. */
export const DISCLOSURE_SECTIONS: { heading: string; keys: DisclosureKey[] }[] = [
  { heading: 'Missing Data', keys: ['median_imputation', 'missing_value_codes'] },
  { heading: 'PCA', keys: ['standardize_pca', 'pca_loadings', 'variance_explained', 'scree_full_spectrum'] },
  {
    heading: 'Clustering',
    keys: ['clusters_plotted_axes', 'kmeans_deterministic', 'dbscan_parameters', 'standardize_clustering', 'diagnostics_sampled'],
  },
  { heading: 'Statistics', keys: ['group_stats'] },
];
