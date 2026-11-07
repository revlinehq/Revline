"""Genesis compositor (media worker, CPU only, no generative models).

clean-plate: remove masked subjects from static-camera footage by filling each frame's masked pixels with
the temporal median of the same pixels in frames where they are uncovered. Refuses a moving camera and
large areas that are never uncovered. Writes an H.264 MP4 on the source clock.

surface: track a planar surface's four corners (the pixel tracker's KLT settings and cut detection,
fitted to a homography and anchored to the seed frame), then warp an image or video onto it every frame,
optionally carrying the surface's brightness change onto it. Writes a VP9 WebM with alpha on the source clock.

JSON request in argv[1]; NDJSON out: {"type":"progress","value":0..100} ... {"type":"result","report":{...}}.
A refusal prints {"type":"refusal","message":...} and exits 3.
"""
import importlib.util
import json
import math
import os
import shutil
import signal
import subprocess
import sys
import tempfile

import cv2
import numpy as np

signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
cv2.setNumThreads(2)

# The pixel tracker's own internals (trackPoints): KLT parameters and shot-cut detection.
_spec = importlib.util.spec_from_file_location('track_pixels', os.path.join(os.getcwd(), 'scripts', 'track-pixels.py'))
track_pixels = importlib.util.module_from_spec(_spec)
sys.path.insert(0, os.path.join(os.getcwd(), 'scripts'))
_spec.loader.exec_module(track_pixels)
LK, is_cut = track_pixels.LK, track_pixels.is_cut

# v1 limits (documented in the genesis skill's references).
MAX_CAMERA_SHIFT = .004      # of the frame diagonal: ~9 px at 1080p
MAX_HOLE_SHARE = .01         # never-uncovered pixels, of the frame area; smaller holes are filled spatially with a warning
MAX_SAMPLES = 60
# Never-uncovered specks below this share of the frame (~400 px at 1080p) are texture-filled; they never need the paid eraser.
HOLE_TOLERANCE = .0002


class Refusal(Exception):
    pass


class Fallback(Exception):
    """The free clean plate cannot do this shot; the worker may hand it to the paid video eraser."""
    def __init__(self, reason, report):
        super().__init__(reason)
        self.report = report


def emit(message):
    print(json.dumps(message, separators=(',', ':'), allow_nan=False), flush=True)


def progress(value):
    emit(dict(type='progress', value=int(max(0, min(99, value)))))


def probe(path):
    out = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                              'stream=width,height,codec_name', '-of', 'json', path]))
    stream = out['streams'][0]
    return int(stream['width']), int(stream['height']), stream.get('codec_name')


class Frames:
    """Raw frames of [start, start+count/fps) at a constant rate. Alpha masks decode with libvpx to keep alpha."""
    def __init__(self, path, start, count, fps, width, height, mode):
        self.count, self.read_count = count, 0
        self.shape = (height, width, 3) if mode == 'bgr' else (height, width)
        self.size = int(np.prod(self.shape))
        decoder = []
        vf = f'fps={fps},scale={width}:{height},format=bgr24' if mode == 'bgr' else f'fps={fps},alphaextract,scale={width}:{height},format=gray'
        if mode == 'alpha':
            decoder = ['-c:v', 'libvpx-vp9']
        if mode == 'still':
            self.shape, self.size = (height, width, 3), height*width*3
            vf = f'scale={width}:{height},format=bgr24'
        args = ['ffmpeg', '-v', 'error', *decoder, *(['-ss', f'{start:.6f}'] if mode != 'still' else []), '-i', path,
                *(['-t', f'{count/fps + 1/fps:.6f}'] if mode != 'still' else ['-frames:v', '1']), '-an', '-vf', vf, '-f', 'rawvideo', '-']
        self.process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.last = None

    def read(self):
        """The next frame; holds the last decoded frame when the stream is a frame short."""
        if self.read_count >= self.count:
            return None
        data = self.process.stdout.read(self.size) if self.process.stdout else b''
        if len(data) == self.size:
            self.last = np.frombuffer(data, np.uint8).reshape(self.shape)
        elif self.last is None:
            raise RuntimeError('Could not decode the video.')
        self.read_count += 1
        return self.last

    def close(self):
        if self.process.stdout:
            self.process.stdout.close()
        self.process.kill()
        self.process.wait()


def frame_count(start, end, fps):
    return max(1, int(round((end-start)*fps)))


def combined_mask(readers, shape):
    mask = np.zeros(shape, np.uint8)
    for reader in readers:
        np.maximum(mask, reader.read(), out=mask)
    return mask


def encoder(path, width, height, fps, start, alpha):
    pad = f',tpad=start_duration={start:.6f}:start_mode=add:color=0x00000000' if alpha and start > 0 else (f',tpad=start_duration={start:.6f}:start_mode=clone' if start > 0 else '')
    if alpha:
        codec = ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-metadata:s:v:0', 'alpha_mode=1',
                 '-b:v', '0', '-crf', '20', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1']
        vf = f'format=yuva420p{pad}'
    else:
        codec = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
        vf = f'format=yuv420p{pad}'
    return subprocess.Popen(['ffmpeg', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra' if alpha else 'bgr24', '-s', f'{width}x{height}',
                             '-r', str(fps), '-i', '-', '-vf', vf, *codec, '-an', '-y', path], stdin=subprocess.PIPE)


