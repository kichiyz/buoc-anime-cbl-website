BUOC Anime CBL Website — GitHub Pages Deployment

Files:
- index.html: Japanese/anime-inspired responsive welcome page
- assets/BUOC_CBL_Clean.pdf: the supplied 17-page Constitution & By-Laws PDF
- .nojekyll: tells GitHub Pages to serve the files as-is

Publish using GitHub Pages:
1. Sign in at https://github.com and create a NEW repository named buoc-anime-cbl-website.
2. Set the repository to Public if using GitHub Free. Remember: the published website and PDF will be public on the internet.
3. Upload the CONTENTS of this folder to the repository root. Ensure index.html and .nojekyll are at the top level, and the assets folder contains BUOC_CBL_Clean.pdf.
4. Open repository Settings > Pages.
5. Under Build and deployment, set Source to “Deploy from a branch”. Select branch “main” and folder “/(root)”, then Save.
6. Wait for GitHub Pages to finish publishing (it may take several minutes). In Settings > Pages, use “Visit site”. The URL will usually look like https://YOUR-USERNAME.github.io/buoc-anime-cbl-website/.
7. Test the site and the View Constitution & By-Laws button on a phone and desktop.
8. Use the final public HTTPS URL to generate the QR code. Do not make the final QR until the URL works.

Important:
- Upload the files, not just the ZIP archive.
- Keep the assets folder beside index.html.
- A QR code cannot contain and serve a full website by itself; it points to the public URL.
- The PDF is embedded in the page using the browser's built-in PDF viewer. Inline viewing depends on browser/device support.
- Only publish the CBL PDF if BUOC is authorized to make this version publicly available.

Official GitHub Pages guide: https://docs.github.com/en/pages/quickstart
