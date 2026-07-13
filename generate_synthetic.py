import pandas as pd
import numpy as np
from sklearn.decomposition import PCA
import os

def generate_data():
    np.random.seed(42)
    n_samples = 300

    # Generate 5 "needs" questions (some correlated to form natural clusters)
    # Group A
    q1 = np.random.normal(5, 1.5, n_samples)
    q2 = q1 + np.random.normal(0, 1, n_samples)
    
    # Group B
    q3 = np.random.normal(3, 2, n_samples)
    q4 = q3 + np.random.normal(0, 1, n_samples)
    
    # Independent
    q5 = np.random.normal(7, 1, n_samples)

    # Add demographics for the "Color By" feature
    orientations = np.random.choice(
        ['Heterosexual', 'Homosexual', 'Bisexual', 'Asexual', 'Pansexual'], 
        n_samples, 
        p=[0.5, 0.15, 0.2, 0.05, 0.1]
    )
    ages = np.random.randint(18, 65, n_samples)

    dataset = pd.DataFrame({
        'Q1_Need': q1,
        'Q2_Need': q2,
        'Q3_Need': q3,
        'Q4_Need': q4,
        'Q5_Need': q5,
        'Orientation': orientations,
        'Age': ages
    })

    # Save dataset
    os.makedirs('synthetic_data', exist_ok=True)
    dataset.to_csv('synthetic_data/synthetic_dataset.csv', index=False)

    # Run PCA to get the components matrix (loadings)
    pca = PCA(n_components=3)
    features = dataset[['Q1_Need', 'Q2_Need', 'Q3_Need', 'Q4_Need', 'Q5_Need']]
    pca.fit(features)

    # Our backend expects variables as rows and PCs as columns
    components_df = pd.DataFrame(
        pca.components_.T, 
        columns=['PC1', 'PC2', 'PC3'],
        index=['Q1_Need', 'Q2_Need', 'Q3_Need', 'Q4_Need', 'Q5_Need']
    )
    
    # Name the index so the parser knows it contains variable names
    components_df.index.name = 'Variable'
    components_df.to_csv('synthetic_data/synthetic_components.csv')

    print("Successfully generated synthetic data in 'synthetic_data' directory!")

if __name__ == "__main__":
    generate_data()
