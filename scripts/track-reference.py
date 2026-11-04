"""Full-resolution rigid-element registration. NDJSON progress and samples to the media worker."""
import json
import math
import signal
import sys

import cv2
import numpy as np
from source_frames import SourceFrames

signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
cv2.setNumThreads(2)


def emit(value):
    print(json.dumps(value, allow_nan=False), flush=True)


def crop_at(frame, warp, shape):
    return cv2.warpAffine(frame.astype(np.float32) / 255, warp, (shape[1], shape[0]),
                          flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)


def register(frame, template, previous):
    h, w = template.shape
    height, width = frame.shape
    # A full-frame camera template cannot be located inside a smaller search ROI as it grows.
    if h == height and w == width:
        try:
            score, warp = cv2.findTransformECC(template, frame.astype(np.float32) / 255,
                previous.copy(), cv2.MOTION_AFFINE,
                (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 1e-5), None, 5)
            return warp, float(np.clip(score, 0, 1))
        except cv2.error:
            return previous, 0.
    scale = float(np.sqrt(abs(np.linalg.det(previous[:, :2]))))
    # Rotate the search template about its center; ECC then refines all six affine parameters.
    angle = math.degrees(math.atan2(previous[1, 0], previous[0, 0]))
    rotation = cv2.getRotationMatrix2D((w / 2, h / 2), -angle, 1.)
    rotated = cv2.warpAffine(template, rotation, (w, h)) if abs(angle) > .2 else template
    radius = 110
    x, y = previous[:, 2]
    left, top = max(0, int(x - radius)), max(0, int(y - radius))
    right, bottom = min(width, int(x + w * scale + radius)), min(height, int(y + h * scale + radius))
    region = frame[top:bottom, left:right].astype(np.float32) / 255
    best = None
    for s in scale * np.array([.98, .99, 1., 1.01, 1.02]):
        tw, th = max(8, round(w * s)), max(8, round(h * s))
        if th > region.shape[0] or tw > region.shape[1]:
            continue
        resized = cv2.resize(rotated, (tw, th))
        scores = cv2.matchTemplate(region, resized, cv2.TM_CCOEFF_NORMED)
        _, score, _, location = cv2.minMaxLoc(scores)
        if best is None or score > best[0]:
            best = score, s, location
    if best is None:
        return previous, 0.
    score, s, location = best
    local = np.zeros((2, 3), np.float32)
    local[:, :2] = rotation[:, :2] * s
    local[:, 2] = np.array([left + location[0], top + location[1]]) + rotation[:, 2] * s
    corners = local[:, :2] @ np.array([[0, w, 0, w], [0, 0, h, h]]) + local[:, 2:]
    lx, ly = np.maximum(0, np.floor(corners.min(axis=1) - 40).astype(int))
    rx, by = np.minimum([width, height], np.ceil(corners.max(axis=1) + 40).astype(int))
    target = frame[ly:by, lx:rx].astype(np.float32) / 255
    warp = local.copy()
    warp[:, 2] -= [lx, ly]
    try:
        score, warp = cv2.findTransformECC(template, target, warp, cv2.MOTION_AFFINE,
            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 1e-5), None, 5)
        warp[:, 2] += [lx, ly]
        local = warp
    except cv2.error:
        # An integer template peak alone cannot certify subpixel affine geometry.
        return previous, 0.
    singular = np.linalg.svd(local[:, :2], compute_uv=False)
    # Reject a collapsed silhouette or extreme shear, even when correlation looks high.
    if not np.isfinite(local).all() or np.linalg.det(local[:, :2]) <= 0 or singular[-1] < .1 or singular[0] / singular[-1] > 1.3:
        return previous, 0.
    return local, float(np.clip(score, 0, 1))


