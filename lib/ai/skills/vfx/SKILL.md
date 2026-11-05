---
name: "vfx"
description: "Gameplay montages, Valorant kill edits and intentional VFX: velocity, impact frames, procedural overlays, foreground layering, depth parallax and cuts on measured beats and tracking on moving-camera footage."
---
# VFX for montage edits

Confirm hits with readFrames, then align cuts to measured music accents (montage). Use addImpactFrame with project-frame durations and addOverlay with seeded textures (impact-and-overlays). freezeFrameParallax prepares depth/matte/background layers; inspect start/mid/end for seams (parallax). trackPoints/attachToTrack bind overlays or masks to measured pixels; report gaps (tracking). Keep unrelated timelines intact.