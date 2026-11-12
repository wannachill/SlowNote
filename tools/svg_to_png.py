# 将 IconFont 风格 SVG（弧线/贝塞尔 path）渲染为 PNG，用于一迈一记宝宝默认头像
# 支持 path 命令：M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z（完整 SVG 1.1 子集）
import re, math, sys
from PIL import Image, ImageDraw

def tokenize(d):
    return re.findall(r'[MmLlHhVvCcSsQqTtAaZz]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?', d)

def bezier(p0, p1, p2, p3, steps=28):
    pts = []
    for i in range(steps + 1):
        t = i / steps; mt = 1 - t
        x = mt**3*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t**3*p3[0]
        y = mt**3*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t**3*p3[1]
        pts.append((x, y))
    return pts

def arc_points(x1, y1, rx, ry, phi, large, sweep, x2, y2):
    if x1 == x2 and y1 == y2:
        return [(x2, y2)]
    rx, ry = abs(rx), abs(ry)
    phi = math.radians(phi)
    cosf, sinf = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p = cosf*dx + sinf*dy
    y1p = -sinf*dx + cosf*dy
    lam = x1p*x1p/(rx*rx) + y1p*y1p/(ry*ry)
    if lam > 1:
        s = math.sqrt(lam); rx *= s; ry *= s
    num = rx*rx*ry*ry - rx*rx*y1p*y1p - ry*ry*x1p*x1p
    den = rx*rx*y1p*y1p + ry*ry*x1p*x1p
    if den == 0:
        return [(x2, y2)]
    coef = math.sqrt(max(num / den, 0))
    if large == sweep:
        coef = -coef
    cxp = coef * (rx*y1p/ry)
    cyp = coef * (-ry*x1p/rx)
    cx = cosf*cxp - sinf*cyp + (x1 + x2)/2
    cy = sinf*cxp + cosf*cyp + (y1 + y2)/2
    def ang(ux, uy, vx, vy):
        l1 = math.hypot(ux, uy); l2 = math.hypot(vx, vy)
        if l1 == 0 or l2 == 0:
            return 0.0
        a = math.acos(max(-1.0, min(1.0, (ux*vx + uy*vy)/(l1*l2))))
        if ux*vy - uy*vx < 0:
            a = -a
        return a
    theta1 = ang(1, 0, (x1p-cxp)/rx, (y1p-cyp)/ry)
    dtheta = ang((x1p-cxp)/rx, (y1p-cyp)/ry, (-x1p-cxp)/rx, (-y1p-cyp)/ry)
    if not sweep and dtheta > 0:
        dtheta -= 2*math.pi
    elif sweep and dtheta < 0:
        dtheta += 2*math.pi
    n = max(2, int(abs(dtheta) / (math.pi/48)))
    pts = []
    for i in range(n + 1):
        t = theta1 + dtheta*i/n
        x = cx + rx*math.cos(t)*cosf - ry*math.sin(t)*sinf
        y = cy + rx*math.cos(t)*sinf + ry*math.sin(t)*cosf
        pts.append((x, y))
    return pts

def render(svg_text, size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    vb = re.search(r'viewBox="([^"]+)"', svg_text).group(1)
    _, _, vw, vh = [float(v) for v in vb.split()]
    scale = size / vw
    paths = re.findall(r'<path[^>]*d="([^"]*)"[^>]*fill="([^"]*)"', svg_text)
    for data, fill in paths:
        fill = fill.strip()
        if not fill or fill == 'none' or not fill.startswith('#'):
            continue
        fill = fill[1:]
        color = tuple(int(fill[i:i+2], 16) for i in (0, 2, 4))
        tokens = tokenize(data)
        idx = 0
        cur = [0.0, 0.0]; sub_start = [0.0, 0.0]
        last_ctrl = None
        outline = []
        while idx < len(tokens):
            cmd = tokens[idx]; idx += 1
            if cmd == 'Z' or cmd == 'z':
                outline.append(tuple(sub_start))
                cur = list(sub_start)
                continue
            rel = cmd.islower()
            cmd = cmd.upper()
            if cmd == 'M':
                x = float(tokens[idx]); y = float(tokens[idx+1]); idx += 2
                if rel: x += cur[0]; y += cur[1]
                cur = [x, y]; sub_start = [x, y]
                outline = []
            elif cmd == 'L':
                x = float(tokens[idx]); y = float(tokens[idx+1]); idx += 2
                if rel: x += cur[0]; y += cur[1]
                outline.append(tuple(cur)); cur = [x, y]
            elif cmd == 'H':
                x = float(tokens[idx]); idx += 1
                if rel: x += cur[0]
                outline.append(tuple(cur)); cur = [x, cur[1]]
            elif cmd == 'V':
                y = float(tokens[idx]); idx += 1
                if rel: y += cur[1]
                outline.append(tuple(cur)); cur = [cur[0], y]
            elif cmd == 'C':
                pts = []
                for k in range(3):
                    x = float(tokens[idx]); y = float(tokens[idx+1]); idx += 2
                    if rel: x += cur[0]; y += cur[1]
                    pts.append((x, y))
                outline.extend(bezier(tuple(cur), pts[0], pts[1], pts[2]))
                last_ctrl = pts[1]
                cur = list(pts[2])
            elif cmd == 'S':
                pts = []
                for k in range(2):
                    x = float(tokens[idx]); y = float(tokens[idx+1]); idx += 2
                    if rel: x += cur[0]; y += cur[1]
                    pts.append((x, y))
                c1 = last_ctrl if last_ctrl is not None else tuple(cur)
                c1 = (2*cur[0] - c1[0], 2*cur[1] - c1[1])
                outline.extend(bezier(tuple(cur), c1, pts[0], pts[1]))
                last_ctrl = pts[0]
                cur = list(pts[1])
            elif cmd == 'Q':
                x1 = float(tokens[idx]); y1 = float(tokens[idx+1]); idx += 2
                x = float(tokens[idx]); y = float(tokens[idx+1]); idx += 2
                if rel: x1 += cur[0]; y1 += cur[1]; x += cur[0]; y += cur[1]
                outline.extend(bezier(tuple(cur), (x1, y1), (x1, y1), (x, y)))
                cur = [x, y]
            elif cmd == 'A':
                rx = float(tokens[idx]); ry = float(tokens[idx+1]); idx += 2
                rot = float(tokens[idx]); idx += 1
                laf = int(float(tokens[idx])); sf = int(float(tokens[idx+1])); idx += 2
                x = float(tokens[idx]); y = float(tokens[idx+1]); idx += 2
                if rel: x += cur[0]; y += cur[1]
                outline.extend(arc_points(cur[0], cur[1], rx, ry, rot, laf, sf, x, y))
                cur = [x, y]
        if len(outline) >= 3:
            scaled = [(p[0]*scale, p[1]*scale) for p in outline]
            d.polygon(scaled, fill=color + (255,))
    return img

if __name__ == '__main__':
    out_dir = r'D:\JAVA\JavaCode\VibeCoding\SlowNote\miniprogram\images'
    svg_dir = r'D:\JAVA\JavaCode\VibeCoding\SlowNote\tools\svg'
    for name in ['boy', 'girl']:
        with open(svg_dir + '\\' + name + '.svg', 'r', encoding='utf-8') as f:
            svg = f.read()
        img = render(svg, 240)
        img.save(out_dir + '\\' + name + '.png')
        print('saved', name + '.png')
