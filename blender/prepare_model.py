"""
Przygotowanie pobranego modelu drzewa pod three.js.

KROK 1 — diagnoza. MODE = "inspect", otwórz .blend z modelem, Run Script,
wklej mi wydruk.

KROK 2 — obróbka. MODE = "process" przerzedza koronę, ścina konstrukcję do
budżetu, centruje drzewo i eksportuje tree.glb + tips.json.

UWAGA: "process" NISZCZY dane w pamięci. Przed każdym kolejnym przebiegiem
trzeba wczytać oryginalny .blend od nowa (File → Revert), inaczej tniesz to,
co już zostało pocięte.
"""

import bpy, json, os

from mathutils import Vector

MODE = "process"          # "inspect" albo "process"

# ── progi ──────────────────────────────────────────────────────────────
# Pierwszy przebieg (LEAF_KEEP 0.035, budżet 160k) dał drzewo bez korony
# i z konstrukcją rozjechaną w szare drzazgi. Pomiar na wyeksportowanym
# glb: płatek ma 2.7 cm przy drzewie 7.1 m, czyli jakieś 2 piksele w kadrze
# — przy 3.5% zachowanych płatków korona po prostu znikała. Gałęzie poszły
# w decymację na ratio ~0.13 i zostały z nich iglice o proporcji 1:1435.
LEAF_KEEP     = 0.06      # ile płatków zostawić (0..1)
PETAL_SCALE   = 3.4       # ...i ile razy je powiększyć, żeby nadrobiły resztę
BRANCH_TRIS   = 150_000   # budżet na konstrukcję
MIN_RATIO     = 0.25      # poniżej tego decymacja robi z gałęzi drzazgi
TEX_MAX       = 1024      # maksymalny bok tekstury koloru
AUX_TEX_MAX   = 512       # ...i map pomocniczych; sama roughness ważyła 1.2 MB
AUX_HINTS     = ("rough", "metal", "height", "displac", "normal", "_ao", "spec")
# Ścieżki BEZWZGLĘDNE. "//" znaczy "obok pliku .blend" i przy niezapisanym
# pliku rozwija się do katalogu instalacyjnego Blendera → PermissionError.
OUT_DIR       = r"C:\Users\mlena\Documents\my-new-portfolio\public\scene"
GLB_PATH      = os.path.join(OUT_DIR, "tree.glb")
TIPS_PATH     = os.path.join(OUT_DIR, "tips.json")
TIPS_COUNT    = 900       # ile punktów świetlnych wygenerować z korony

# Słowa, po których rozpoznajemy listowie. Liście trzeba PRZERZEDZAĆ
# (usuwać całe płaszczyzny), a nie decymować – decymacja zniszczy
# prostokąty z teksturą alfa i zostaną trójkątne strzępy.
# UWAGA: nie wpisywać tu nazwy gatunku ("sakura"), bo pasuje do WSZYSTKIEGO
# w takim pliku – łącznie z sakuratree_trunk.
LEAF_HINTS = ("petal", "blossom", "canopy", "leaf", "leaves", "flower",
              "foliage", "kwiat")


def tri_count(ob):
    return sum(max(len(p.vertices) - 2, 0) for p in ob.data.polygons)


def is_leaf(ob):
    if any(h in ob.name.lower() for h in LEAF_HINTS):
        return True
    return any(s.material and any(h in s.material.name.lower() for h in LEAF_HINTS)
               for s in ob.material_slots)


meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# ── KROK 1: diagnoza ───────────────────────────────────────────────────
if MODE == "inspect":
    rows = [(tri_count(ob), ob) for ob in meshes]
    total = sum(t for t, _ in rows)
    print("\n" + "=" * 68)
    print("OBIEKTY (%d siatek)" % len(meshes))
    print("=" * 68)
    for t, ob in sorted(rows, key=lambda r: -r[0])[:40]:
        mats = ",".join(s.material.name for s in ob.material_slots if s.material)[:42]
        print("%9d tri  %-26s %-20s %s"
              % (t, ob.name[:26], mats, "LIŚCIE" if is_leaf(ob) else ""))
    if len(rows) > 40:
        print("... i jeszcze %d obiektów" % (len(rows) - 40))

    leaf_tris = sum(t for t, ob in rows if is_leaf(ob))
    print("-" * 68)
    print("RAZEM: %d trójkątów | listowie: %d (%.0f%%) | reszta: %d"
          % (total, leaf_tris, 100 * leaf_tris / max(total, 1), total - leaf_tris))

    print("\nTEKSTURY")
    for img in bpy.data.images:
        if img.size[0]:
            print("  %-38s %dx%d  %s"
                  % (img.name[:38], img.size[0], img.size[1],
                     "spakowana" if img.packed_file else img.filepath[:30]))

    print("\nWYMIARY")
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for ob in meshes:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            mn = Vector(min(mn[i], w[i]) for i in range(3))
            mx = Vector(max(mx[i], w[i]) for i in range(3))
    print("  bbox %.2f x %.2f x %.2f, podstawa na z=%.2f"
          % (mx.x - mn.x, mx.y - mn.y, mx.z - mn.z, mn.z))
    print("\nUstaw MODE = \"process\".\n")

