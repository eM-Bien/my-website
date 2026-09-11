"""
Świecące drzewo — turntable do osadzenia na stronie.

Uruchomienie:
    blender -b -P tree.py                 # render sekwencji
    blender -P tree.py                    # podgląd w GUI

Wynik: PNG z alfą w OUT_DIR, gotowe do złożenia w sprite sheet albo WebM.
"""

import bpy, bmesh, math, random
from mathutils import Vector, Matrix

# ── parametry ──────────────────────────────────────────────────────────
SEED          = 7
FRAMES        = 120          # pełny obrót; 120 @ 30fps = 4 s pętli
RES           = (1000, 1200)
SAMPLES       = 64
TRANSPARENT   = True         # alfa zamiast nieba – do wrzucenia na stronę
OUT_DIR       = "//frames/"
EXPORT_GLB    = True         # True = eksport modelu zamiast renderu klatek
GLB_PATH      = "//tree.glb"
TIPS_PATH     = "//tips.json"
DECIMATE      = 0.22         # ile zostawić z siatki gałęzi

# Sylwetka: niski gruby pień, konary rozchodzące się nisko, szeroka kopuła.
TRUNK_H       = 2.2          # pień do pierwszego rozwidlenia (krótki!)
TRUNK_R       = 0.48         # promień u podstawy (gruby)
CROWN_Z       = 5.6          # środek korony nad ziemią
CROWN_RX      = 5.8          # promień korony w poziomie (szeroka)
CROWN_RZ      = 4.0          # promień w pionie (spłaszczona = kopuła)
BRANCH_LEVELS = 7            # głębokość rekurencji
SPLIT_MIN     = 2            # rozgałęzień na węzeł
SPLIT_MAX     = 3
FIRST_SPLIT   = 5            # ile konarów wychodzi z pnia
GLOW_COLOR    = (0.15, 0.62, 1.0)
WARM_COLOR    = (1.0, 0.45, 0.12)

random.seed(SEED)

# ── scena od zera ──────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll  = bpy.context.collection


