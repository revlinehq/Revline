"""Bidirectional, full-resolution CPU pixel tracking. JSON in, dense source PTS out."""
import json
import math
import signal
import subprocess
import sys

import cv2
import numpy as np
from source_frames import SourceFrames

signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
cv2.setNumThreads(2)
LK = dict(winSize=(31, 31), maxLevel=5,
          criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, .01))


def corners(gray, polygon):
    h, w = gray.shape
    left, top = np.maximum(0, np.floor(polygon.min(axis=0)).astype(int))
    right, bottom = np.minimum([w, h], np.ceil(polygon.max(axis=0)).astype(int)+1)
    if right-left < 4 or bottom-top < 4:
        return None
    region = gray[top:bottom, left:right]
    mask = np.zeros(region.shape, np.uint8)
    offset = np.array([left, top], np.float32)
    cv2.fillConvexPoly(mask, np.round(polygon-offset).astype(np.int32), 255)
    points = cv2.goodFeaturesToTrack(region, 100, .008, 3, mask=mask, blockSize=5)
    return None if points is None else points+offset


def patch(gray, polygon, size):
    matrix = cv2.getPerspectiveTransform(polygon.astype(np.float32), np.array(
        [[0, 0], [size[0]-1, 0], [size[0]-1, size[1]-1], [0, size[1]-1]], np.float32))
    return cv2.warpPerspective(gray, matrix, size)


def correlation(a, b):
    a, b = a.astype(np.float32), b.astype(np.float32)
    a, b = a-a.mean(), b-b.mean()
    return float(np.sum(a*b) / max(1., np.linalg.norm(a)*np.linalg.norm(b)))


def is_cut(a, b):
    small_a, small_b = cv2.resize(a, (160, 90)), cv2.resize(b, (160, 90))
    difference = float(np.mean(cv2.absdiff(small_a, small_b)))
    if difference < 32:
        return False
    ha = cv2.calcHist([small_a], [0], None, [32], [0, 256])
    hb = cv2.calcHist([small_b], [0], None, [32], [0, 256])
    cv2.normalize(ha, ha)
    cv2.normalize(hb, hb)
    distance = cv2.compareHist(ha, hb, cv2.HISTCMP_BHATTACHARYYA)
    if distance > .7 and difference > 45:
        return True
    return difference > 65 and distance > .45 and scene_transform(a, b) is None


def scene_transform(a, b):
    # Exclude the outer HUD and weapon area, which can survive a gameplay cut.
    a, b = cv2.resize(a, (480, 270)), cv2.resize(b, (480, 270))
    mask = np.zeros(a.shape, np.uint8)
    mask[45:210, 48:432] = 255
    detector = cv2.ORB_create(nfeatures=1000, fastThreshold=10)
    ka, da = detector.detectAndCompute(a, mask)
    kb, db = detector.detectAndCompute(b, mask)
    if da is None or db is None:
        return None
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(da, db, k=2)
    good = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < .72*pair[1].distance]
    if len(good) < 10:
        return None
    before = np.float32([ka[m.queryIdx].pt for m in good])
    after = np.float32([kb[m.trainIdx].pt for m in good])
    matrix, inliers = cv2.findHomography(before, after, cv2.RANSAC, 3.)
    if inliers is None or int(inliers.sum()) < 8 or float(inliers.mean()) < .25:
        return None
    return matrix


