# Screenshots

Real captures from a real vault, used by both READMEs. Not renders: the preview
harness in `scripts/preview-visual.mjs` produces measurement pages (three panel
widths side by side, no Obsidian chrome), which is the right tool for checking
layout and the wrong one for showing someone what the plugin is.

All four are from one session: a clipped article open, and one errand — *"based
on this note, recommend a beginner's hardware list with buying advice"* — carried
out on desktop and again on a phone. That continuity is the point of the mobile
pair: same errand, nothing missing.

| File | Shows | Captured at |
| --- | --- | --- |
| `errand-desktop.webp` | Full window: the note on the left, Piem answering on the right, with suggested follow-ups | 1400px wide, light theme |
| `errand-trace.webp` | The transcript alone: two tool calls, the byte count, the `+4 −0` diff, and the summary of what it did | 754px wide, light theme |
| `mobile-empty.webp` | Phone, empty panel: quick actions shaped by the open note | 640px wide, light theme |
| `mobile-done.webp` | Phone, same errand finished: the checklist and reply actions | 640px wide, light theme |

The UI is in Simplified Chinese, which the English README notes in a caption —
it follows Obsidian's own language, so a Chinese capture is evidence the
bilingual UI is real rather than a claim in a feature table.

## Retaking one

A UI change that makes one of these a lie is not finished until the capture is
retaken. Shoot at the same widths, same theme, from a vault with real notes in
it — a screenshot of an empty vault or `Untitled 1.md` undoes the whole reason
these are here.

Then convert. PNG from a screenshot tool is several times the size of WebP at
the same visual quality, and these ship in a git repository forever:

```bash
ffmpeg -i shot.png -vf scale=1400:-1:flags=lanczos -c:v libwebp -quality 88 \
  -compression_level 6 assets/screenshots/errand-desktop.webp
```

Keep the whole folder well under a megabyte. Check the small Chinese glyphs in
the result before committing — they are the first thing to smear if the quality
setting is too low.