def mat_emissive(name, color, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = (*color, 1.0)
    e.inputs['Strength'].default_value = strength
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(e.outputs['Emission'], o.inputs['Surface'])
    return m


def mat_bark(name, color):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Roughness'].default_value = 0.85
    return m


BARK  = mat_bark("Bark", (0.020, 0.016, 0.028))
GLOW  = mat_emissive("Glow", GLOW_COLOR, 6.0)
GLOW2 = mat_emissive("GlowSoft", (0.20, 0.62, 1.0), 2.2)
WARM  = mat_emissive("Warm", WARM_COLOR, 5.0)

# ── rekurencyjne gałęzie ───────────────────────────────────────────────
# Zbieramy odcinki do JEDNEJ krzywej (wiele splajnów w jednym datablocku).
# Setki osobnych obiektów zabijają zarówno viewport, jak i eksport.
segments = []   # (punkty, promienie)
tips     = []   # końcówki – tam wiesza się listowie i światełka


def crown_target():
    """Losowy punkt na powłoce korony (górna część elipsoidy).

    To jest sedno kształtu: zamiast puszczać gałęzie losowo i liczyć na
    ładną sylwetkę, każda z nich jest ciągnięta do tej powierzchni. Kopułę
    ustawia się wtedy trzema liczbami, a nie strojeniem losowości.
    """
    while True:
        v = Vector((random.gauss(0, 1), random.gauss(0, 1), random.gauss(0, 1)))
        if v.length > 1e-4:
            break
    v.normalize()
    if v.z < -0.55:              # spód kopuły zostaje pusty
        v.z = -v.z * 0.6
    # pierwiastek szcześcienny daje równomierne wypełnienie objętości;
    # bez tego wszystkie końcówki lądują na skorupie i korona jest dyskiem
    f = random.uniform(0.30, 1.0) ** (1 / 3)
    return Vector((v.x * CROWN_RX * f, v.y * CROWN_RX * f,
                   CROWN_Z + v.z * CROWN_RZ * f))


def grow(base, direction, length, radius, level, target=None):
    if target is None:
        target = crown_target()

    pts, radii = [base.copy()], [radius]
    d = direction.normalized()
    steps = 4
    for i in range(steps):
        # im cieńsza gałąź, tym mocniej ciągnie ją powłoka korony
        pull = 0.05 if level == 0 else min(0.12 + level * 0.10, 0.55)
        to_t = (target - pts[-1])
        if to_t.length > 1e-4:
            d = (d * (1 - pull) + to_t.normalized() * pull).normalized()
        w = 0.05 if level == 0 else 0.26
        d = (d + Vector((random.uniform(-w, w),
                         random.uniform(-w, w),
                         random.uniform(-w, w)))).normalized()
        p = pts[-1] + d * (length / steps)
        pts.append(p)
        taper = 0.16 if level == 0 else 0.50
        radii.append(radius * (1 - (i + 1) / steps * taper))
    segments.append((pts, radii))

    if level >= BRANCH_LEVELS or radius < 0.010:
        tips.append(pts[-1])
        return

    n = FIRST_SPLIT if level == 0 else random.randint(SPLIT_MIN, SPLIT_MAX)
    for k in range(n):
        if level == 0:
            # konary wychodzą z pnia gwiaździście, każdy w swoją ćwiartkę
            ang = (k + random.uniform(-0.25, 0.25)) * math.tau / n
            nd = Vector((math.cos(ang) * 0.85, math.sin(ang) * 0.85,
                         random.uniform(0.55, 0.95))).normalized()
            nt = Vector((math.cos(ang) * CROWN_RX * random.uniform(0.55, 1.0),
                         math.sin(ang) * CROWN_RX * random.uniform(0.55, 1.0),
                         CROWN_Z + random.uniform(-0.3, 1.0) * CROWN_RZ))
        else:
            spread = 0.75
            nd = (d + Vector((random.uniform(-spread, spread),
                              random.uniform(-spread, spread),
                              random.uniform(-0.25, 0.45)))).normalized()
            nt = crown_target()
        grow(pts[-1], nd,
             length * random.uniform(0.66, 0.80),
             radius * random.uniform(0.66, 0.78),
             level + 1, nt)


grow(Vector((0, 0, 0)), Vector((0, 0, 1)), TRUNK_H, TRUNK_R, 0)
print(f"gałęzi: {len(segments)}  końcówek: {len(tips)}")

curve = bpy.data.curves.new("BranchCurve", 'CURVE')
curve.dimensions = '3D'
curve.resolution_u = 2
curve.bevel_depth = 1.0
curve.bevel_resolution = 2
curve.use_fill_caps = True
for pts, radii in segments:
    sp = curve.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, (p, r) in enumerate(zip(pts, radii)):
        sp.points[i].co = (*p, 1.0)
        sp.points[i].radius = r
tree = bpy.data.objects.new("Branches", curve)
tree.data.materials.append(BARK)
coll.objects.link(tree)

# ── listowie i światełka: jeden mesh na materiał ───────────────────────
def blob_cloud(name, points, material, radius, jitter, count_per_point, flat=1.0):
    bm = bmesh.new()
    for p in points:
        for _ in range(count_per_point):
            off = Vector((random.gauss(0, jitter),
                          random.gauss(0, jitter),
                          random.gauss(0, jitter * 0.7)))
            r = radius * random.uniform(0.55, 1.5)
            m = (Matrix.Translation(p + off)
                 @ Matrix.Diagonal((1, 1, flat, 1)).to_4x4())
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r, matrix=m)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(material)
    coll.objects.link(ob)
    return ob


LEAF = mat_bark("Leaf", (0.030, 0.045, 0.075))
leaves = blob_cloud("Leaves", tips, LEAF, 0.17, 0.23, 4, flat=0.45)

glow_pts  = random.sample(tips, min(len(tips), 240))
glow_pts2 = random.sample(tips, min(len(tips), 160))
lights_a  = blob_cloud("Glow",     glow_pts,  GLOW,  0.045, 0.20, 3)
lights_b  = blob_cloud("GlowHalo", glow_pts2, GLOW2, 0.13,  0.26, 1)
warm_pts  = [p for p in tips if p.z < TRUNK_H * 0.9]
lights_c  = blob_cloud("Warm", random.sample(warm_pts, min(len(warm_pts), 40)),
                       WARM, 0.03, 0.15, 1)

