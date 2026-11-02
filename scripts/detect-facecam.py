"""Find fixed webcam boundaries around MediaPipe faces in native source frames."""
import itertools
import json
import sys

import cv2
import numpy as np


def clustered(values, tolerance):
    result = []
    for value in sorted(values):
        if not result or value - result[-1] > tolerance:
            result.append(value)
    return result


def panel_for_face(edges, face, width, height):
    fx, fy, fw, fh = [face[k] * scale for k, scale in
                      zip(('x', 'y', 'w', 'h'), (width, height, width, height))]
    cx, cy = fx + fw / 2, fy + fh / 2
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=35,
                           minLineLength=max(25, int(min(width, height) * .045)),
                           maxLineGap=max(8, int(min(width, height) * .012)))
    xs, ys = [0, width - 1], [0, height - 1]
    if lines is not None:
        for x1, y1, x2, y2 in lines.reshape(-1, 4):
            if abs(x1 - x2) <= 3 and min(y1, y2) <= cy + fh * .25 and max(y1, y2) >= cy - fh * .25:
                xs.append(int((x1 + x2) / 2))
            if abs(y1 - y2) <= 3 and min(x1, x2) <= cx + fw * 3 and max(x1, x2) >= cx - fw * 3:
                ys.append(int((y1 + y2) / 2))
    tolerance = max(3, int(min(width, height) * .004))
    xs, ys = clustered(xs, tolerance), clustered(ys, tolerance)
    lefts = sorted((x for x in xs if x <= fx - fw * .2), reverse=True)[:8]
    rights = sorted(x for x in xs if x >= fx + fw * 1.2)[:8]
    tops = sorted((y for y in ys if y <= fy - fh * .2), reverse=True)[:8]
    bottoms = sorted(y for y in ys if y >= fy + fh * 1.2)[:8]
    dilated = cv2.dilate(edges, np.ones((5, 5), np.uint8)) > 0

    def support(x1, y1, x2, y2):
        if x1 == x2 and x1 in (0, width - 1):
            return .5
        if y1 == y2 and y1 in (0, height - 1):
            return .5
        return float(np.mean(dilated[y1:y2 + 1, x1:x2 + 1]))

    best = None
    for left, right, top, bottom in itertools.product(lefts, rights, tops, bottoms):
        w, h = right - left, bottom - top
        area = w * h / (width * height)
        if not (.015 <= area <= .42 and .65 <= w / max(1, h) <= 2.6
                and w >= fw * 1.35 and h >= fh * 1.6):
            continue
        sides = [support(left, top, left, bottom), support(right, top, right, bottom),
                 support(left, top, right, top), support(left, bottom, right, bottom)]
        # At least three sides must persist, including two observed internal edges.
        observed = [s for s, boundary in zip(sides, [left == 0, right == width - 1,
                    top == 0, bottom == height - 1]) if not boundary]
        if len(observed) < 2 or min(observed) < .28 or sorted(sides)[1] < .5:
            continue
        score = float(np.mean(sides)) - .25 * area
        if best is None or score > best[0]:
            best = (score, dict(x=left / width, y=top / height,
                               w=(right - left + 1) / width, h=(bottom - top + 1) / height))
    return best


def gameplay(rect):
    x, y, w, h = (rect[k] for k in ('x', 'y', 'w', 'h'))
    choices = [dict(x=0., y=0., w=x, h=1.), dict(x=x + w, y=0., w=1 - x - w, h=1.),
               dict(x=0., y=0., w=1., h=y), dict(x=0., y=y + h, w=1., h=1 - y - h)]
    return max(choices, key=lambda r: r['w'] * r['h'])


def main():
    cv2.setNumThreads(2)
    source, evidence_path = sys.argv[1:3]
    with open(evidence_path) as file:
        evidence = json.load(file)
    capture = cv2.VideoCapture(source)
    if not capture.isOpened():
        raise ValueError('OpenCV cannot decode the source video.')
    width, height = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = capture.get(cv2.CAP_PROP_FRAME_COUNT) / max(1, capture.get(cv2.CAP_PROP_FPS))
    if (width, height) != (evidence['width'], evidence['height']):
        raise ValueError('MediaPipe and OpenCV source dimensions disagree.')
    samples = []
    try:
        for sample in evidence['samples']:
            time, faces = sample['time'], sample['faces']
            frames = []
            for moment in sorted(set(max(0, min(duration - .05, time + offset)) for offset in (-1., -.5, 0., .5, 1.))):
                capture.set(cv2.CAP_PROP_POS_MSEC, moment * 1000)
                ok, frame = capture.read()
                if ok:
                    frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
            candidates = []
            if len(frames) >= 3:
                edge_frames = [cv2.Canny(frame, 60, 150) > 0 for frame in frames]
                persistent = (np.mean(edge_frames, axis=0) >= .6).astype(np.uint8) * 255
                for face in faces:
                    candidate = panel_for_face(persistent, face, width, height)
                    if candidate:
                        candidates.append(candidate)
            candidates.sort(key=lambda c: c[0], reverse=True)
            full = dict(x=0., y=0., w=1., h=1.)
            result = dict(time=time, kind='uncertain', facecam=None, gameplay=full,
                          confidence=.3, reason='No clear fixed webcam panel. Use face tracking or retain a wider frame.')
            if candidates:
                score, rect = candidates[0]
                if len(candidates) == 1 or candidates[1][0] < score - .12:
                    result.update(kind='overlay', facecam=rect, gameplay=gameplay(rect),
                                  confidence=min(.95, .5 + .45 * score),
                                  reason='MediaPipe face inside persistent OpenCV rectangle edges; gameplay is the largest unobscured rectangle.')
            elif any(f['w'] * f['h'] > .12 for f in faces):
                result.update(kind='creator-only', facecam=full, gameplay=None, confidence=.75,
                              reason='A large visible face fills the source; no separate fixed overlay panel was measured.')
            samples.append(result)
    finally:
        capture.release()
    print(json.dumps(dict(version=1, samples=samples)))


if __name__ == '__main__':
    main()
