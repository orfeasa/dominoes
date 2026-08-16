# Pip Count

Pip Count is a single-purpose mobile web app: point the rear camera at face-up dominoes and it totals every visible pip. Image processing happens entirely in the browser; no frames are uploaded.

## What it does

- Counts individual visible pips instead of identifying or pairing dominoes.
- Supports dominoes up to Double-12 (24 pips on one tile).
- Smooths several live readings before declaring the score ready.
- Lets the user freeze and correct the result by one pip at a time.
- Accepts a still photo when live camera access is unavailable.
- Installs as a PWA and caches the detector for offline reuse.

## Run locally

The camera API requires HTTPS or localhost. From this directory:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/`.

## Detection approach

Each frame is resized, converted to greyscale, locally thresholded, and cleaned with small morphological operations. Contours are filtered by radius, aspect ratio, circularity, fill, and the contrast between the candidate pip and its surrounding domino face. Nearby nested candidates are de-duplicated. The live UI uses the modal count across recent frames to suppress flicker.

This contour-and-radius approach was informed by [ZaneDaPayne/Domino_App_Project](https://github.com/ZaneDaPayne/Domino_App_Project), an Unlicense/public-domain project specifically intended to tabulate domino scores. The implementation here is browser-native and independently structured for live video and coloured pips.

OpenCV.js is vendored from the official OpenCV 4.x documentation build. Its licence is included at `vendor/LICENSE-opencv.txt`.

## Regression fixtures

`tests/detector-test.html` checks the detector against:

- A synthetic Double-12 tile with an expected total of 24 pips.
- A complete double-six set with an expected total of 168 pips, sourced from the public-domain project above.
- An unobscured real tabletop arrangement with an expected total of 100 pips, sourced from the same project.
- The reference App Store camera example as an observational case only, because its rendered labels cover some of the original pips.

## Deployment

The repository is static and includes `CNAME` for `dominoes.orfeasa.com`. Configure that name as the GitHub Pages custom domain before adding its DNS CNAME, then enforce HTTPS so mobile camera access works.
