# Baseline evidence for clipping and VFX failures

Project copy: j977j981typ49yw2p8m9p88fgn8henfn. Original project was left unchanged.
Timeline main. Images came directly from revline-local getFrames at timeline 15.5 and 15.6 seconds.
occlusion-1.jpg shows LOCKED covering the enemy's head.

Source readFrames: asset j57a3vdcepcz19gkdbxaqt2qyn8heyzk, SOURCE 19.25 to 19.65 seconds, 1920x1080 at 60 fps.

Point tracking baseline: Feature verification tab 67795be7-e12e-4bed-a23a-576fa2368664.
Source clip a41dffe1-bac8-43dc-ab7b-42c8d490b850, SOURCE 19.2 to 21.2 seconds, point seed at timeline 0.2666666667, x .386, y .32.
getTrack q97fzqy0r76bd56vx961xbya398hf9rz returned:
Pixel tracking failed. spawn /Users/zuramakaradze/Developer/revline-captions/.data/scene-detection/bin/python ENOENT

Short baseline checkPacing: timeline 15.2 to 15.633 seconds, 10 fps, 5 samples, no flags.
Short baseline checkSound: timeline 2.433333333333333 to 3.433333333333333 seconds, 10 fps, -15.1 LUFS integrated, peak -7 dBFS, no flags.
These are baseline results from the shared DEV services, not validation of this branch.

After-fix captures are pending authorization to sync the changed Convex schema/functions to DEV.
The user's instruction says not to deploy. No DEV or production sync was performed.
Browser control was unavailable, so desktop and phone editor screenshots have not been captured.