def track(path, args, source):
    seed = source.seed()
    frame = source.read(seed)
    height, width = frame.shape
    box = args['box']
    x, y, bw, bh = [box[k] for k in ('x', 'y', 'w', 'h')]
    # Context makes a flat card's silhouette observable. Full-frame camera tracking needs no padding.
    left, top = max(0, int(x - 24)), max(0, int(y - 24))
    right, bottom = min(width, int(x + bw + 24)), min(height, int(y + bh + 24))
    template = frame[top:bottom, left:right].astype(np.float32) / 255
    if template.std() < .005:
        raise ValueError('The seed frame is invisible or has too little contrast. Pick a visible frameTime.')
    initial = np.array([[1, 0, left], [0, 1, top]], np.float32)
    center = np.array([x + bw / 2 - left, y + bh / 2 - top])
    background = None
    if 'backgroundTime' in args:
        time = args['backgroundTime']
        calibration = SourceFrames(path, dict(start=max(0., time - .1), end=time + .1, time=time))
        try:
            background = calibration.read(calibration.seed())[top:bottom, left:right].astype(np.float32) / 255
        finally:
            calibration.close()
    delta = template - background if background is not None else None
    denominator = float(np.sum(delta * delta)) if delta is not None else 0.
    if background is not None and denominator / template.size < .0001:
        raise ValueError('Calibration frames do not show an absent and a fully visible element.')
    sharp_variance = float(cv2.Laplacian(template, cv2.CV_32F).var())
    done = 0

    def sample(point, frame, previous):
        nonlocal done
        old_patch = crop_at(frame, previous, template.shape)
        # Before registration: fully transparent elements have no measurable pose. Freeze, never wander.
        alpha = float(np.clip(np.sum((old_patch - background) * delta) / denominator, 0, 1)) if background is not None else None
        enough_contrast = old_patch.std() > max(.003, float(template.std()) * .04)
        gated = alpha is not None and alpha < .05 or not enough_contrast
        candidate, confidence = (previous, 0.) if gated else register(frame, template, previous)
        patch = crop_at(frame, candidate, template.shape)
        residual = None
        if background is not None:
            alpha = float(np.clip(np.sum((patch - background) * delta) / denominator, 0, 1))
            residual = float(np.sqrt(np.mean((patch - background - alpha * delta) ** 2)))
            # A clean background is registered in seed coordinates. Deformation/content changes invalidate alpha.
            opacity_confidence = max(0., 1. - residual / .05)
        else:
            opacity_confidence = 0.
        visible = not gated and confidence >= .65 and (alpha is None or alpha >= .05)
        sharpness = None
        if visible and sharp_variance > 1e-8:
            normalized = (patch - background) / max(alpha, .05) + background if background is not None else patch
            sharpness = float(max(0., cv2.Laplacian(normalized, cv2.CV_32F).var() / sharp_variance))
            # Severe detail loss can masquerade as affine shrinkage. Keep its sharpness signal,
            # but withhold geometry rather than inventing a scale tween from defocus.
            if sharpness < .05:
                confidence = 0.
        warp = candidate if visible and confidence >= .65 else previous
        c = warp[:, :2] @ center + warp[:, 2]
        scale = float(np.sqrt(abs(np.linalg.det(warp[:, :2]))))
        rotation = math.degrees(math.atan2(warp[1, 0], warp[0, 0]))
        value = dict(time=point[1], x=float(c[0] - bw * scale / 2), y=float(c[1] - bh * scale / 2),
                     w=bw * scale, h=bh * scale, scale=scale, rotation=rotation,
                     confidence=confidence if visible else 0., visible=visible)
        if alpha is not None:
            value.update(opacity=alpha, opacityConfidence=opacity_confidence)
        if sharpness is not None:
            value['sharpness'] = sharpness
        emit(dict(sample=value))
        done += 1
        if done % 5 == 0:
            emit(dict(progress=min(80., 10 + 70 * done / max(1., (args['end'] - args['start']) * source.fps))))
        return warp

    previous = sample(seed, frame, initial.copy())
    for batch in source.batches(seed, 1):
        for point, image in batch:
            previous = sample(point, image, previous)
    previous = initial.copy()
    for batch in source.batches(seed, -1):
        for point, image in batch:
            previous = sample(point, image, previous)


def main():
    path, args = sys.argv[1], json.loads(sys.argv[2])
    source = SourceFrames(path, dict(start=args['start'], end=args['end'], time=args.get('frameTime', args['start'])))
    try:
        track(path, args, source)
    finally:
        source.close()


if __name__ == '__main__':
    main()