def reacquire(gray, previous, polygon):
    """Same-frame recovery only: never bridge an unseen/occluded frame."""
    h, w = gray.shape
    x, y, bw, bh = cv2.boundingRect(np.round(polygon).astype(np.int32))
    template = previous[max(0, y):min(h, y+bh), max(0, x):min(w, x+bw)]
    if template.size == 0:
        return None
    radius = int(max(100, .2*max(w, h), 2*max(bw, bh)))
    left, top = max(0, x-radius), max(0, y-radius)
    region = gray[top:min(h, y+bh+radius), left:min(w, x+bw+radius)]
    best = None
    for factor in (.9, 1., 1.1):
        tw, th = max(8, round(bw*factor)), max(8, round(bh*factor))
        if tw >= region.shape[1] or th >= region.shape[0]:
            continue
        candidate = cv2.resize(template, (tw, th))
        scores = cv2.matchTemplate(region, candidate, cv2.TM_CCOEFF_NORMED)
        _, score, _, location = cv2.minMaxLoc(scores)
        sx, sy = location
        # Similar-looking repeated targets are ambiguous, even with a high peak.
        scores[max(0, sy-th//2):sy+th//2+1, max(0, sx-tw//2):sx+tw//2+1] = -1
        second = float(scores.max())
        if score < .8 or score-second < .08:
            continue
        new = (polygon - np.array([x, y], np.float32))*factor + np.array([left+sx, top+sy], np.float32)
        if best is None or score > best[0]:
            best = (score, new)
    return best


class Tracker:
    def __init__(self, gray, polygon, center):
        self.previous = gray
        self.polygon = polygon.copy()
        self.center = center.copy()
        self.points = corners(gray, polygon)
        if self.points is None or len(self.points) < 4:
            raise ValueError('Seed has too little texture. Select a box around a distinctive edge or object.')
        size = np.maximum(8, np.minimum(160, np.round(
            [np.linalg.norm(polygon[1]-polygon[0]), np.linalg.norm(polygon[3]-polygon[0])]))).astype(int)
        self.size = tuple(int(v) for v in size)
        self.reference = patch(gray, polygon, self.size)
        if self.reference.std() < 4:
            raise ValueError('Seed patch is flat. Select a textured point or box.')
        self.scale, self.rotation = 1., 0.
        self.velocity = np.zeros(2, np.float32)
        self.seed_polygon = polygon.copy()
        self.seed_center = center.copy()
        self.seed_image = gray.copy()
        self.lost = False

    def recover(self, gray):
        """Re-identify a visible patch after loss, without synthesizing its path."""
        h, w = gray.shape
        best = None
        for image, polygon in [(self.previous, self.polygon), (self.seed_image, self.seed_polygon)]:
            x, y, bw, bh = cv2.boundingRect(np.round(polygon).astype(np.int32))
            template = image[max(0, y):min(h, y+bh), max(0, x):min(w, x+bw)]
            if template.size == 0 or template.std() < 4:
                continue
            # Search the complete frame after loss so a camera pan has no
            # displacement or elapsed-time ceiling. Reject ambiguous peaks.
            for factor in (.5, .67, .8, 1., 1.25, 1.5, 2.):
                tw, th = max(8, round(template.shape[1]*factor)), max(8, round(template.shape[0]*factor))
                if tw >= w or th >= h:
                    continue
                scores = cv2.matchTemplate(gray, cv2.resize(template, (tw, th)), cv2.TM_CCOEFF_NORMED)
                _, score, _, location = cv2.minMaxLoc(scores)
                sx, sy = location
                scores[max(0, sy-th//2):sy+th//2+1, max(0, sx-tw//2):sx+tw//2+1] = -1
                if score < .82 or score-float(scores.max()) < .08:
                    continue
                candidate = (polygon-np.array([x, y], np.float32))*factor+np.array([sx, sy], np.float32)
                if correlation(self.reference, patch(gray, candidate, self.size)) < .65:
                    continue
                if best is None or score > best[0]:
                    best = (score, candidate)
        if best is None:
            return None, 'occluded'
        score, polygon = best
        matrix, _ = cv2.estimateAffinePartial2D(self.seed_polygon, polygon)
        points = corners(gray, polygon)
        if matrix is None or points is None or len(points) < 4:
            return None, 'unreliable'
        self.center = cv2.transform(self.seed_center.reshape(1, 1, 2), matrix)[0, 0]
        self.polygon, self.points, self.previous = polygon, points, gray
        self.scale = math.hypot(matrix[0, 0], matrix[1, 0])
        self.rotation = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
        self.velocity = np.zeros(2, np.float32)
        self.lost = False
        return min(.9, score), None

    def advance(self, gray):
        if self.lost:
            return self.recover(gray)
        if is_cut(self.previous, gray):
            return None, 'cut'
        h, w = gray.shape
        margin = max(96., np.linalg.norm(self.polygon[2]-self.polygon[0]), np.linalg.norm(self.velocity)*1.5)
        lower = np.minimum(self.polygon.min(axis=0), self.polygon.min(axis=0)+self.velocity)-margin
        upper = np.maximum(self.polygon.max(axis=0), self.polygon.max(axis=0)+self.velocity)+margin
        left, top = np.maximum(0, np.floor(lower).astype(int))
        right, bottom = np.minimum([w, h], np.ceil(upper).astype(int))
        offset = np.array([left, top], np.float32)
        previous_region, region = self.previous[top:bottom, left:right], gray[top:bottom, left:right]
        local_points = self.points-offset
        destination, status, errors = cv2.calcOpticalFlowPyrLK(previous_region, region, local_points, None, **LK)
        matrix, confidence = None, 0.
        if destination is not None:
            back, backwards, _ = cv2.calcOpticalFlowPyrLK(region, previous_region, destination, None, **LK)
            if back is not None:
                good = ((status.ravel() == 1) & (backwards.ravel() == 1)
                        & (np.linalg.norm(back-local_points, axis=2).ravel() < 1.5)
                        & (errors.ravel() < 35))
                before, after = self.points[good], destination[good]+offset
                if len(before) >= 4:
                    matrix, inliers = cv2.estimateAffinePartial2D(before, after, method=cv2.RANSAC,
                                                               ransacReprojThreshold=2., maxIters=1000)
                    if matrix is not None:
                        ratio = float(inliers.mean())
                        support = min(1., len(before)/max(8., len(self.points)*.6))
                        confidence = ratio*support
        candidate = cv2.transform(self.polygon[None], matrix)[0] if matrix is not None else None
        h, w = gray.shape
        if candidate is not None:
            proposed_center = cv2.transform(self.center.reshape(1, 1, 2), matrix)[0, 0]
            if not (0 <= proposed_center[0] < w and 0 <= proposed_center[1] < h):
                return None, 'out-of-frame'
            step_scale = math.hypot(matrix[0, 0], matrix[1, 0])
            appearance = correlation(self.reference, patch(gray, candidate, self.size))
            confidence *= max(0., appearance)
            if not (.8 < step_scale < 1.25) or confidence < .48 or appearance < .56:
                matrix = None
        if matrix is None:
            # Search around the prior appearance, with the original template as a drift guard.
            predicted = self.center + self.velocity
            camera = scene_transform(self.previous, gray)
            camera_center = None
            if camera is not None:
                ratio = np.array([480/w, 270/h], np.float32)
                camera_center = cv2.perspectiveTransform((self.center*ratio).reshape(1, 1, 2), camera)[0, 0]/ratio
            if not (0 <= predicted[0] < w and 0 <= predicted[1] < h) and (camera_center is None or not (0 <= camera_center[0] < w and 0 <= camera_center[1] < h)):
                return None, 'out-of-frame'
            recovered = reacquire(gray, self.previous, self.polygon)
            if recovered is None:
                return None, 'occluded'
            score, candidate = recovered
            candidate_center = candidate.mean(axis=0)
            tolerance = max(40., np.linalg.norm(self.polygon[2]-self.polygon[0])*2, np.linalg.norm(self.velocity)*.6)
            appearance = correlation(self.reference, patch(gray, candidate, self.size))
            camera_consistent = camera_center is not None and np.linalg.norm(candidate_center-camera_center) < max(12., np.linalg.norm(self.polygon[2]-self.polygon[0])*.3)
            if np.linalg.norm(candidate_center-predicted) > tolerance and appearance < .94 and not camera_consistent:
                return None, 'unreliable'
            if appearance < (.6 if camera_consistent else .82):
                return None, 'unreliable'
            matrix, _ = cv2.estimateAffinePartial2D(self.polygon, candidate)
            if matrix is None:
                return None, 'unreliable'
            confidence = min(.85, score)*.8
        previous_center = self.center.copy()
        self.center = cv2.transform(self.center.reshape(1, 1, 2), matrix)[0, 0]
        self.velocity = self.center-previous_center
        self.polygon = cv2.transform(self.polygon[None], matrix)[0]
        if (np.any(self.polygon[:, 0] < 0) or np.any(self.polygon[:, 0] >= w)
                or np.any(self.polygon[:, 1] < 0) or np.any(self.polygon[:, 1] >= h)):
            return None, 'out-of-frame'
        self.scale *= math.hypot(matrix[0, 0], matrix[1, 0])
        self.rotation += math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
        if not math.isfinite(self.scale) or self.scale <= 0:
            return None, 'unreliable'
        # Replenish in the moving support region instead of following old background corners.
        self.points = corners(gray, self.polygon)
        if self.points is None or len(self.points) < 4:
            return None, 'unreliable'
        self.previous = gray
        return float(np.clip(confidence, 0, 1)), None


def emit(message):
    print(json.dumps(message, separators=(',', ':'), allow_nan=False), flush=True)



def main(path, request):
    source = SourceFrames(path, request)
    try:
        seed_point = source.seed()
        seed_image = source.read(seed_point)
        h, w = seed_image.shape
        seed = request['seed']
        is_box = seed['kind'] == 'box'
        if is_box:
            box = seed['box']
            left, top, right, bottom = box['left']*(w-1), box['top']*(h-1), box['right']*(w-1), box['bottom']*(h-1)
            center = np.array([(left+right)/2, (top+bottom)/2], np.float32)
        else:
            center = np.array([min(w-1, seed['x']*w), min(h-1, seed['y']*h)], np.float32)
            radius = max(12, round(min(w, h)*.018))
            left, top = np.maximum(0, center-radius)
            right, bottom = np.minimum([w-1, h-1], center+radius)
        polygon = np.array([[left, top], [right, top], [right, bottom], [left, bottom]], np.float32)
        header = dict(seedTime=seed_point[1], sourceFps=source.fps, width=w, height=h)
        emit(dict(type='header', header=header))
        count, minimum, first, last = 0, 1., seed_point[1], seed_point[1]

        def sample(tracker, point, confidence):
            row = dict(frameIndex=point[0], time=point[1], x=float(tracker.center[0]/w), y=float(tracker.center[1]/h),
                       confidence=round(confidence, 4), scale=tracker.scale if is_box else 1., rotation=round(tracker.rotation, 3) if is_box else 0.)
            if is_box:
                p = tracker.polygon
                row['box'] = dict(left=max(0., float(p[:, 0].min()/w)), top=max(0., float(p[:, 1].min()/h)),
                                  right=min(1., float(p[:, 0].max()/w)), bottom=min(1., float(p[:, 1].max()/h)))
                row['box'] = {key: round(value, 6) for key, value in row['box'].items()}
            for key in ('x', 'y', 'scale'):
                row[key] = round(row[key], 6)
            return row

        stops = {}
        for direction, name in [(1, 'forward'), (-1, 'backward')]:
            tracker = Tracker(seed_image, polygon, center)
            pending, sequence = [], 0
            def add(row):
                nonlocal count, minimum, first, last
                count += 1
                minimum, first, last = min(minimum, row['confidence']), min(first, row['time']), max(last, row['time'])
                pending.append(row)
            if direction == 1:
                add(sample(tracker, seed_point, 1.))
            stops[name] = dict(time=request['end'] if direction == 1 else request['start'], reason='boundary')
            stopped = False
            for batch in source.batches(seed_point, direction):
                for point, gray in batch:
                    previous = (tracker.polygon.copy(), tracker.center.copy(), tracker.scale, tracker.rotation)
                    confidence, reason = tracker.advance(gray)
                    if reason == 'cut':
                        stops[name] = dict(time=point[1], reason=reason)
                        stopped = True
                        break
                    if reason:
                        tracker.polygon, tracker.center, tracker.scale, tracker.rotation = previous
                        tracker.lost = True
                        confidence, reason = tracker.recover(gray)
                    if reason:
                        # Zero-confidence rows preserve the measured frame clock.
                        # Attachments hide them until a real match is recovered.
                        add(sample(tracker, point, 0.))
                    else:
                        add(sample(tracker, point, confidence))
                    # Transport batches are repeated, never a shot/frame limit.
                    if len(pending) >= 256:
                        emit(dict(type='chunk', chunk=dict(direction=name, sequence=sequence, samples=sorted(pending, key=lambda row: row['frameIndex']))))
                        pending, sequence = [], sequence+1
                if stopped:
                    break
            if pending:
                emit(dict(type='chunk', chunk=dict(direction=name, sequence=sequence, samples=sorted(pending, key=lambda row: row['frameIndex']))))
        emit(dict(type='complete', result=dict(engine='opencv-klt-template-v2', **header,
                  sampleCount=count, minConfidence=minimum, firstTime=first, lastTime=last, **stops)))
    finally:
        source.close()


if __name__ == '__main__':
    main(sys.argv[1], json.loads(sys.argv[2]))
