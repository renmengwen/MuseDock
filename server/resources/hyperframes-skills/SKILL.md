# HyperFrames

Use this skill to create short vertical video projects that can be linted, validated, inspected, rendered, and iterated inside the local MediaCrawler GUI workflow.

## Workflow

1. Create a concise director brief before generating code.
2. Generate a complete `index.html` that can run without external network assets.
3. Keep text readable on 1080x1920 and 720x1280 canvases.
4. Use deterministic animation timing and avoid layout shifts.
5. Validate the project, render a video, inspect frames, then revise visible defects.

## Project Contract

Generated projects should include:

- `index.html`: self-contained HTML, CSS, and JavaScript.
- `design.md`: visual direction, motion plan, and quality checklist.
- `hyperframes.json`: render metadata such as duration, fps, width, and height.
- `package.json`: optional local project metadata.

## Visual Direction

Prioritize clear editorial composition over decorative clutter. Use strong hierarchy, readable captions, and purposeful motion. Every scene should communicate one idea and leave enough safe area for subtitles and platform UI.