# ── "motyle": dwa trójkąty, rozrzucone wokół korony ────────────────────
bm = bmesh.new()
for _ in range(22):
    a = random.uniform(0, math.tau)
    rad = random.uniform(1.4, 4.2)
    p = Vector((math.cos(a) * rad, math.sin(a) * rad,
                random.uniform(TRUNK_H * 0.45, TRUNK_H * 1.5)))
    s = random.uniform(0.02, 0.05)
    rot = (Matrix.Rotation(random.uniform(0, math.tau), 4, 'Z')
           @ Matrix.Rotation(random.uniform(-0.7, 0.7), 4, 'X'))
    for sign in (1, -1):
        vs = [bm.verts.new(p + rot @ Vector(v))
              for v in ((0, 0, 0), (sign * s * 1.8, s * 0.4, s * 0.9),
                        (sign * s * 1.5, -s * 0.5, -s * 0.5))]
        bm.faces.new(vs)
me = bpy.data.meshes.new("Butterflies")
bm.to_mesh(me); bm.free()
butterflies = bpy.data.objects.new("Butterflies", me)
butterflies.data.materials.append(GLOW)
coll.objects.link(butterflies)

# ── wszystko pod jeden pivot ───────────────────────────────────────────
root = bpy.data.objects.new("TREE_ROOT", None)
coll.objects.link(root)
for ob in (tree, leaves, lights_a, lights_b, lights_c, butterflies):
    ob.parent = root

# ── światło: emisja świeci, ale nie oświetla sylwetki ──────────────────
def area_light(name, loc, energy, color, size, target=(0, 0, TRUNK_H * 0.7)):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy, d.color, d.size = energy, color, size
    o = bpy.data.objects.new(name, d); coll.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - o.location).to_track_quat('-Z', 'Y').to_euler()
    return o

area_light("KeyBlue", (-6, -7, 9), 140, (0.35, 0.55, 1.0), 8)
area_light("RimWarm", (7, 4, 3), 90, (1.0, 0.45, 0.18), 5)

# ── kamera: pozycja liczona z bounding boxa, nie wpisana na sztywno ────
bpy.context.view_layer.update()
mins = Vector(( 1e9,  1e9,  1e9))
maxs = Vector((-1e9, -1e9, -1e9))
for ob in (tree, leaves, lights_a, lights_b, lights_c):
    for corner in ob.bound_box:
        w = ob.matrix_world @ Vector(corner)
        mins = Vector((min(mins[i], w[i]) for i in range(3)))
        maxs = Vector((max(maxs[i], w[i]) for i in range(3)))
center = (mins + maxs) / 2
size   = maxs - mins
# przy obrocie drzewo zamiata walec o promieniu = max(x,y) – kadrujemy najgorszy przypadek
radius = max(size.x, size.y) / 2
height = size.z
print("bbox: %.1f x %.1f x %.1f  srodek z=%.1f" % (size.x, size.y, size.z, center.z))

cam_d = bpy.data.cameras.new("Cam"); cam_d.lens = 50
# AUTO dopasowuje sensor do dluzszego boku – przy kadrze pionowym
# to wysokosc, nie szerokosc, i cala matematyka ponizej sie rozjezdza
cam_d.sensor_fit = 'HORIZONTAL'
cam = bpy.data.objects.new("Cam", cam_d); coll.objects.link(cam)
sensor = cam_d.sensor_width
fov_v = 2 * math.atan((sensor * RES[1] / RES[0]) / (2 * cam_d.lens))
fov_h = 2 * math.atan(sensor / (2 * cam_d.lens))
dist = max(height / (2 * math.tan(fov_v / 2)),
           radius * 2 / (2 * math.tan(fov_h / 2))) * 1.26
cam.location = Vector((center.x, center.y - dist, center.z + height * 0.06))
cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

