// The real app's own entry point (src/main.tsx) imports this — it's
// where every one of Card.css's custom @font-face rules actually lives
// (Card.css only ever *uses* those font-family names; it never declares
// them). This file is rasterize.html's own from-scratch entry point, so
// without importing it here too, none of those @font-face rules are
// registered in this page's document at all — the browser has nothing
// to match "MatrixRegularSmallCaps" (etc.) against, so every card
// silently rendered in a generic fallback font, no error, nothing to
// wait or preload differently for. (This was the actual cause of cards
// rasterizing with the wrong fonts/positioning/stroke — two earlier,
// unsuccessful attempts at fixing this chased font-loading timing and
// embedding instead, which could never have mattered when the fonts
// were never declared in this page in the first place.)
import '../index.css';

// Entry point for rasterize.html — see that file's own comment, and
// scripts/rasterize-cards.js's top comment, for the full pipeline this is
// part of. All the real work happens as a side effect of importing
// RasterizeEntry (it installs window.__rasterizeCard); nothing needs
// rendering into the DOM by React Router or anything else here.
import './RasterizeEntry';