def finish(process):
    process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError('Encoding the Genesis render failed.')


def camera_shift(reference, gray, exclude):
    """Largest displacement (px) of the frame corners under the background's estimated motion, or None if unmeasurable."""
    h, w = reference.shape
    points = cv2.goodFeaturesToTrack(reference, 400, .01, 8, mask=cv2.bitwise_not(exclude), blockSize=5)
    if points is None or len(points) < 12:
        return None
    moved, status, _ = cv2.calcOpticalFlowPyrLK(reference, gray, points, None, **LK)
    good = status.ravel() == 1
    if good.sum() < 12:
        return None
    matrix, inliers = cv2.estimateAffinePartial2D(points[good], moved[good], method=cv2.RANSAC, ransacReprojThreshold=2.)
    if matrix is None or inliers is None or inliers.sum() < 8:
        return None
    frame = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
    return float(np.max(np.linalg.norm(cv2.transform(frame, matrix)-frame, axis=2)))


def fill_holes(plate, holes):
    """Fill never-uncovered areas non-generatively: per hole, copy the shifted patch of the plate whose surrounding
    band best matches the hole's own border (texture continues: hedges, walls, ground lines), then Poisson-blend the
    seam. Telea inpainting only as a last resort when no clean shift exists."""
    h, w = holes.shape
    count, labels, stats, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8), 8)
    result = plate.copy()
    known = ~holes
    for index in range(1, count):
        x, y, bw, bh, area = stats[index]
        hole = labels == index
        pad = max(8, int(min(bw, bh)*.25))
        band = (cv2.dilate(hole.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2*pad+1, 2*pad+1))) > 0) & ~hole
        region = hole | band
        ys, xs = np.nonzero(region)
        by, bx = np.nonzero(band)
        target = plate[by, bx].astype(np.float32)
        best, best_cost = None, np.inf
        steps = [(dx, 0) for dx in range(-3*bw, 3*bw+1, 3)] + [(0, dy) for dy in range(-2*bh, 2*bh+1, 3)]
        for dx, dy in steps:
            if abs(dx) < bw*.6 and abs(dy) < bh*.6:
                continue  # the source must lie clear of the hole itself
            sx, sy = xs+dx, ys+dy
            if sx.min() < 0 or sy.min() < 0 or sx.max() >= w or sy.max() >= h or not known[sy, sx].all():
                continue
            cost = float(np.mean((plate[by+dy, bx+dx].astype(np.float32)-target)**2)) * (1+.002*math.hypot(dx, dy))
            if cost < best_cost:
                best, best_cost = (dx, dy), cost
        if best is None:
            result = cv2.inpaint(result, hole.astype(np.uint8)*255, 5, cv2.INPAINT_TELEA)
            continue
        dx, dy = best
        shifted = np.roll(np.roll(plate, -dy, axis=0), -dx, axis=1)
        mask = (cv2.dilate(hole.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0).astype(np.uint8)*255
        top, left = max(0, y-pad), max(0, x-pad)
        bottom, right = min(h, y+bh+pad), min(w, x+bw+pad)
        center = ((left+right)//2, (top+bottom)//2)
        try:
            result = cv2.seamlessClone(shifted[top:bottom, left:right], result, mask[top:bottom, left:right], center, cv2.NORMAL_CLONE)
        except cv2.error:
            alpha = cv2.GaussianBlur(mask, (9, 9), 0).astype(np.float32)[..., None]/255
            result = (result*(1-alpha) + shifted*alpha).astype(np.uint8)
    return result


def clean_plate(request):
    start, end, fps = request['start'], request['end'], request['fps']
    width, height, _ = probe(request['source'])
    count = frame_count(start, end, fps)
    paid = request.get('fallback') == 'bria'
    dilate = max(3, int(round(min(width, height)*request.get('dilate', .012))))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2*dilate+1, 2*dilate+1))
    samples = set(np.linspace(0, count-1, min(count, MAX_SAMPLES)).round().astype(int).tolist())
    scale = 480/max(width, height)
    small = (max(16, round(width*scale)), max(16, round(height*scale)))

    # Pass 1: sample frames and masks, measure camera motion and coverage.
    source = Frames(request['source'], start, count, fps, width, height, 'bgr')
    masks = [Frames(path, start, count, fps, width, height, 'alpha') for path in request['masks']]
    stack, holes_stack, reference, reference_exclude, shift = [], [], None, None, 0.
    ever_masked = np.zeros((height, width), bool)
    try:
        for index in range(count):
            frame, mask = source.read(), combined_mask(masks, (height, width))
            covered = cv2.dilate((mask > 24).astype(np.uint8)*255, kernel)
            ever_masked |= covered > 0
            if index in samples:
                stack.append(frame.copy())
                holes_stack.append(covered > 0)
                gray = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), small, interpolation=cv2.INTER_AREA)
                exclude = cv2.resize(covered, small, interpolation=cv2.INTER_NEAREST)
                if reference is None:
                    reference, reference_exclude = gray, exclude
                else:
                    measured = camera_shift(reference, gray, cv2.bitwise_or(exclude, reference_exclude))
                    if measured is None:
                        message = 'The camera motion could not be measured: too little static background texture.'
                        if paid:
                            raise Fallback(message, dict(frames=count))
                        raise Refusal(message + ' removeObject and retimeLayer need a static-camera shot.')
                    shift = max(shift, measured/scale)
            progress(index/count*45)
    finally:
        source.close()
        for reader in masks:
            reader.close()
    diagonal = math.hypot(width, height)
    if shift > MAX_CAMERA_SHIFT*diagonal and paid:
        raise Fallback(f'The camera moves (the background shifts up to {shift:.0f} px).', dict(frames=count, cameraShiftPx=round(shift, 2)))
    if shift > MAX_CAMERA_SHIFT*diagonal:
        raise Refusal(f'The camera moves (the background shifts up to {shift:.0f} px, limit {MAX_CAMERA_SHIFT*diagonal:.0f} px). Clean plates in v1 need a static camera: use a locked-off shot or a shorter static range.')
    if not ever_masked.any():
        raise Refusal('The masks are empty over this range, so there is nothing to remove.')

    # Temporal median of each pixel over the samples where it is uncovered, in strips to bound memory.
    holes_all = np.all(holes_stack, axis=0)
    hole_share, masked_share = float(holes_all.sum())/(width*height), float(ever_masked.sum())
    coverage = 1 - float(holes_all.sum())/masked_share
    report = dict(frames=count, samples=len(stack), cameraShiftPx=round(shift, 2), coverage=round(coverage, 4),
                  neverUncoveredShare=round(hole_share, 5), maskedShare=round(masked_share/(width*height), 5), dilatePx=dilate)
    if paid and hole_share > HOLE_TOLERANCE:
        raise Fallback(f'Only {coverage*100:.1f}% of the removed area is ever uncovered; {hole_share*100:.2f}% of the frame is never seen.', report)
    if hole_share > MAX_HOLE_SHARE:
        raise Refusal(f'Only {coverage*100:.1f}% of the removed area is ever uncovered in this clip; {hole_share*100:.2f}% of the frame is never seen (limit {MAX_HOLE_SHARE*100:.0f}%). The subject stays in place too long for a clean plate. Use a range where it moves away, or a different shot.')
    plate = np.zeros((height, width, 3), np.uint8)
    rows = max(8, int(4_000_000 // max(1, len(stack)*width*3)))
    for top in range(0, height, rows):
        strip = np.stack([item[top:top+rows] for item in stack]).astype(np.float32)
        hidden = np.stack([item[top:top+rows] for item in holes_stack])
        strip[hidden] = np.nan
        with np.errstate(all='ignore'):
            median = np.nanmedian(strip, axis=0)
        plate[top:top+rows] = np.nan_to_num(median, nan=0).clip(0, 255).astype(np.uint8)
        progress(45+top/height*10)
    if holes_all.any():
        # Small never-uncovered areas: copied from the best-matching nearby texture of the plate, reported as a warning.
        plate = fill_holes(plate, holes_all)
        report['warning'] = f'{hole_share*100:.2f}% of the frame is never uncovered; it was filled with matching texture from beside it. Check it with getFrames.'

    # Pass 2: each frame keeps its own pixels outside the (feathered) masks; masked pixels come from the plate,
    # with a per-frame gain measured in a ring around the masks so changing light matches.
    source = Frames(request['source'], start, count, fps, width, height, 'bgr')
    masks = [Frames(path, start, count, fps, width, height, 'alpha') for path in request['masks']]
    out = encoder(request['output'], width, height, fps, start, False)
    feather = max(3, dilate//2)*2+1
    ring_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (4*dilate+1, 4*dilate+1))
    plate_f = plate.astype(np.float32)
    try:
        for index in range(count):
            frame, mask = source.read(), combined_mask(masks, (height, width))
            covered = cv2.dilate((mask > 24).astype(np.uint8)*255, kernel)
            if covered.any():
                ring = (cv2.dilate(covered, ring_kernel) > 0) & (covered == 0)
                gain = np.ones(3, np.float32)
                if ring.sum() > 200:
                    gain = np.clip((frame[ring].mean(axis=0)+1)/(plate_f[ring].mean(axis=0)+1), .8, 1.25).astype(np.float32)
                alpha = cv2.GaussianBlur(covered, (feather, feather), 0).astype(np.float32)[..., None]/255
                filled = frame*(1-alpha) + np.clip(plate_f*gain, 0, 255)*alpha
                frame = filled.round().astype(np.uint8)
            out.stdin.write(np.ascontiguousarray(frame).tobytes())
            progress(55+index/count*44)
    finally:
        source.close()
        for reader in masks:
            reader.close()
    finish(out)
    report.update(width=width, height=height)
    return report


KEY_WIDTH = 640


def key_mask(hsv, key):
    """Pixels of the surface's key colour (circular hue distance, enough saturation and value)."""
    hue = hsv[..., 0].astype(np.int16)
    distance = np.minimum(np.abs(hue-key), 180-np.abs(hue-key))
    return ((distance <= 14) & (hsv[..., 1] > 60) & (hsv[..., 2] > 40)).astype(np.uint8)*255


def chroma_key(hsv, quad):
    """The key hue when the seed surface is one saturated colour (a green or blue screen), else None."""
    region = np.zeros(hsv.shape[:2], np.uint8)
    cv2.fillConvexPoly(region, np.round(shrink(quad, .85)).astype(np.int32), 255)
    pixels = hsv[region > 0]
    if len(pixels) < 50 or pixels[:, 1].mean() < 90:
        return None
    angles = pixels[:, 0].astype(np.float32)*np.pi/90
    key = int(round(math.atan2(np.sin(angles).mean(), np.cos(angles).mean())*90/np.pi)) % 180
    share = (key_mask(pixels[None], key) > 0).mean()
    return key if share > .85 else None


def track_keyed(hsvs, occluders, quad, seed, count, ks, key, fps):
    """Chroma surface: align the seed frame's key shape to each frame's key mask (ECC homography, occluders masked
    out), starting from the previous frame shifted by the key region's centroid. Frames without the key are lost."""
    sh, sw = hsvs.shape[1:3]
    scale = np.diag([ks, ks, 1.]).astype(np.float32)
    inverse = np.linalg.inv(scale)
    quad_s = (quad*ks).astype(np.float32)
    surface = np.zeros((sh, sw), np.uint8)
    cv2.fillConvexPoly(surface, np.round(shrink(quad_s, 1.04)).astype(np.int32), 255)
    seed_key = cv2.bitwise_and(key_mask(hsvs[seed], key), surface)
    template = cv2.GaussianBlur(seed_key, (0, 0), 3).astype(np.float32)/255
    expected = max(1., float((seed_key > 0).sum()))
    support = cv2.dilate(surface, np.ones((9, 9), np.uint8))
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5)
    homographies = [None]*count
    homographies[seed] = np.eye(3)
    stops = {}
    reasons = dict(covered=0, gone=0, align=0, mismatch=0)
    stops['lostReasons'] = reasons
    for direction in (1, -1):
        name = 'forward' if direction == 1 else 'backward'
        stops[name] = dict(frame=count-1 if direction == 1 else 0, reason='boundary')
        previous = np.eye(3, dtype=np.float32)
        for index in range(seed+direction, count if direction == 1 else -1, direction):
            occ = cv2.resize(occluders[index], (sw, sh), interpolation=cv2.INTER_NEAREST)
            current = key_mask(hsvs[index], key)
            # Key-coloured pixels inside an occluder mask, and the rim right around them, are the surface it grips:
            # SAM's hand mask can take in the gripped phone, bezel included, and the bezel edge is what aligns it.
            occ[cv2.dilate(current, np.ones((7, 7), np.uint8)) > 0] = 0
            predicted = cv2.perspectiveTransform(quad_s.reshape(-1, 1, 2), previous).reshape(-1, 2)
            near = np.zeros((sh, sw), np.uint8)
            cv2.fillConvexPoly(near, np.round(shrink(predicted, 2.)).astype(np.int32), 255)
            found = cv2.bitwise_and(current, near)
            # The part of the surface the occluders leave visible, in seed coordinates.
            hidden = cv2.warpPerspective(occ, np.linalg.inv(previous), (sw, sh), flags=cv2.INTER_NEAREST)
            visible = cv2.bitwise_and(seed_key, cv2.bitwise_not(hidden))
            if (visible > 0).sum() < .08*expected:
                reasons['covered'] += 1
                continue  # covered: this frame stays uncovered
            if (found > 0).sum() < .15*max(1., float((visible > 0).sum())):
                reasons['gone'] += 1
                continue  # the surface left the frame
            # Initial guess: the previous homography moved by the key region's centroid shift.
            expected_here = cv2.warpPerspective(visible, previous, (sw, sh), flags=cv2.INTER_NEAREST)
            a, b = cv2.moments(found, True), cv2.moments(expected_here, True)
            guess = previous.copy()
            if a['m00'] > 0 and b['m00'] > 0:
                shift = np.float32([[1, 0, a['m10']/a['m00']-b['m10']/b['m00']], [0, 1, a['m01']/a['m00']-b['m01']/b['m00']], [0, 0, 1]])
                guess = (shift @ previous).astype(np.float32)
            image = cv2.GaussianBlur(found, (0, 0), 3).astype(np.float32)/255
            mask = cv2.bitwise_and(support, cv2.bitwise_not(cv2.warpPerspective(occ, np.linalg.inv(guess), (sw, sh), flags=cv2.INTER_NEAREST)))
            try:
                score, warp = cv2.findTransformECC(template, image, guess.copy(), cv2.MOTION_HOMOGRAPHY, criteria, mask, 5)
            except cv2.error:
                reasons['align'] += 1
                continue
            aligned = cv2.warpPerspective(visible, warp, (sw, sh), flags=cv2.INTER_NEAREST) > 0
            # Precision: the key found is where the surface lands. Recall may be low: an unmasked hand hides key pixels.
            both = (aligned & (found > 0)).sum()
            if score < .3 or both < .7*(found > 0).sum() or both < .2*aligned.sum():
                reasons['mismatch'] += 1
                continue
            previous = warp.astype(np.float32)
            homographies[index] = (inverse @ previous @ scale).astype(np.float64)
        progress(30+(35 if direction == 1 else 40))
    return homographies, stops


def order_corners(points):
    points = np.float32(points).reshape(4, 2)
    center = points.mean(axis=0)
    angles = np.arctan2(points[:, 1]-center[1], points[:, 0]-center[0])
    points = points[np.argsort(angles)]  # clockwise in image coordinates, starting at the most negative angle
    first = int(np.argmin(points.sum(axis=1)))
    return np.roll(points, -first, axis=0)  # top-left, top-right, bottom-right, bottom-left


def corners_from_mask(mask):
    binary = (mask > 127).astype(np.uint8)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise Refusal('The surface layer is empty at the seed frame. Pass corners, or segment the surface on a frame where it is visible.')
    hull = cv2.convexHull(max(contours, key=cv2.contourArea))
    perimeter = cv2.arcLength(hull, True)
    for factor in np.linspace(.01, .1, 19):
        approx = cv2.approxPolyDP(hull, factor*perimeter, True)
        if len(approx) == 4:
            return order_corners(approx)
    return order_corners(cv2.boxPoints(cv2.minAreaRect(hull)))


def shrink(quad, factor):
    center = quad.mean(axis=0)
    return center + (quad-center)*factor


def surface(request):
    start, end, fps = request['start'], request['end'], request['fps']
    width, height, _ = probe(request['source'])
    count = frame_count(start, end, fps)
    seed = min(count-1, max(0, int(round((request['time']-start)*fps))))
    scale = min(1., 1280/max(width, height))
    tw, th = round(width*scale), round(height*scale)
    work = tempfile.mkdtemp(prefix='genesis-surface-')
    try:
        return surface_in(request, work, start, end, fps, width, height, count, seed, scale, tw, th)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def surface_in(request, work, start, end, fps, width, height, count, seed, scale, tw, th):
    # Gray tracking frames and occluder masks, disk-backed so long clips do not hold memory.
    grays = np.lib.format.open_memmap(os.path.join(work, 'gray.npy'), 'w+', np.uint8, (count, th, tw))
    occluders = np.lib.format.open_memmap(os.path.join(work, 'occ.npy'), 'w+', np.uint8, (count, th, tw))
    # Small HSV frames for a chroma (green/blue screen) surface: its key shape is tracked directly.
    ks = min(1., KEY_WIDTH/tw)
    sw, sh = round(tw*ks), round(th*ks)
    hsvs = np.lib.format.open_memmap(os.path.join(work, 'hsv.npy'), 'w+', np.uint8, (count, sh, sw, 3))
    lumas = np.zeros(count, np.float32)
    source = Frames(request['source'], start, count, fps, tw, th, 'bgr')
    masks = [Frames(path, start, count, fps, tw, th, 'alpha') for path in request['masks']]
    seed_mask = Frames(request['seedMask'], start, count, fps, tw, th, 'alpha') if request.get('seedMask') else None
    seed_surface = None
    try:
        for index in range(count):
            frame = source.read()
            grays[index] = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            hsvs[index] = cv2.cvtColor(cv2.resize(frame, (sw, sh), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2HSV)
            occ = combined_mask(masks, (th, tw))
            occluders[index] = cv2.dilate((occ > 24).astype(np.uint8)*255, np.ones((7, 7), np.uint8))
            lumas[index] = -1
            if seed_mask is not None:
                layer = seed_mask.read()
                if index == seed:
                    seed_surface = layer.copy()
            progress(index/count*30)
    finally:
        source.close()
        for reader in masks:
            reader.close()
        if seed_mask is not None:
            seed_mask.close()
    if request.get('corners'):
        # The caller's order is the insert's top-left, top-right, bottom-right, bottom-left.
        quad = np.float32(request['corners'])*np.float32([tw, th])
    else:
        quad = np.roll(corners_from_mask(seed_surface), -int(request.get('rotate', 0))//90, axis=0)
    area = cv2.contourArea(quad)
    if area < 400:
        raise Refusal('The surface is too small to track (under 20x20 px). Pass corners around a larger surface.')

    key = chroma_key(hsvs[seed], quad*ks)
    if key is not None:
        homographies, stops = track_keyed(hsvs, occluders, quad, seed, count, ks, key, fps)
        return render_surface(request, quad, homographies, stops, grays, occluders, lumas, count, seed, scale, tw, th, width, height, fps, start, 'chroma-key', key)

    # Track: features on and around the surface (not on occluders), anchored to the seed frame each step,
    # falling back to the previous frame when the direct match is too weak. One homography per frame.
    region_quad = shrink(quad, 1.6)
    diagonal = float(np.linalg.norm(quad[2]-quad[0]))
    def features(index, homography):
        region = np.zeros((th, tw), np.uint8)
        cv2.fillConvexPoly(region, np.round(cv2.perspectiveTransform(region_quad.reshape(-1, 1, 2), homography).reshape(-1, 2)).astype(np.int32), 255)
        region[occluders[index] > 0] = 0
        points = cv2.goodFeaturesToTrack(grays[index], 300, .01, 5, mask=region, blockSize=5)
        return None if points is None else points.reshape(-1, 2)
    seed_points = features(seed, np.eye(3))
    if seed_points is None or len(seed_points) < 12:
        raise Refusal('The surface and its edges have too little texture to track. Choose corners on a frame where the surface edges are sharp.')
    homographies = [None]*count
    homographies[seed] = np.eye(3)
    stops = {}
    for direction in (1, -1):
        name = 'forward' if direction == 1 else 'backward'
        stops[name] = dict(frame=count-1 if direction == 1 else 0, reason='boundary')
        previous, current_h, misses = seed, np.eye(3), 0
        anchor = seed_points
        for index in range(seed+direction, count if direction == 1 else -1, direction):
            if is_cut(grays[previous], grays[index]):
                stops[name] = dict(frame=index, reason='cut')
                break
            predicted = cv2.perspectiveTransform(anchor.reshape(-1, 1, 2), current_h)
            found, status, _ = cv2.calcOpticalFlowPyrLK(grays[seed], grays[index], anchor.reshape(-1, 1, 2).astype(np.float32), predicted.astype(np.float32), flags=cv2.OPTFLOW_USE_INITIAL_FLOW, **LK)
            back, back_status, _ = cv2.calcOpticalFlowPyrLK(grays[index], grays[seed], found, anchor.reshape(-1, 1, 2).astype(np.float32), flags=cv2.OPTFLOW_USE_INITIAL_FLOW, **LK)
            good = (status.ravel() == 1) & (back_status.ravel() == 1) & (np.linalg.norm(back.reshape(-1, 2)-anchor, axis=1) < 1.5)
            spot = np.round(found.reshape(-1, 2)).astype(int)
            inside = (spot[:, 0] >= 0) & (spot[:, 0] < tw) & (spot[:, 1] >= 0) & (spot[:, 1] < th)
            good &= inside
            good[inside] &= occluders[index][spot[inside, 1], spot[inside, 0]] == 0
            homography = None
            if good.sum() >= 10:
                before, after = anchor[good], found.reshape(-1, 2)[good]
                homography, inliers = cv2.findHomography(before, after, cv2.RANSAC, 2.5)
                if homography is not None and (inliers.sum() < 8 or inliers.mean() < .5):
                    homography = None
                if homography is not None:
                    # A homography from features bunched on one side (an occluder covers the rest) extrapolates
                    # wildly. Then the similarity of the same matches carries the surface instead.
                    kept = before[inliers.ravel() == 1]
                    spread = cv2.contourArea(cv2.convexHull(kept.astype(np.float32))) if len(kept) >= 3 else 0.
                    similar, similar_inliers = cv2.estimateAffinePartial2D(before, after, method=cv2.RANSAC, ransacReprojThreshold=2.5)
                    if similar is not None:
                        similar = np.vstack([similar, [0, 0, 1]])
                        a = cv2.perspectiveTransform(quad.reshape(-1, 1, 2), homography).reshape(-1, 2)
                        b = cv2.perspectiveTransform(quad.reshape(-1, 1, 2), similar).reshape(-1, 2)
                        if spread < .6*area or np.max(np.linalg.norm(a-b, axis=1)) > .06*diagonal:
                            homography = similar if similar_inliers.sum() >= 8 else None
            if homography is None:
                misses += 1
                if misses > max(2, round(fps/4)):
                    stops[name] = dict(frame=index, reason='lost')
                    break
                continue
            misses, current_h, previous = 0, homography, index
            homographies[index] = homography
        progress(30+(35 if direction == 1 else 40))
    return render_surface(request, quad, homographies, stops, grays, occluders, lumas, count, seed, scale, tw, th, width, height, fps, start, 'features')


def render_surface(request, quad, homographies, stops, grays, occluders, lumas, count, seed, scale, tw, th, width, height, fps, start, tracker, key=None):
    # Corners per frame, lightly smoothed over neighbours that tracked; frames that did not track stay hidden.
    corners = [None if h is None else cv2.perspectiveTransform(quad.reshape(-1, 1, 2), h).reshape(4, 2) for h in homographies]
    smoothed = []
    for index in range(count):
        if corners[index] is None:
            smoothed.append(None)
            continue
        # Only jitter is smoothed: neighbours more than 3 px away (fast motion) would make the insert lag.
        window = [(weight, corners[index+offset]) for offset, weight in ((-1, 1), (0, 2), (1, 1)) if 0 <= index+offset < count and corners[index+offset] is not None and np.max(np.linalg.norm(corners[index+offset]-corners[index], axis=1)) < 3/scale]
        smoothed.append(sum(weight*item for weight, item in window)/sum(weight for weight, _ in window))
    tracked = [index for index in range(count) if smoothed[index] is not None]
    jitter = 0.
    for index in tracked:
        if index-1 in tracked and index+1 in tracked:
            jitter = max(jitter, float(np.max(np.linalg.norm(smoothed[index-1]-2*smoothed[index]+smoothed[index+1], axis=1))))

    # Light match: the surface's mean luminance per frame (occluders excluded), relative to the seed frame.
    gains = np.ones(count, np.float32)
    if request.get('lightMatch', True):
        for index in tracked:
            region = np.zeros((th, tw), np.uint8)
            cv2.fillConvexPoly(region, np.round(shrink(smoothed[index], .85)).astype(np.int32), 255)
            region[occluders[index] > 0] = 0
            lumas[index] = grays[index][region > 0].mean() if (region > 0).sum() > 50 else -1
        reference = lumas[seed] if lumas[seed] > 0 else None
        if reference:
            raw = np.where(lumas > 0, lumas/reference, np.nan)
            for index in tracked:
                window = raw[max(0, index-2):index+3]
                value = np.nanmedian(window) if np.isfinite(window).any() else 1.
                gains[index] = float(np.clip(value, .5, 1.5))

    # Render: the insert, fitted to the surface's seed aspect (cover crops, stretch fills), warped per frame.
    full = np.float32([width/tw, height/th])
    insert_kind = request['insertKind']
    iw, ih, _ = probe(request['insert'])
    sides = np.linalg.norm(quad-np.roll(quad, -1, axis=0), axis=1)*np.float32([1, 1, 1, 1])
    aspect = (sides[0]+sides[2])/max(1e-6, sides[1]+sides[3])
    if request.get('fit', 'cover') == 'cover':
        if iw/ih > aspect:
            cw, ch = ih*aspect, ih
        else:
            cw, ch = iw, iw/aspect
        crop = np.float32([[(iw-cw)/2, (ih-ch)/2], [(iw+cw)/2, (ih-ch)/2], [(iw+cw)/2, (ih+ch)/2], [(iw-cw)/2, (ih+ch)/2]])
    else:
        crop = np.float32([[0, 0], [iw, 0], [iw, ih], [0, ih]])
    insert_frames = Frames(request['insert'], 0, count, fps, iw, ih, 'still' if insert_kind == 'image' else 'bgr')
    still = insert_frames.read() if insert_kind == 'image' else None
    if insert_kind == 'image':
        insert_frames.close()
    white = np.full((ih, iw), 255, np.uint8)
    out = encoder(request['output'], width, height, fps, start, True)
    blank = np.zeros((height, width, 4), np.uint8)
    # Occluders are cut out of the insert, so the footage's own pixels (a hand) show in front. On a chroma surface,
    # occluder pixels of the key colour are surface: SAM's hand mask can take in the phone it grips.
    cut = bool(request['masks'])
    footage = Frames(request['source'], start, count, fps, width, height, 'bgr') if cut else None
    occluder_masks = [Frames(path, start, count, fps, width, height, 'alpha') for path in request['masks']]
    try:
        for index in range(count):
            image = still if still is not None else insert_frames.read()
            if cut:
                frame, occluder = footage.read(), combined_mask(occluder_masks, (height, width))
            quad_full = None if smoothed[index] is None else smoothed[index]*full
            if quad_full is None:
                out.stdin.write(blank.tobytes())
                continue
            matrix = cv2.getPerspectiveTransform(crop, quad_full.astype(np.float32))
            color = cv2.warpPerspective(image, matrix, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            alpha = cv2.warpPerspective(white, matrix, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            if gains[index] != 1:
                color = np.clip(color.astype(np.float32)*gains[index], 0, 255).astype(np.uint8)
            if cut and occluder.any():
                occluder = (occluder > 24).astype(np.uint8)*255
                if key is not None:
                    occluder[key_mask(cv2.cvtColor(frame, cv2.COLOR_BGR2HSV), key) > 0] = 0
                hold = cv2.GaussianBlur(occluder, (5, 5), 0).astype(np.float32)/255
                alpha = (alpha*(1-hold)).astype(np.uint8)
            out.stdin.write(np.dstack([color, alpha]).tobytes())
            progress(75+index/count*24)
    finally:
        if still is None:
            insert_frames.close()
        if footage is not None:
            footage.close()
        for reader in occluder_masks:
            reader.close()
    finish(out)
    del grays, occluders
    seed_quad = (quad*full).tolist()
    return dict(frames=count, trackedFrames=len(tracked), tracker=tracker, lostFrames=[round(start+index/fps, 3) for index in range(count) if smoothed[index] is None][:60], seedCorners=[[round(x/width, 4), round(y/height, 4)] for x, y in seed_quad],
                cornerJitterPx=round(jitter/scale, 2), stops=stops, lightGain=dict(min=round(float(gains[tracked].min()), 3) if tracked else 1, max=round(float(gains[tracked].max()), 3) if tracked else 1),
                width=width, height=height,
                corners=[None if smoothed[index] is None else [[round(float(x)/tw, 5), round(float(y)/th, 5)] for x, y in smoothed[index]] for index in range(0, count, int(os.environ.get("GENESIS_EVERY") or max(1, round(fps))))])


def erase_mask(masks, shape, kernel):
    mask = combined_mask(masks, shape)
    return cv2.dilate(((mask > 24)*255).astype(np.uint8), kernel)


def erase_prep(request):
    """Source and mask chunks for the paid video eraser: same size, rate and frame count; white = erase, dilated."""
    start, end, fps, out_dir = request['start'], request['end'], request['fps'], request['outDir']
    width, height, _ = probe(request['source'])
    count = frame_count(start, end, fps)
    pieces = max(1, math.ceil(count/(request['chunkSeconds']*fps) - 1e-9))
    bounds = np.linspace(0, count, pieces+1).round().astype(int)
    radius = max(2, int(round(request['dilatePx']*min(width, height)/1080)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2*radius+1, 2*radius+1))
    source = Frames(request['source'], start, count, fps, width, height, 'bgr')
    masks = [Frames(path, start, count, fps, width, height, 'alpha') for path in request['masks']]
    chunks = []
    def open_encoder(path, gray):
        return subprocess.Popen(['ffmpeg', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray' if gray else 'bgr24', '-s', f'{width}x{height}', '-r', str(fps), '-i', '-',
                                 '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '0' if gray else '12', '-pix_fmt', 'gray' if gray else 'yuv420p', '-an', '-y', path], stdin=subprocess.PIPE)
    try:
        for piece in range(pieces):
            first, last = int(bounds[piece]), int(bounds[piece+1])
            src_path, mask_path = os.path.join(out_dir, f'erase-{piece}-source.mp4'), os.path.join(out_dir, f'erase-{piece}-mask.mp4')
            src_out, mask_out = open_encoder(src_path, False), open_encoder(mask_path, True)
            for index in range(first, last):
                src_out.stdin.write(np.ascontiguousarray(source.read()).tobytes())
                mask_out.stdin.write(erase_mask(masks, (height, width), kernel).tobytes())
                progress(index/count*99)
            finish(src_out)
            finish(mask_out)
            chunks.append(dict(source=src_path, mask=mask_path, frames=last-first, seconds=round((last-first)/fps, 4)))
    finally:
        source.close()
        for reader in masks:
            reader.close()
    return dict(chunks=chunks, width=width, height=height, dilatePx=radius)


def erase_join(request):
    """Joins the erased chunks onto the source clock. Pixels outside the dilated mask stay the original's own."""
    start, end, fps = request['start'], request['end'], request['fps']
    width, height, _ = probe(request['source'])
    count = frame_count(start, end, fps)
    radius = max(2, int(round(request['dilatePx']*min(width, height)/1080)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2*radius+1, 2*radius+1))
    feather = max(3, radius//2)*2+1
    source = Frames(request['source'], start, count, fps, width, height, 'bgr')
    masks = [Frames(path, start, count, fps, width, height, 'alpha') for path in request['masks']]
    out = encoder(request['output'], width, height, fps, start, False)
    index = 0
    try:
        for chunk in request['chunks']:
            erased = Frames(chunk['path'], 0, chunk['frames'], fps, width, height, 'bgr')
            try:
                for _ in range(chunk['frames']):
                    frame, filled = source.read(), erased.read()
                    # The blurred edge sits outside the core mask, so every masked pixel comes fully from the eraser.
                    alpha = cv2.GaussianBlur(cv2.dilate(erase_mask(masks, (height, width), kernel), np.ones((feather, feather), np.uint8)), (feather, feather), 0).astype(np.float32)[..., None]/255
                    out.stdin.write((frame*(1-alpha) + filled*alpha).round().astype(np.uint8).tobytes())
                    index += 1
                    progress(index/count*99)
            finally:
                erased.close()
    finally:
        source.close()
        for reader in masks:
            reader.close()
    finish(out)
    return dict(frames=index, width=width, height=height)


if __name__ == '__main__':
    request = json.loads(sys.argv[1])
    ops = dict(cleanPlate=clean_plate, surface=surface, erasePrep=erase_prep, eraseJoin=erase_join)
    try:
        emit(dict(type='result', report=ops[request['op']](request)))
    except Fallback as fallback:
        emit(dict(type='fallback', reason=str(fallback), report=fallback.report))
        sys.exit(4)
    except Refusal as refusal:
        emit(dict(type='refusal', message=str(refusal)))
        sys.exit(3)