# ── turntable: 0→360° liniowo, żeby pętla się domykała ─────────────────
root.rotation_euler = (0, 0, 0)
root.keyframe_insert("rotation_euler", frame=1)
root.rotation_euler = (0, 0, math.tau)
root.keyframe_insert("rotation_euler", frame=FRAMES + 1)
for fc in root.animation_data.action.fcurves:
    for kp in fc.keyframe_points:
        kp.interpolation = 'LINEAR'
scene.frame_start, scene.frame_end = 1, FRAMES   # klatka FRAMES+1 == klatka 1

# ── eksport do three.js ────────────────────────────────────────────────
if EXPORT_GLB:
    import json, os
    # Operator bpy.ops.object.convert wymaga kontekstu okna i w trybie
    # headless nie przechodzi poll(). Ewaluacja przez depsgraph daje ten sam
    # wynik i działa identycznie w GUI i z -b.
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tree.evaluated_get(dg))
    mesh_obj = bpy.data.objects.new("TreeMesh", me)
    mesh_obj.data.materials.append(BARK)
    coll.objects.link(mesh_obj)
    bpy.data.objects.remove(tree, do_unlink=True)
    print("gałęzie jako siatka: %d wierzchołków" % len(me.vertices))

    if DECIMATE < 1.0:
        dec = mesh_obj.modifiers.new("Dec", 'DECIMATE')
        dec.ratio = DECIMATE
        dg = bpy.context.evaluated_depsgraph_get()
        me2 = bpy.data.meshes.new_from_object(mesh_obj.evaluated_get(dg))
        mesh_obj.modifiers.clear()
        mesh_obj.data = me2
        print("po decymacji: %d wierzchołków" % len(me2.vertices))

    # Orbita kręci się wokół osi Y, więc model musi na niej stać. Po
    # rekurencyjnym wzroście drzewo jest przesunięte w bok (bbox X -5.5..0.7)
    # i bez tego kamera krąży obok niego, a nie dookoła.
    xs = [v.co.x for v in mesh_obj.data.vertices]
    ys = [v.co.y for v in mesh_obj.data.vertices]
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    for v in mesh_obj.data.vertices:
        v.co.x -= cx
        v.co.y -= cy
    tips = [Vector((p.x - cx, p.y - cy, p.z)) for p in tips]
    print("wycentrowano o (%.2f, %.2f)" % (cx, cy))

    # Listowie i światełka NIE idą do glb – w three.js będą instancjonowane
    # z tips.json. Zapieczone w modelu to dziesiątki tysięcy trójkątów,
    # które i tak wyglądałyby gorzej niż punkty z additive blending.
    for ob in (leaves, lights_a, lights_b, lights_c, butterflies):
        bpy.data.objects.remove(ob, do_unlink=True)

    # po usunięciu obiektów iteracja po view_layer.objects zwraca None-y
    for ob in list(bpy.data.objects):
        try:
            ob.select_set(ob is mesh_obj)
        except (AttributeError, RuntimeError):
            pass
    bpy.context.view_layer.objects.active = mesh_obj
    bpy.ops.export_scene.gltf(filepath=bpy.path.abspath(GLB_PATH),
                              export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True)

    # three.js ma Y w górę, Blender Z – zamiana osi przy zapisie, żeby punkty
    # trafiały dokładnie tam, gdzie kończą się gałęzie wyeksportowanego modelu.
    data = {"tips": [[round(p.x, 4), round(p.z, 4), round(-p.y, 4)] for p in tips],
            "height": round(max(p.z for p in tips), 4)}
    with open(bpy.path.abspath(TIPS_PATH), "w") as f:
        json.dump(data, f)
    print("glb: %.2f MB | tips: %d" %
          (os.path.getsize(bpy.path.abspath(GLB_PATH)) / 1e6, len(tips)))
    raise SystemExit(0)

# ── render ─────────────────────────────────────────────────────────────
# W 5.0 identyfikator EEVEE zmienil sie z BLENDER_EEVEE_NEXT na BLENDER_EEVEE.
# Wpisany na sztywno wywala skrypt, wiec wybieramy z tego, co jest dostepne.
_engines = {e.identifier for e in
            bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items}
for _cand in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
    if _cand in _engines:
        scene.render.engine = _cand
        break
