"""
Scala kolor płatka z osobną maską alfa w jeden obrazek RGBA.

Po co: glTF wymaga, żeby przezroczystość siedziała w kanale alfa TEJ SAMEJ
tekstury co kolor bazowy. Model trzyma je w dwóch plikach JPG, a JPEG w ogóle
nie ma kanału alfa — dlatego przy eksporcie płatki wychodzą jako pełne
prostokąty i korona wygląda jak plątanina patyków (eksporter ostrzegał:
"More than one shader node tex image used for a texture").

Odpal w TEJ SAMEJ sesji Blendera co prepare_model.py, PRZED export_now.py.
"""

import bpy
import numpy as np

COLOR_HINT = "sakura_petal"        # obrazek z kolorem
ALPHA_HINT = "alpha"               # obrazek z maską
MAT_HINT = "petal"                 # materiał do naprawy


def pick(with_alpha):
    """Obrazek pasujący do COLOR_HINT, z maską w nazwie albo bez."""
    for img in bpy.data.images:
        n = img.name.lower()
        if COLOR_HINT in n and (ALPHA_HINT in n) == with_alpha and img.size[0]:
            return img
    return None


col = pick(False)
alp = pick(True)
if not col or not alp:
    raise SystemExit("Nie znalazłem pary kolor/alfa. Obrazki w pliku: %s"
                     % [i.name for i in bpy.data.images])
print("kolor: %s %dx%d | alfa: %s %dx%d"
      % (col.name, col.size[0], col.size[1], alp.name, alp.size[0], alp.size[1]))

# Maska to dane, nie kolor. Przy sRGB Blender zlinearyzowałby ją przy
# odczycie i krawędzie płatków zrobiłyby się zbyt przezroczyste.
# Uwaga: zmiana przestrzeni przeładowuje bufor z pliku, więc rozmiar
# sprawdzamy DOPIERO po tym — inaczej maska wróciłaby do oryginalnego
# rozmiaru już po naszym skalowaniu.
if alp.colorspace_settings.name != 'Non-Color':
    alp.colorspace_settings.name = 'Non-Color'

W, H = col.size
if tuple(alp.size) != (W, H):
    alp.scale(W, H)
    print("przeskalowano maskę do %dx%d" % (W, H))

n = W * H
cp = np.empty(n * 4, dtype=np.float32)
ap = np.empty(n * 4, dtype=np.float32)
col.pixels.foreach_get(cp)
alp.pixels.foreach_get(ap)

if float(ap[0::4].max()) == 0.0:
    # Bufor wyszedł pusty (obrazek generowany, nie z pliku) — wracamy do
    # sRGB i czytamy jeszcze raz; lepiej trochę ciemniejsze krawędzie
    # niż całkiem niewidoczne płatki.
    alp.colorspace_settings.name = 'sRGB'
    alp.pixels.foreach_get(ap)
    print("maska pusta w Non-Color — czytam w sRGB")

out = bpy.data.images.new("sakura_petal_RGBA", W, H, alpha=True)
px = cp.copy()
px[3::4] = ap[0::4]                # jasność maski → alfa
out.pixels.foreach_set(px)
out.file_format = 'PNG'
out.pack()

cover = float((px[3::4] > 0.5).mean())
print("zrobiono %s (%dx%d, RGBA) — %.0f%% piksela nieprzezroczyste"
      % (out.name, W, H, cover * 100))
if cover > 0.95:
    print("UWAGA: maska prawie pełna — sprawdź, czy to na pewno obrazek alfa")

# ── wpięcie do materiału ───────────────────────────────────────────────
fixed = 0
for mat in bpy.data.materials:
    if MAT_HINT not in mat.name.lower() or not mat.use_nodes:
        continue
    nt = mat.node_tree
    bsdf = next((x for x in nt.nodes
                 if x.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    if not bsdf:
        continue

    # węzeł obrazka wpięty w Base Color
    tex = None
    for link in nt.links:
        if link.to_node is bsdf and link.to_socket.name == 'Base Color':
            if link.from_node.bl_idname == 'ShaderNodeTexImage':
                tex = link.from_node
            break
    if tex is None:
        tex = next((x for x in nt.nodes if x.bl_idname == 'ShaderNodeTexImage'
                    and x.image and COLOR_HINT in x.image.name.lower()
                    and ALPHA_HINT not in x.image.name.lower()), None)
    if tex is None:
        print("  %s: nie znalazłem węzła koloru" % mat.name)
        continue

    tex.image = out
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if 'Alpha' in bsdf.inputs:
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])

    # Alpha Clip zamiast Blend: bez sortowania per trójkąt przezroczysta
    # korona i tak renderuje się źle, a maska jest szybsza. W 4.2+ pola
    # bywają inne, stąd try.
    for attr, vals in (("blend_method", ('CLIP', 'BLEND')),
                       ("shadow_method", ('CLIP',))):
        if hasattr(mat, attr):
            for v in vals:
                try:
                    setattr(mat, attr, v)
                    break
                except TypeError:
                    continue
    for attr, val in (("alpha_threshold", 0.5), ("show_transparent_back", False)):
        if hasattr(mat, attr):
            setattr(mat, attr, val)

    fixed += 1
    print("  naprawiono materiał: %s" % mat.name)

print("\ngotowe, materiałów: %d — teraz odpal export_now.py" % fixed)
