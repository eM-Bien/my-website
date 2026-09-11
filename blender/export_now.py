"""
Eksport JUŻ PRZEROBIONEJ sceny do projektu.

Odpal to po prepare_model.py, w tej samej sesji Blendera. Nie rusza
geometrii — tylko zapisuje to, co jest w pamięci, pod ścieżki bezwzględne.

Powód istnienia: "//" w ścieżce Blendera znaczy "obok pliku .blend".
Przy niezapisanym pliku rozwija się to do katalogu instalacyjnego,
a tam Windows nie pozwala pisać (PermissionError).
"""

import bpy, json, os

OUT_DIR    = r"C:\Users\mlena\Documents\my-new-portfolio\public\scene"
TIPS_COUNT = 900
LEAF_HINTS = ("petal", "blossom", "canopy", "leaf", "leaves", "flower",
              "foliage", "kwiat")

os.makedirs(OUT_DIR, exist_ok=True)
glb_path  = os.path.join(OUT_DIR, "tree.glb")
tips_path = os.path.join(OUT_DIR, "tips.json")


def is_leaf(ob):
    if any(h in ob.name.lower() for h in LEAF_HINTS):
        return True
    return any(s.material and any(h in s.material.name.lower() for h in LEAF_HINTS)
               for s in ob.material_slots)


meshes = [o for o in bpy.data.objects if o.type == 'MESH']
leaves = [o for o in meshes if is_leaf(o)]
tris = sum(max(len(p.vertices) - 2, 0) for o in meshes for p in o.data.polygons)
print("siatek: %d | listowie: %d | trójkątów: %d" % (len(meshes), len(leaves), tris))

# ── punkty świetlne z realnej korony ───────────────────────────────────
import random
random.seed(1)
pts = []
for ob in leaves:
    mw = ob.matrix_world
    pts.extend(mw @ v.co for v in ob.data.vertices)
random.shuffle(pts)
pts = pts[:TIPS_COUNT]

# Model stoi tam, gdzie go zostawił autor – centrujemy w poziomie i
# sadzamy podstawę na zero, bo orbita w three.js kręci się wokół osi Y.
xs = [p.x for p in pts]; ys = [p.y for p in pts]
cx = (min(xs) + max(xs)) / 2
cy = (min(ys) + max(ys)) / 2
zmin = min((ob.matrix_world @ v.co).z for ob in meshes for v in ob.data.vertices)

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
with open(tips_path, "w") as f:
    json.dump(data, f)

# ── eksport ────────────────────────────────────────────────────────────
for ob in bpy.data.objects:
    try:
        ob.select_set(ob.type == 'MESH')
    except (AttributeError, RuntimeError):
        pass

kwargs = dict(filepath=glb_path, export_format='GLB', use_selection=True,
              export_apply=True, export_yup=True)
try:
    bpy.ops.export_scene.gltf(
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6, **kwargs)
except TypeError:
    # starsze/nowsze buildy bywają bez Draco – lepiej wyeksportować bez niego
    print("Draco niedostępne, eksport bez kompresji siatki")
    bpy.ops.export_scene.gltf(**kwargs)

print("\ntree.glb : %.2f MB" % (os.path.getsize(glb_path) / 1e6))
print("tips.json: %d punktów, wysokość %.2f" % (len(pts), data["height"]))
print("zapisane w %s" % OUT_DIR)
