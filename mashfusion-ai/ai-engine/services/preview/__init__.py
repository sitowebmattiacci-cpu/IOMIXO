"""Preview package — cheap teaser clip rendering for the free funnel."""

from .clip_renderer import render_all_clips, render_clip, select_hook_windows
from .snippet_selector import (
    ScoredWindow,
    TimelineFeatures,
    polish_clip,
    score_timeline,
    select_best_window,
    select_diverse_windows,
)

__all__ = [
    "render_all_clips",
    "render_clip",
    "select_hook_windows",
    "ScoredWindow",
    "TimelineFeatures",
    "polish_clip",
    "score_timeline",
    "select_best_window",
    "select_diverse_windows",
]
