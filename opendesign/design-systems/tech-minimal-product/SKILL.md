---
name: tech-minimal-product
description: MuseDock product UI system for compact, technology-forward console screens.
---

Use this design system for MuseDock product surfaces: `/creative`, `/creative/:workflowId`, `/editor/:workflowId`, and `/settings`.

## Rules

- Keep the first screen functional. Do not replace the creative homepage with a marketing hero.
- Use the original MuseDock light console shell for navigation and task history.
- Use light panels for forms, long text, settings, and task details.
- Do not rely on red/cyan as the page skeleton. Use neutral gray/white/ink surfaces first; reserve red only for destructive or failure states, and cyan only for tiny focus/status signals.
- Keep common card radii at 4-8px. The homepage prompt composer may keep the original larger rounded input shape.
- Prefer dense but readable grids, sticky sidebars, compact toolbars, and clear loading states.
- Preserve the current homepage and task-detail information architecture unless a workflow requires structural change; prefer color, density, hierarchy, and spacing adjustments over page rewrites.
- Use dialogs for low-frequency, field-heavy configuration details, especially settings provider forms. Keep settings pages scannable with compact summary rows and open details on demand.
- Make the product feel technology-forward: crisp geometry, compact data density, precise controls, subtle grid/terminal cues, and confident dark editor chrome are welcome.
- Avoid generic AI-product styling: no glowing orbs, magic-gradient hero sections, excessive sparkle effects, chatbot mascots, or vague "AI brain" visuals.
- Keep all visible user copy in Chinese unless it is a product name, API field, file name, or environment variable.
- Do not use bluish-purple gradients, decorative orbs, emoji icons, or nested cards.

## Tokens

Import `tokens/colors_and_type.css` before writing mockups or implementation styles.

## Page Patterns

- Homepage: light task sidebar + centered prompt composer, with minimal surrounding status.
- Task detail: status header + step timeline + progress panel + preview/recovery panel.
- Secondary editor: dark editor chrome + large 16:9 canvas + inspector side panel + horizontal frame strip.
- Settings: command sidebar + overview metrics + grouped parameter panels.