print("Blender %s | silnik: %s" % (bpy.app.version_string, scene.render.engine))
scene.render.resolution_x, scene.render.resolution_y = RES
scene.render.film_transparent = TRANSPARENT
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = OUT_DIR
for _attr in ("taa_render_samples", "samples"):
    if hasattr(scene.eevee, _attr):
        setattr(scene.eevee, _attr, SAMPLES); break
if hasattr(scene.eevee, "use_raytracing"):
    scene.eevee.use_raytracing = True
if scene.render.engine == 'CYCLES':
    scene.cycles.samples = SAMPLES

if not TRANSPARENT:
    scene.world = bpy.data.worlds.new("W")
    scene.world.use_nodes = True
    bgn = scene.world.node_tree.nodes["Background"]
    bgn.inputs[0].default_value = (0.004, 0.010, 0.030, 1)
    bgn.inputs[1].default_value = 1.0

# Glare w kompozytorze. W 4.2 EEVEE Next nie ma już ustawienia Bloom –
# bez tego emisja jest tylko jasną plamą i nic nie "świeci".
scene.use_nodes = True
nt = scene.node_tree
nt.nodes.clear()
rl   = nt.nodes.new('CompositorNodeRLayers')
glare = nt.nodes.new('CompositorNodeGlare')
glare.glare_type = 'BLOOM' if 'BLOOM' in \
    {i.identifier for i in glare.bl_rna.properties['glare_type'].enum_items} else 'FOG_GLOW'
def node_set(node, attr, socket, value):
    """W nowszych Blenderach czesc ustawien noda to gniazda wejsciowe,
    a nie properties. Probujemy obu, zeby skrypt nie zalezal od wersji."""
    if hasattr(node, attr):
        try:
            setattr(node, attr, value); return True
        except (TypeError, AttributeError):
            pass
    if socket in node.inputs:
        try:
            node.inputs[socket].default_value = value; return True
        except (TypeError, AttributeError):
            pass
    return False

node_set(glare, "quality",   "Quality",   'HIGH')
node_set(glare, "mix",       "Mix",       0.0)
node_set(glare, "threshold", "Threshold", 1.0)
node_set(glare, "size",      "Size",      8)
# Kluczowe przy TRANSPARENT: poświata z glare'a ląduje na pikselach, które
# mają alfę 0. Bez tego kroku cały blask znika przy złożeniu na stronie
# (zmierzone: 52 100 jasnych pikseli z alfą <20 vs 24 516, które przeżywają).
# Rozszerzamy alfę o jasność poświaty.
bw   = nt.nodes.new('CompositorNodeRGBToBW')
mx   = nt.nodes.new('CompositorNodeMath'); mx.operation = 'MAXIMUM'
sa   = nt.nodes.new('CompositorNodeSetAlpha')
if 'REPLACE_ALPHA' in {e.identifier for e in sa.bl_rna.properties['mode'].enum_items}:
    sa.mode = 'REPLACE_ALPHA'
comp = nt.nodes.new('CompositorNodeComposite')
nt.links.new(rl.outputs['Image'],    glare.inputs['Image'])
nt.links.new(glare.outputs['Image'], bw.inputs['Image'])
nt.links.new(bw.outputs['Val'],      mx.inputs[0])
nt.links.new(rl.outputs['Alpha'],    mx.inputs[1])
nt.links.new(glare.outputs['Image'], sa.inputs['Image'])
nt.links.new(mx.outputs['Value'],    sa.inputs['Alpha'])
nt.links.new(sa.outputs['Image'],    comp.inputs['Image'])

print("Gotowe. TREE_ROOT obraca sie 0-360 w %d klatkach." % FRAMES)

# Uruchomione headless (blender -b -P tree.py) renderuje od razu sekwencje.
# W GUI tylko buduje scene, zeby dalo sie pokrecic parametrami.
if bpy.app.background:
    print("Renderuje %d klatek do %s ..." % (FRAMES, OUT_DIR))
    bpy.ops.render.render(animation=True)
    print("Klatki gotowe. Zlozenie w webm:")
    print("  ffmpeg -framerate 30 -i frames/%04d.png -c:v libvpx-vp9 "
          "-pix_fmt yuva420p -b:v 0 -crf 34 tree.webm")
