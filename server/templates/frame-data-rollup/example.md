# Example — frame-data-rollup

A native Remotion data frame: five weekday bars grow from zero while their
figures roll up to the real values, finishing together.

## Inputs

```json
{
  "data": {
    "title": "This week on GitHub",
    "items": [
      { "label": "Mon", "value": 1200 },
      { "label": "Tue", "value": 2400 },
      { "label": "Wed", "value": 1800 },
      { "label": "Thu", "value": 4200 },
      { "label": "Fri", "value": 3600 }
    ]
  }
}
```

## Variant — units + custom palette

```json
{
  "data": {
    "title": "Stars by month",
    "unit": "K",
    "items": [
      { "label": "Mar", "value": 12 },
      { "label": "Apr", "value": 28 },
      { "label": "May", "value": 47 }
    ]
  },
  "accent": "#34D399",
  "background": "#0B1120"
}
```

## How it renders

- `engine: remotion`, `mode: native`, composition id `DataRollup`.
- The data above arrives as Remotion `inputProps`; the component animates it with
  `spring()` (bar height) + `interpolate()` (rolling number).
- Bars cascade in with a per-bar stagger; each number and its bar settle together.
- This is the enhancement a user opts a single data frame into — neighbor frames
  in the same video stay hyperframes HTML, and ffmpeg concatenates them into one MP4.