# ── KROK 2: obróbka ────────────────────────────────────────────────────
else:
    import bmesh

    # Drugi przebieg na tych samych danych tnie to, co już pocięte: korona
    # spada do ułamka ułamka, a gałęzie zostają w stanie z poprzedniej
    # decymacji. Znacznik siedzi w scenie, więc ginie razem z Revertem.
    if bpy.context.scene.get("tree_processed"):
        raise SystemExit(
            "\nTen plik był już przerobiony w tej sesji.\n"
            "File → Revert (albo otwórz oryginalny .blend) i odpal jeszcze raz.\n")
    bpy.context.scene["tree_processed"] = True

    leaves = [o for o in meshes if is_leaf(o)]
    solid  = [o for o in meshes if not is_leaf(o)]
    print("listowie: %d obiektów (%d tri) | konstrukcja: %d obiektów (%d tri)"
          % (len(leaves), sum(tri_count(o) for o in leaves),
             len(solid), sum(tri_count(o) for o in solid)))

    # ── korona ─────────────────────────────────────────────────────────
    # Płatki to osobne wysepki po 2 trójkąty: losujemy je per wysepka,
    # a te, które zostają, powiększamy wokół własnego środka.
    for ob in leaves:
        me = ob.data
        before = tri_count(ob)
        bm = bmesh.new(); bm.from_mesh(me)
        bm.verts.index_update()

        # Wysepki przez union-find po krawędziach. Grupowanie po kwantowanym
        # centroidzie (pierwsza wersja) rozcinało co czwarty płatek na pół:
        # dwa trójkąty jednego quada mają różne centroidy i wpadały do
        # sąsiednich komórek.
        parent = list(range(len(bm.verts)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for e in bm.edges:
            ra, rb = find(e.verts[0].index), find(e.verts[1].index)
            if ra != rb:
                parent[ra] = rb

        faces_of = {}
        for f in bm.faces:
            faces_of.setdefault(find(f.verts[0].index), []).append(f)

        # Kolejność ma znaczenie: skalujemy PRZED usuwaniem, bo po
        # bmesh.ops.delete indeksy wierzchołków przestają pasować do tablicy
        # union-find.
        kill = []
        kept = 0
        big = 0
        for root, fs in faces_of.items():
            if len(fs) > 8:          # to nie płatek, tylko zrośnięty kawałek
                big += 1
                continue
            if (hash(root) % 10000) >= LEAF_KEEP * 10000:
                kill.extend(fs)
                continue
            kept += 1
            # Powiększenie płatka wokół własnego środka. Sama redukcja ich
            # liczby zostawia przezroczystą koronę; skalowanie nadrabia
            # pokrycie za ułamek trójkątów.
            vs = {v for f in fs for v in f.verts}
            c = Vector((0, 0, 0))
            for v in vs:
                c += v.co
            c /= len(vs)
            for v in vs:
                v.co = c + (v.co - c) * PETAL_SCALE

        bmesh.ops.delete(bm, geom=kill, context='FACES')
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context='VERTS')

        bm.to_mesh(me); bm.free()
        print("  %-24s %8d → %8d tri | płatków %d, zostawionych %d%s"
              % (ob.name[:24], before, tri_count(ob), len(faces_of), kept,
                 ", pominięto %d zrośniętych" % big if big else ""))

    leaf_tris = sum(tri_count(o) for o in leaves)
    print("korona po przerzedzeniu: %d tri" % leaf_tris)

    # ── konstrukcja ────────────────────────────────────────────────────
    solid_tris = sum(tri_count(o) for o in solid)
    ratio = min(1.0, BRANCH_TRIS / max(solid_tris, 1))
    if ratio < MIN_RATIO:
        print("UWAGA: budżet wymagałby ratio %.3f — podnoszę do %.2f, "
              "niżej decymacja robi z gałęzi drzazgi" % (ratio, MIN_RATIO))
        ratio = MIN_RATIO
    print("konstrukcja %d tri, ratio %.3f" % (solid_tris, ratio))
    if ratio < 0.99:
        for ob in solid:
            m = ob.modifiers.new("Dec", 'DECIMATE')
            m.ratio = ratio
            m.use_collapse_triangulate = True   # bez tego wychodzą n-gony-igły
            dg = bpy.context.evaluated_depsgraph_get()
            new_me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
            ob.modifiers.clear()
            ob.data = new_me
            print("  %-24s → %8d tri" % (ob.name[:24], tri_count(ob)))

    # ── tekstury ───────────────────────────────────────────────────────
    for img in bpy.data.images:
        w, h = img.size
        lim = AUX_TEX_MAX if any(x in img.name.lower() for x in AUX_HINTS) else TEX_MAX
        if w > lim or h > lim:
            sc = lim / max(w, h)
            img.scale(max(int(w * sc), 4), max(int(h * sc), 4))
            print("  tekstura %s → %dx%d" % (img.name[:30], img.size[0], img.size[1]))

    # ── pień ───────────────────────────────────────────────────────────
    # Materiał pnia ma w Base Color łatkę na szew: 91% jej pikseli jest
    # przezroczystych, a pod spodem czerń. glTF nie umie mixów węzłów, więc
    # eksportuje samą łatkę i pień wychodzi czarny (albo znika, jeśli
    # przeglądarka potraktuje alfę serio). Wpinamy zwykłą korę.
    bark = next((i for i in bpy.data.images
                 if "bark" in i.name.lower() and "base" in i.name.lower()
                 and i.size[0]), None)
    trunks = [m for m in bpy.data.materials if "trunk" in m.name.lower()]
    if not bark:
        print("  pień: nie znalazłem tekstury kory, zostaje jak jest")
    elif not trunks:
        print("  pień: nie znalazłem materiału pnia")
    for mat in trunks if bark else []:
        nt = mat.node_tree
        nodes = [n for n in (nt.nodes if nt else [])
                 if n.bl_idname == 'ShaderNodeTexImage' and n.image
                 and "seam" in n.image.name.lower()]
        for n in nodes:
            n.image = bark
        print("  pień (%s): %s" % (mat.name,
              "podmieniono %d łatek na %s" % (len(nodes), bark.name) if nodes
              else "brak łatki na szew, zostawiam"))

    # ── punkty świetlne z realnej korony ───────────────────────────────
    import random
    random.seed(1)
    pts = []
    for ob in leaves:
        mw = ob.matrix_world
        pts.extend(mw @ v.co for v in ob.data.vertices)
    if not pts:
        for ob in meshes:
            mw = ob.matrix_world
            pts.extend(mw @ v.co for v in ob.data.vertices)
        zs = sorted(p.z for p in pts)
        pts = [p for p in pts if p.z > zs[int(len(zs) * 0.55)]]
    random.shuffle(pts)
    pts = pts[:TIPS_COUNT]

    # Orbita w three.js kręci się wokół osi Y, więc drzewo musi stać
    # w środku układu, podstawą na zerze.
    allv = [(ob.matrix_world @ v.co) for ob in meshes for v in ob.data.vertices]
    cx = (min(p.x for p in allv) + max(p.x for p in allv)) / 2
    cy = (min(p.y for p in allv) + max(p.y for p in allv)) / 2
    zmin = min(p.z for p in allv)
    for ob in meshes:
        ob.location.x -= cx
        ob.location.y -= cy
        ob.location.z -= zmin
    bpy.context.view_layer.update()
    print("przesunięto o (%.2f, %.2f, %.2f)" % (-cx, -cy, -zmin))

    # three.js ma Y w górę, Blender Z
    data = {"tips": [[round(p.x - cx, 4), round(p.z - zmin, 4), round(-(p.y - cy), 4)]
                     for p in pts],
            "height": round(max(p.z for p in pts) - zmin, 4)}
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(TIPS_PATH, "w") as f:
        json.dump(data, f)

    # ── eksport ────────────────────────────────────────────────────────
    for ob in bpy.data.objects:
        try:
            ob.select_set(ob.type == 'MESH')
        except (AttributeError, RuntimeError):
            pass

    kwargs = dict(filepath=GLB_PATH, export_format='GLB', use_selection=True,
                  export_apply=True, export_yup=True)
    try:
        bpy.ops.export_scene.gltf(
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6, **kwargs)
    except TypeError:
        print("Draco niedostępne, eksport bez kompresji siatki")
        bpy.ops.export_scene.gltf(**kwargs)

    print("\ntree.glb : %.2f MB | tri: %d | punktów: %d"
          % (os.path.getsize(GLB_PATH) / 1e6,
             sum(tri_count(o) for o in meshes), len(pts)))
    print("zapisane w %s" % OUT_DIR)
