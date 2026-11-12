# Third-party components

Original application code is included for local learning and modification. Third-party code and model assets retain their own licenses. License texts shipped with the installed packages are authoritative.

| Component                      | Use                                         | Upstream                                                                                  |
| ------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| React / React DOM              | UI                                          | https://github.com/facebook/react (MIT)                                                   |
| Vite                           | Dev server / production bundler             | https://github.com/vitejs/vite (MIT)                                                      |
| TypeScript                     | Type checking                               | https://github.com/microsoft/TypeScript (Apache-2.0)                                      |
| MediaPipe Tasks Vision 0.10.32 | Pose inference                              | https://github.com/google-ai-edge/mediapipe (Apache-2.0)                                  |
| MediaPipe Pose Landmarker Lite | Pretrained pose model                       | https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker                     |
| Mozilla PDF.js                 | PDF rendering, fonts, CMaps, decoder assets | https://github.com/mozilla/pdf.js (Apache-2.0; see bundled notices for additional assets) |
| Lucide                         | Interface icons                             | https://github.com/lucide-icons/lucide (ISC)                                              |
| esbuild / Vitest / jsdom       | Build and development tests                 | Upstream package licenses                                                                 |

`public/models/provenance.json` records the exact official model source URL and SHA-256 digest. MediaPipe model redistribution and usage remain subject to the upstream model terms. No model ownership is claimed. Build scripts copy available upstream LICENSE / NOTICE files into `licenses/` and include notices in the connector.

Brand names Canva and Google Slides identify integration targets; GestureDeck is not an official product of Canva, Google or Mozilla. The sample PDF, logo and interface illustration were created for this project.
