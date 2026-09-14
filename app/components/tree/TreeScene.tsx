'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import s from './TreeScene.module.css';

/**
 * Drzewo w three.js, kamera na torze sterowanym scrollem.
 *
 * Tor jest w KEYS – jedna tabela, którą się stroi. Nie rozrzucaj tych liczb
 * po kodzie.
 *
 * Bez GSAP-a: pętla rAF i tak chodzi co klatkę, więc progress scrolla liczy
 * się z getBoundingClientRect. ScrollTrigger nic by tu nie dodał poza
 * kolejną zależnością.
 *
 * Model jest wymienny – scena nie wie nic o tym, skąd pochodzi tree.glb.
 * Podmienisz plik na lepszy model i nic tutaj nie trzeba ruszać, o ile pivot
 * siedzi u podstawy pnia, a drzewo rośnie w +Y.
 */

type Key = {
  at: number;      // progress scrolla 0..1
  angle: number;   // kąt orbity w radianach
  radius: number;  // odległość kamery od osi drzewa (× wysokość drzewa)
  height: number;  // wysokość kamery (× wysokość drzewa)
  look: number;    // punkt patrzenia (× wysokość drzewa)
  shiftX: number;  // przesunięcie drzewa w kadrze: 0 = środek, 1 = w prawo
};

const KEYS: Key[] = [
  { at: 0.0,  angle: 0,              radius: 2.6,  height: 0.60, look: 0.42, shiftX: 0 },
  { at: 0.30, angle: Math.PI,        radius: 1.55, height: 0.56, look: 0.44, shiftX: 0 },
  { at: 0.60, angle: Math.PI * 2,    radius: 1.40, height: 0.50, look: 0.42, shiftX: 0 },
  // dojazd i przekadrowanie: korona ucieka w prawo, lewa strona zostaje pusta
  { at: 1.0,  angle: Math.PI * 2.25, radius: 0.80, height: 0.82, look: 0.86, shiftX: 0.72 },
];

// Korona: kwiaty sadzone w kodzie na wierzchołkach gałęzi modelu.
const BLOSSOMS   = 42000;   // ile kart (2 trójkąty każda, jeden draw call)
const PETAL_SIZE = 0.028;   // bok karty × wysokość drzewa
const BLOSSOM_FROM = 0.34;  // od jakiej wysokości drzewa zaczyna się korona
// Kora: mnożnik na teksturze (1 = jak w modelu). Domyślna jest jasnoszara
// i przy różowej koronie wygląda wypłowiale.
const BARK_DARKEN = 0.42;
// Wiatr: amplituda kołysania × wysokość drzewa. 0 = korona stoi.
const WIND = 0.014;
// Światło jedzie z kamerą, nie stoi w scenie: przy pełnej orbicie stałe
// źródło raz oświetla przód, raz tył i drzewo w połowie drogi robi się
// płaskie. Te dwie liczby to odsunięcie na bok i w górę, w promieniach orbity.
const LIGHT_SIDE = 0.9;
const LIGHT_UP = 0.55;
// Kontrast korony: ile zostaje w cieniu i ile dokłada strona oświetlona.
const SHADE_MIN = 0.3;
const SHADE_GAIN = 1.15;
// Podłoże: miękka poświata pod koroną i opadłe płatki. Bez tego drzewo
// wisi w próżni — pień kończy się w połowie kadru i nie ma się o co oprzeć.
const GROUND_PETALS = 1200;
const FLOAT_PETALS = 700;   // płatki dryfujące po wodzie
const FLOAT_DRIFT = 0.012;  // zasięg dryfu × wysokość drzewa
// Gwiazdy: kopuła daleko za drzewem, poniżej horyzontu chowa je woda.
const STARS = 900;
const STAR_SIZE = 1.5;      // mnożnik wielkości
const STAR_TWINKLE = 2.6;   // tempo migotania
// Świecące motyle: krążą wokół korony, wchodzą w trakcie scrolla.
const BUTTERFLIES = 14;
const BUTTERFLY_FROM = 0.03;   // progress, od którego się pojawiają
const BUTTERFLY_SIZE = 0.085;  // rozpiętość × wysokość drzewa
const MOUND_H = 0.17;       // wysokość pagórka × wysokość drzewa
const MOUND_R = 0.44;       // promień pagórka × rozmiar drzewa
// Szczyt fizycznie ten sam co przy promieniu 0.30 (0.38 × 0.30 = 0.26 × 0.44);
// zmienia się tylko długość zbocza — łagodnie wchodzi w wodę.
const MOUND_TOP = 0.26;     // jaka część promienia jest płaskim szczytem
const MOUND_STRETCH = 1.0;  // rozciągnięcie wyspy wzdłuż X, 1 = koło
// Woda: poziom liczony od szczytu pagórka, więc zmiana MOUND_H nie zatapia
// wyspy. Rozdzielczość odbicia to osobny render sceny co klatkę — 512 px
// wystarcza, bo i tak rozmywają je zmarszczki.
const WATER_LEVEL = 0.30;   // ile pagórka zostaje nad wodą liczone od dołu
const WATER_RES = 512;
// Góry: walec z teksturą dookoła sceny, u podstawy schowany za wodą.
const MOUNTAIN_H = 1.9;     // wysokość × wysokość drzewa
const MOUNTAIN_REPEAT = 10; // ile lustrzanych powtórzeń dookoła
const MOUND_BUMP = 0.34;    // ile nierówności (0 = gładka kopuła)

// Tytuł wyłaniający się z wody na starcie; znika przy pierwszym scrollu.
const TITLE_OUT = 0.10;        // progress, przy którym tytuł jest już schowany

const COPY_FROM = 0.72;   // od którego progressu wchodzi tekst
const COPY_SPAN = 0.18;

function sampleKeys(p: number) {
  let a = KEYS[0];
  let b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (p >= KEYS[i].at && p <= KEYS[i + 1].at) {
      a = KEYS[i];
      b = KEYS[i + 1];
      break;
    }
  }
  const span = b.at - a.at || 1;
  const t = Math.min(Math.max((p - a.at) / span, 0), 1);
  // smoothstep – liniowa interpolacja widocznie szarpie na granicach kluczy
  const e = t * t * (3 - 2 * t);
  const mix = (x: number, y: number) => x + (y - x) * e;
  return {
    angle: mix(a.angle, b.angle),
    radius: mix(a.radius, b.radius),
    height: mix(a.height, b.height),
    look: mix(a.look, b.look),
    shiftX: mix(a.shiftX, b.shiftX),
  };
}

/** Miękka kropka jako tekstura – to ona robi „świecenie", nie bloom. */
function glowTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(170,225,255,0.85)');
  g.addColorStop(0.55, 'rgba(60,150,255,0.28)');
  g.addColorStop(1.0, 'rgba(0,80,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


/** Czteroramienna gwiazdka: jasny rdzeń i dwa cienkie, długie promienie. */
function starTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  const core = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.18);
  core.addColorStop(0.0, 'rgba(255,255,255,1)');
  core.addColorStop(0.35, 'rgba(200,215,255,0.8)');
  core.addColorStop(1.0, 'rgba(120,150,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, S, S);
  // promienie: wąskie w środku, gasnące ku końcom
  for (const rot of [0, Math.PI / 2]) {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(-S / 2, 0, S / 2, 0);
    g.addColorStop(0.0, 'rgba(160,190,255,0)');
    g.addColorStop(0.5, 'rgba(240,245,255,0.95)');
    g.addColorStop(1.0, 'rgba(160,190,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-S / 2, 0);
    ctx.quadraticCurveTo(0, -S * 0.045, S / 2, 0);
    ctx.quadraticCurveTo(0, S * 0.045, -S / 2, 0);
    ctx.fill();
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


/** Motyl z dwóch par skrzydeł, miękkie krawędzie – pod additive świeci sam. */
function butterflyTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  const wing = (cx: number, cy: number, rx: number, ry: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.22)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const side of [-1, 1]) {
    wing(S / 2 + side * 30, 50, 27, 23);   // przednie
    wing(S / 2 + side * 21, 84, 18, 17);   // tylne
  }
  const body = ctx.createLinearGradient(0, 28, 0, 104);
  body.addColorStop(0, 'rgba(255,255,255,0)');
  body.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  body.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = body;
  ctx.fillRect(S / 2 - 2, 28, 4, 76);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


export default function TreeScene() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const copyRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    const sectionEl = sectionRef.current;
    const copyEl = copyRef.current;
    const titleEl = titleRef.current;
    if (!el || !sectionEl) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 200);

    // Ambient trzymany nisko: przy 2.2 kierunek światła ginął i obrót
    // wyglądał płasko niezależnie od pozycji lamp.
    scene.add(new THREE.AmbientLight(0x93b4e6, 1.1));
    // Pozycje ustawia pętla — obie lampy wiszą na kamerze.
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff9a55, 0.8);
    scene.add(rim);
    const UP = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();

    const root = new THREE.Group();
    scene.add(root);

    let treeHeight = 10;
    let fitSize = 10;   // większy z wymiarów: szerokość vs wysokość
    let points: THREE.Points | null = null;
    let waterMat: THREE.ShaderMaterial | null = null;
    let water: Reflector | null = null;
    let disposed = false;
    let raf = 0;
    let smooth = 0;

    const tex = glowTexture();
    const starTex = starTexture();
    const flyTex = butterflyTexture();
    const uFly = { value: 0 };   // widoczność motyli, sterowana scrollem
    // Jeden uniform czasu dla kwiatów i świateł — inaczej rozjeżdżają się
    // fazy i światełka zostają w miejscu, z którego płatek już odjechał.
    const uTime = { value: 0 };
    // Kierunek klucza w świecie – kwiaty cieniują się po nim same.
    const uLight = { value: new THREE.Vector3(-1, 0.4, 0).normalize() };

    // Model jest skompresowany Draco – bez tego dekodera GLTFLoader rzuca
    // "no DRACOLoader instance provided" i scena zostaje pusta. Dekoder
    // (252 kB) leży w public/draco i ładuje się dopiero przy wczytywaniu.
    const gltfLoader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    gltfLoader.setDRACOLoader(draco);

    Promise.all([
      gltfLoader.loadAsync('/scene/tree.glb'),
      fetch('/scene/tips.json').then((r) => r.json()),
    ])
      .then(([gltf, data]: [{ scene: THREE.Group }, { tips: number[][]; height: number }]) => {
        if (disposed) return;

        gltf.scene.traverse((o: THREE.Object3D) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mm of mats) {
            const std = mm as THREE.MeshStandardMaterial;
            if (!std) continue;
            // Płatki przychodzą z Blendera jako alpha BLEND. Przezroczystość
            // w koronie wymaga sortowania per trójkąt, którego nie ma – płatki
            // znikają za sobą. alphaTest daje ostrą maskę i zero sortowania.
            //
            // Decyduje WYŁĄCZNIE tryb alfy z glTF, nie obecność tekstury.
            // Tekstura pnia to łatka na szew: 91% jej pikseli ma alfę 0,
            // więc alphaTest na materiale OPAQUE wycinał cały pień.
            if (std.transparent || std.alphaTest > 0) {
              std.transparent = false;
              std.alphaTest = 0.5;
            } else {
              std.alphaTest = 0;
            }
            std.side = THREE.DoubleSide;   // płatki to płaskie karty
            std.envMapIntensity = 0.4;
            if (/trunk|bark|branch/i.test(std.name)) {
              std.color.multiplyScalar(BARK_DARKEN);
            }
          }
        });
        // Awaryjnie: gdyby pień znów przyszedł z łatką na szew zamiast kory
        // (91% pikseli tej tekstury jest przezroczystych, pod spodem czerń),
        // pożyczamy mu teksturę z gałęzi.
        {
          let bark: THREE.Texture | null = null;
          gltf.scene.traverse((o: THREE.Object3D) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const std = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
            if (/bark|branch/i.test(std.name) && std.map) bark = std.map;
          });
          if (bark) {
            gltf.scene.traverse((o: THREE.Object3D) => {
              const m = o as THREE.Mesh;
              if (!m.isMesh) return;
              const std = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
              if (/trunk/i.test(std.name) && /seam/i.test(std.map?.name || '')) {
                std.map = bark;
                std.needsUpdate = true;
              }
            });
          }
        }
        root.add(gltf.scene);
        treeHeight = data.height || 10;
        {
          const bb = new THREE.Box3().setFromObject(gltf.scene);
          const sz = bb.getSize(new THREE.Vector3());
          fitSize = Math.max(sz.y, Math.max(sz.x, sz.z) * 0.85);
        }

        // ── kwiaty ─────────────────────────────────────────────────────
        // Korona z modelu to była ślepa uliczka: płatek ma tam ~3 cm przy
        // drzewie 7 m (dwa piksele w kadrze), więc żeby cokolwiek było
        // widać, trzeba ich milion — i tyle samo trójkątów w glb.
        // Zamiast tego sadzimy własne karty na wierzchołkach gałęzi:
        // jeden InstancedMesh, jeden draw call, gęstość i kolor do
        // wyklikania w stałych poniżej.
        {
          let petalMap: THREE.Texture | null = null;
          const spots: number[] = [];
          const hide: THREE.Mesh[] = [];

          gltf.scene.updateWorldMatrix(true, true);
          gltf.scene.traverse((o: THREE.Object3D) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const std = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
            if (/petal|canopy|blossom/i.test(std.name + m.name)) {
              if (std.map) petalMap = std.map;
              hide.push(m);                    // oryginalne płatki zastępujemy
              return;
            }
            if (/trunk/i.test(m.name)) return; // na pniu kwiaty nie rosną
            const pos = m.geometry.attributes.position;
            const v = new THREE.Vector3();
            for (let i = 0; i < pos.count; i++) {
              v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
              if (v.y > treeHeight * BLOSSOM_FROM) spots.push(v.x, v.y, v.z);
            }
          });
          // Gałęzie z pierwszej decymacji to iglice o proporcji 1:1400 —
          // sterczą poza koronę jak drzazgi. Mierzymy wydłużenie trójkątów
          // i chowamy siatki, które się rozjechały; na czystym modelu ta
          // reguła nigdy nie zadziała.
          gltf.scene.traverse((o: THREE.Object3D) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh || hide.includes(m) || /trunk/i.test(m.name)) return;
            const pos = m.geometry.attributes.position;
            const idx = m.geometry.index;
            const tris = idx ? idx.count / 3 : pos.count / 3;
            const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
            const ratios: number[] = [];
            const step = Math.max(1, Math.floor(tris / 200));
            for (let t = 0; t < tris; t += step) {
              const g = (i: number) => (idx ? idx.getX(t * 3 + i) : t * 3 + i);
              a.fromBufferAttribute(pos, g(0));
              b.fromBufferAttribute(pos, g(1));
              c.fromBufferAttribute(pos, g(2));
              const e = [a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)].sort((x, y) => x - y);
              ratios.push(e[2] / Math.max(e[0], 1e-6));
            }
            ratios.sort((x, y) => x - y);
            if (ratios.length && ratios[ratios.length >> 1] > 40) m.visible = false;
          });

          for (const m of hide) m.visible = false;

          const n = spots.length / 3;
          if (n > 0) {
            const geo = new THREE.PlaneGeometry(1, 1);
            const mat = new THREE.MeshStandardMaterial({
              map: petalMap,
              color: 0xd8cff0,   // odbicie jasne – warstwa tafli i tak je tłumi
              roughness: 0.85,
              metalness: 0,
              // Tekstura płatka jest blada (średnio 176,144,144), a światło
              // w scenie zimne — bez podbicia korona wychodzi szarobura.
              emissive: new THREE.Color(0xff6fae),
              emissiveIntensity: 0.18,
              side: THREE.DoubleSide,
              alphaTest: 0.5,               // maska zamiast blendu: bez sortowania
              transparent: false,
            });
            // Kołysanie liczone w shaderze: 42 tys. macierzy przeliczanych
            // co klatkę na CPU zjadłoby więcej niż cała reszta sceny.
            mat.onBeforeCompile = (shader) => {
              shader.uniforms.uTime = uTime;
              shader.uniforms.uLight = uLight;
              shader.uniforms.uWind = { value: treeHeight * WIND };
              shader.uniforms.uH = { value: treeHeight };
              shader.vertexShader =
                'uniform float uTime;\nuniform float uWind;\nuniform float uH;\n' +
                'uniform vec3 uLight;\nvarying float vShade;\n' +
                `#define SHADE_MIN ${SHADE_MIN.toFixed(2)}\n#define SHADE_GAIN ${SHADE_GAIN.toFixed(2)}\n` +
                shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
                #ifdef USE_INSTANCING
                  vec3 iPos = instanceMatrix[3].xyz;
                  // offset wraca potem przez instanceMatrix, więc dzielimy
                  // przez skalę instancji – inaczej małe karty ledwo drgną
                  float iScale = max(length(instanceMatrix[0].xyz), 1e-4);
                  float ph = iPos.x * 0.7 + iPos.z * 0.9 + iPos.y * 0.3;
                  float g = smoothstep(0.15, 1.0, iPos.y / uH);
                  float sx = sin(uTime * 1.1 + ph) + 0.4 * sin(uTime * 2.3 + ph * 1.7);
                  float sz = cos(uTime * 0.9 + ph * 1.3);
                  transformed += vec3(sx, sx * 0.25, sz * 0.7) * (uWind * g / iScale);
                  // Karty mają losowy obrót, więc ich własne normalne dają
                  // szum zamiast cieniowania. Bierzemy kierunek od osi drzewa
                  // na zewnątrz – korona cieniuje się wtedy jak kula i przy
                  // obrocie widać, z której strony pada światło.
                  vec3 outward = normalize(vec3(iPos.x, (iPos.y - uH * 0.62) * 0.8, iPos.z));
                  vShade = SHADE_MIN + SHADE_GAIN * max(dot(outward, uLight), 0.0);
                #else
                  vShade = 1.0;
                #endif`);
              shader.fragmentShader = 'varying float vShade;\n' +
                shader.fragmentShader.replace('#include <map_fragment>',
                  '#include <map_fragment>\n  diffuseColor.rgb *= vShade;');
            };

            const inst = new THREE.InstancedMesh(geo, mat, BLOSSOMS);
            const dummy = new THREE.Object3D();
            const tint = new THREE.Color();
            const base = new THREE.Vector3();
            const size = treeHeight * PETAL_SIZE;
            for (let i = 0; i < BLOSSOMS; i++) {
              const k = ((Math.random() * n) | 0) * 3;
              base.set(spots[k], spots[k + 1], spots[k + 2]);
              // rozrzut wokół gałązki, żeby kwiaty nie leżały na siatce
              dummy.position.set(
                base.x + (Math.random() - 0.5) * size * 2.2,
                base.y + (Math.random() - 0.5) * size * 1.6,
                base.z + (Math.random() - 0.5) * size * 2.2
              );
              dummy.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
              );
              const sc = size * (0.65 + Math.random() * 0.8);
              dummy.scale.set(sc, sc, sc);
              dummy.updateMatrix();
              inst.setMatrixAt(i, dummy.matrix);
              // odrobina wariacji, inaczej korona wygląda jak jednolita plama
              tint.setHSL(0.91 + Math.random() * 0.05, 0.62, 0.56 + Math.random() * 0.22);
              inst.setColorAt(i, tint);
            }
            inst.instanceMatrix.needsUpdate = true;
            if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
            inst.frustumCulled = false;      // bbox instancji i tak obejmuje całą koronę
            root.add(inst);

            // ── pagórek ────────────────────────────────────────────────
            // Drzewo stojące na płaskim zerze wygląda jak wklejone. Kopuła
            // z siatki 120×120, wysokość liczona funkcją, a nie z tekstury —
            // ta sama funkcja sadza potem opadłe płatki na zboczu.
            const mR = fitSize * MOUND_R;
            const mH = treeHeight * MOUND_H;
            // Promień „eliptyczny": wyspa jest wydłużona wzdłuż X, więc
            // odległość liczymy po ściśniętej osi. Ta sama miara idzie do
            // wysokości, koloru i rozrzutu płatków.
            const moundT = (x: number, z: number) =>
              Math.min(Math.hypot(x / MOUND_STRETCH, z) / mR, 1);
            const moundAt = (x: number, z: number) => {
              const t = moundT(x, z);
              // Płaski szczyt: kopuła zaczyna opadać dopiero za MOUND_TOP,
              // żeby drzewo stało na półce, a nie na czubku
              const ts = Math.max(t - MOUND_TOP, 0) / (1 - MOUND_TOP);
              const dome = 0.5 * Math.cos(ts * Math.PI) + 0.5;
              const bump = Math.sin(x * 1.7 + z * 0.9) * Math.cos(z * 1.3 - x * 0.6);
              return mH * (dome + bump * MOUND_BUMP * dome);
            };

            // Krążek, nie kwadrat: przy kwadratowej siatce widać proste
            // krawędzie podłoża, choćby kolor gasł do tła. RingGeometry
            // z wewnętrznym promieniem 0 daje podziały wzdłuż promienia,
            // których CircleGeometry nie ma (tam środek to jeden wierzchołek).
            const mGeo = new THREE.RingGeometry(0, mR * 1.35 * MOUND_STRETCH, 128, 48);
            mGeo.rotateX(-Math.PI / 2);
            const mp = mGeo.attributes.position;
            const mc = new Float32Array(mp.count * 3);
            const cTop = new THREE.Color(0x8d4a84);   // grzbiet, blisko pnia
            const cLow = new THREE.Color(0x24162c);   // zbocze
            const tmp = new THREE.Color();
            for (let i = 0; i < mp.count; i++) {
              const x = mp.getX(i), z = mp.getZ(i);
              const t = moundT(x, z);
              mp.setY(i, moundAt(x, z));
              tmp.copy(cLow).lerp(cTop, Math.pow(1 - t, 2.2));
              // Wygaszanie rozciągnięte na całe zbocze, nie tylko na rant.
              // Pagórek oglądamy pod ostrym kątem, więc ostatnie procenty
              // promienia to na ekranie kilka pikseli i krótka rampa czyta
              // się jako narysowana elipsa.
              // Odkąd jest woda, rant i tak jest pod powierzchnią — wygaszanie
              // może być łagodne, inaczej całe zbocze robi się czarną bryłą.
              const f = Math.min(Math.max((1.0 - t) / 0.5, 0), 1);
              tmp.multiplyScalar(f * f * (3 - 2 * f));
              mc[i * 3] = tmp.r; mc[i * 3 + 1] = tmp.g; mc[i * 3 + 2] = tmp.b;
            }
            mGeo.setAttribute('color', new THREE.BufferAttribute(mc, 3));
            mGeo.computeVertexNormals();
            // Lambert, nie Standard: PBR dokłada 4% odbicia lustrzanego
            // niezależnie od albedo, więc przy mocnym kluczu całe zbocze
            // dostawało stałe szare dno ~24/255 i wygaszanie do czerni nic
            // nie dawało. Lambert liczy samo rozproszenie.
            const mound = new THREE.Mesh(mGeo, new THREE.MeshLambertMaterial({
              vertexColors: true,
            }));
            mound.position.y = -mH * 0.45;   // pień wchodzi w zbocze, nie stoi na nim
            root.add(mound);

            // ── woda ───────────────────────────────────────────────────
            // Reflector renderuje scenę drugi raz z kamery odbitej względem
            // tafli. Dlatego trzyma się małej rozdzielczości i dlatego woda
            // powstaje po drzewie — musi mieć co odbijać.
            const waterY = mound.position.y + mH * WATER_LEVEL;
            const waterR = fitSize * 14;   // horyzont daleko, żeby nie rysował kreski
            water = new Reflector(new THREE.PlaneGeometry(waterR, waterR), {
              textureWidth: WATER_RES,
              textureHeight: WATER_RES,
              color: 0xd8cff0,   // odbicie jasne – warstwa tafli i tak je tłumi
            });
            water.rotation.x = -Math.PI / 2;
            water.position.y = waterY;
            root.add(water);

            // ── góry ───────────────────────────────────────────────────
            // Walec dookoła sceny, oglądany od środka. Tekstura powtarzana
            // lustrzanie — zwykłe powtórzenie zostawia szew tam, gdzie lewa
            // i prawa krawędź obrazka się nie zgadzają. Stoi tuż przed
            // krawędzią wody, gdzie tafla i tak gaśnie do tła, a podstawa
            // ma w teksturze wpisaną mgłę w kolorze wody.
            {
              const mR2 = waterR * 0.5 * 0.96;
              const mTex = new THREE.TextureLoader().load('/scene/mountains.webp');
              mTex.colorSpace = THREE.SRGBColorSpace;
              mTex.wrapS = THREE.MirroredRepeatWrapping;
              mTex.repeat.x = MOUNTAIN_REPEAT;
              const mH2 = treeHeight * MOUNTAIN_H;
              const mountains = new THREE.Mesh(
                new THREE.CylinderGeometry(mR2, mR2, mH2, 96, 1, true),
                new THREE.MeshBasicMaterial({
                  map: mTex,
                  color: 0xcdbde0,   // lekko przygaszone, żeby nie konkurowały z koroną
                  transparent: true,
                  side: THREE.BackSide,
                  depthWrite: false,
                  fog: false,
                })
              );
              mountains.position.y = waterY + mH2 * 0.5 - mH2 * 0.3;   // podstawa głęboko pod wodą
              mountains.renderOrder = -1;   // po gwiazdach, przed wodą
              root.add(mountains);
              // do odbicia nie wchodzą – z daleka i tak byłyby smugą,
              // a Reflector nie lubi przezroczystych walców wokół siebie
              if (water) {
                const pass = water.onBeforeRender;
                water.onBeforeRender = (...args) => {
                  mountains.visible = false;
                  pass.apply(water, args);
                  mountains.visible = true;
                };
              }
            }

            // Tafla: sam Reflector daje czerń wszędzie tam, gdzie odbija
            // puste niebo, więc wody nie było widać. Ta warstwa nad nim
            // maluje ton wody (głębia blisko, mgiełka przy horyzoncie),
            // różową poświatę pod drzewem i zmarszczki; odbicie prześwituje
            // przez nią, a przy krawędzi płaszczyzny kolor zlewa się z tłem.
            const surface = new THREE.Mesh(
              new THREE.PlaneGeometry(waterR, waterR),
              new THREE.ShaderMaterial({
                uniforms: {
                  uTime,
                  uCol: { value: new THREE.Color(0xff8fd0) },
                  uDeep: { value: new THREE.Color(0x1a1030) },
                  uHaze: { value: new THREE.Color(0x3a2658) },
                  uBg: { value: new THREE.Color(0x05030a) },
                  uFar: { value: waterR * 0.5 },
                  uFwd: { value: new THREE.Vector2(0, -1) },
                },
                vertexShader: `
                  varying vec2 vW;
                  void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vW = wp.xz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                  }`,
                fragmentShader: `
                  uniform float uTime;
                  uniform vec3 uCol, uDeep, uHaze, uBg;
                  uniform float uFar;
                  uniform vec2 uFwd;
                  varying vec2 vW;
                  void main() {
                    float d = length(vW);
                    // Pasy w układzie kamery: py rośnie w głąb kadru, px
                    // w bok. Pasy przybite do osi świata przy obrocie raz
                    // leżały w poprzek, raz wzdłuż ekranu.
                    float py = dot(vW, uFwd);
                    float px = dot(vW, vec2(-uFwd.y, uFwd.x));
                    float far = smoothstep(0.0, uFar * 0.7, d);
                    vec3 tone = mix(uDeep, uHaze, far);
                    // poświata drzewa na wodzie
                    float pool = exp(-d * 0.28);
                    // Wersja izotropowa (sześć fal co 60°) przestała
                    // wyglądać jak fale — zostają poziome pasy.
                    float b = sin(py * 3.1 + uTime * 0.7)
                            + 0.7 * sin(py * 6.7 - uTime * 1.1 + px * 0.9)
                            + 0.5 * sin(px * 0.9 + py * 1.4 + uTime * 0.5)
                            + 0.4 * sin(py * 9.1 + px * 1.3 + uTime * 0.9);
                    float streak = pow(max(b * 0.3 + 0.5, 0.0), 3.0);
                    vec3 col = tone
                             + uCol * pool * (0.14 + 0.30 * streak)
                             + uHaze * streak * 0.9 * (1.0 - far * 0.6);
                    // blisko odbicie prześwituje, daleko warstwa kryje w całości
                    float alpha = mix(0.6, 1.0, far);
                    // Brzeg płaszczyzny: odkąd horyzont zasłaniają góry,
                    // gaśnie tylko ostatni skrawek. Wcześniejszy szeroki
                    // spadek do czerni rysował ciemny pas pod górami.
                    float edge = 1.0 - smoothstep(uFar * 0.97, uFar, d);
                    gl_FragColor = vec4(mix(uBg, col, edge), mix(1.0, alpha, edge));
                  }`,
                transparent: true,
                depthWrite: false,
              })
            );
            surface.rotation.x = -Math.PI / 2;
            surface.position.y = waterY + 0.01;
            surface.renderOrder = 1;
            root.add(surface);
            waterMat = surface.material as THREE.ShaderMaterial;

            // Opadłe płatki: te same karty, tylko płasko i z losowym obrotem
            // wokół pionu. Gęściej pod koroną niż przy krawędzi — stąd
            // wykładnik >1 zamiast równomiernego rozrzutu po kole.
            const fallen = new THREE.InstancedMesh(geo, mat, GROUND_PETALS);
            for (let i = 0; i < GROUND_PETALS; i++) {
              const a = Math.random() * Math.PI * 2;
              const d = Math.pow(Math.random(), 1.35) * mR * 1.25;
              const x = Math.cos(a) * d * MOUND_STRETCH, z = Math.sin(a) * d;
              dummy.position.set(x, moundAt(x, z) - mH * 0.45 + 0.02, z);
              dummy.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.5,
                                 Math.random() * Math.PI * 2, 0);
              const sc = size * (0.7 + Math.random() * 0.7);
              dummy.scale.set(sc, sc, sc);
              dummy.updateMatrix();
              fallen.setMatrixAt(i, dummy.matrix);
              tint.setHSL(0.91 + Math.random() * 0.05, 0.5, 0.34 + Math.random() * 0.16);
              fallen.setColorAt(i, tint);
            }
            fallen.instanceMatrix.needsUpdate = true;
            if (fallen.instanceColor) fallen.instanceColor.needsUpdate = true;
            root.add(fallen);

            // ── płatki na wodzie ────────────────────────────────────────
            // Osobny materiał, bo wiatr z korony gaśnie przy ziemi
            // (smoothstep po wysokości) — te mają własny, powolny dryf
            // po tafli. Przesunięcie dokładane PO instanceMatrix, w
            // przestrzeni świata: karty leżą płasko, więc ich lokalne osie
            // nie pokrywają się ze światem.
            const floatMat = new THREE.MeshStandardMaterial({
              map: petalMap,
              roughness: 0.6,
              metalness: 0,
              side: THREE.DoubleSide,
              alphaTest: 0.5,
              transparent: false,
              emissive: new THREE.Color(0xff6fae),
              emissiveIntensity: 0.08,
            });
            floatMat.onBeforeCompile = (shader) => {
              shader.uniforms.uTime = uTime;
              shader.uniforms.uDrift = { value: treeHeight * FLOAT_DRIFT };
              shader.vertexShader =
                'uniform float uTime;\nuniform float uDrift;\n' +
                shader.vertexShader.replace('#include <project_vertex>', `
                  vec4 mvPosition = vec4(transformed, 1.0);
                  #ifdef USE_INSTANCING
                    mvPosition = instanceMatrix * mvPosition;
                    vec3 iPos = instanceMatrix[3].xyz;
                    float ph = iPos.x * 0.5 + iPos.z * 0.7;
                    mvPosition.xyz += vec3(
                      sin(uTime * 0.35 + ph),
                      0.12 * sin(uTime * 1.3 + ph * 2.0),
                      cos(uTime * 0.28 + ph * 1.3)) * uDrift;
                  #endif
                  mvPosition = modelViewMatrix * mvPosition;
                  gl_Position = projectionMatrix * mvPosition;`);
            };
            const floating = new THREE.InstancedMesh(geo, floatMat, FLOAT_PETALS);
            const shore = mR * 0.95;
            for (let i = 0; i < FLOAT_PETALS; i++) {
              const a = Math.random() * Math.PI * 2;
              // od brzegu wyspy w głąb wody, gęściej blisko brzegu
              const d = shore + Math.pow(Math.random(), 1.6) * fitSize * 1.3;
              dummy.position.set(Math.cos(a) * d, waterY + 0.015, Math.sin(a) * d);
              dummy.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.12,
                                 Math.random() * Math.PI * 2, 0);
              const sc = size * (0.6 + Math.random() * 0.6);
              dummy.scale.set(sc, sc, sc);
              dummy.updateMatrix();
              floating.setMatrixAt(i, dummy.matrix);
              tint.setHSL(0.91 + Math.random() * 0.05, 0.45, 0.38 + Math.random() * 0.18);
              floating.setColorAt(i, tint);
            }
            floating.instanceMatrix.needsUpdate = true;
            if (floating.instanceColor) floating.instanceColor.needsUpdate = true;
            floating.frustumCulled = false;
            root.add(floating);
          }
        }

        // Światełka: jeden obiekt Points zamiast setek siatek. Additive
        // blending daje poświatę bez pełnoekranowego bloomu, który kosztuje
        // osobny pass renderowany na całym ekranie co klatkę.
        const pos: number[] = [];
        const size: number[] = [];
        for (const [x, y, z] of data.tips) {
          for (let i = 0; i < 2; i++) {
            pos.push(
              x + (Math.random() - 0.5) * 0.35,
              y + (Math.random() - 0.5) * 0.35,
              z + (Math.random() - 0.5) * 0.35
            );
            size.push(0.18 + Math.random() * 0.5);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));

        const mat = new THREE.ShaderMaterial({
          uniforms: {
            uTex: { value: tex },
            uTime,
            uWind: { value: 0 },
            uH: { value: 1 },
          },
          vertexShader: `
            attribute float aSize;
            uniform float uTime;
            uniform float uWind;
            uniform float uH;
            varying float vTwinkle;
            void main() {
              // ta sama funkcja wiatru co w kwiatach, żeby światła jechały
              // razem z płatkami
              float ph = position.x * 0.7 + position.z * 0.9 + position.y * 0.3;
              float g = smoothstep(0.15, 1.0, position.y / uH);
              float sx = sin(uTime * 1.1 + ph) + 0.4 * sin(uTime * 2.3 + ph * 1.7);
              float sz = cos(uTime * 0.9 + ph * 1.3);
              vec3 p = position + vec3(sx, sx * 0.25, sz * 0.7) * (uWind * g);
              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              // każdy punkt pulsuje z własną fazą wziętą z pozycji
              vTwinkle = 0.65 + 0.35 * sin(uTime * 1.6 + position.x * 3.1 + position.y * 2.3);
              gl_PointSize = aSize * 300.0 / -mv.z;
              gl_Position = projectionMatrix * mv;
            }`,
          fragmentShader: `
            uniform sampler2D uTex;
            varying float vTwinkle;
            void main() {
              vec4 t = texture2D(uTex, gl_PointCoord);
              gl_FragColor = vec4(t.rgb, t.a * vTwinkle);
            }`,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
        });
        mat.uniforms.uWind.value = treeHeight * WIND;
        mat.uniforms.uH.value = treeHeight;
        points = new THREE.Points(geo, mat);
        points.renderOrder = 2;
        root.add(points);

        // ── gwiazdy ────────────────────────────────────────────────────
        // Górna półkula daleko za sceną. Poniżej horyzontu zasłania je
        // tafla (przy horyzoncie kryje w całości), więc nie trzeba ich
        // wycinać osobno. Migotanie i rozmiar per gwiazda w shaderze.
        {
          const R = fitSize * 11;
          const sp: number[] = [];
          const ss: number[] = [];
          const sph: number[] = [];
          for (let i = 0; i < STARS; i++) {
            const u = Math.random();
            const v = Math.random();
            const theta = u * Math.PI * 2;
            // cos(phi) równomiernie -> równomiernie po sferze; tylko góra
            const y = 0.06 + v * 0.94;
            const r = Math.sqrt(1 - y * y);
            sp.push(Math.cos(theta) * r * R, y * R, Math.sin(theta) * r * R);
            // większość drobna, kilka wyraźnych
            const big = Math.random() < 0.08;
            ss.push((big ? 2.2 + Math.random() * 2.0 : 0.5 + Math.random() * 1.1) * (R / 26) * STAR_SIZE);
            sph.push(Math.random() * Math.PI * 2);
          }
          const sg = new THREE.BufferGeometry();
          sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
          sg.setAttribute('aSize', new THREE.Float32BufferAttribute(ss, 1));
          sg.setAttribute('aPhase', new THREE.Float32BufferAttribute(sph, 1));
          const sm = new THREE.ShaderMaterial({
            uniforms: { uTex: { value: starTex }, uTime, uTw: { value: STAR_TWINKLE } },
            vertexShader: `
              attribute float aSize;
              attribute float aPhase;
              uniform float uTime;
              uniform float uTw;
              varying float vTw;
              void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                // dwie częstotliwości: wolne falowanie plus szybki błysk,
                // żeby nie pulsowały jak na jednym metronomie
                float t = uTime * uTw;
                vTw = 0.45
                    + 0.35 * sin(t * (0.6 + fract(aPhase) * 0.9) + aPhase * 7.0)
                    + 0.20 * sin(t * (1.7 + fract(aPhase * 3.1) * 1.4) + aPhase * 3.0);
                gl_PointSize = aSize * 300.0 / -mv.z;
                gl_Position = projectionMatrix * mv;
              }`,
            fragmentShader: `
              uniform sampler2D uTex;
              varying float vTw;
              void main() {
                vec4 t = texture2D(uTex, gl_PointCoord);
                gl_FragColor = vec4(t.rgb, t.a * vTw);
              }`,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          });
          const stars = new THREE.Points(sg, sm);
          stars.renderOrder = -2;
          stars.frustumCulled = false;
          root.add(stars);

          // Gwiazdy nie wchodzą do odbicia: lustrzana kamera patrzy spod
          // tafli w górę i łapie te przy horyzoncie, których z góry nie
          // widać — woda była gęściej usiana gwiazdami niż niebo.
          if (water) {
            const pass = water.onBeforeRender;
            water.onBeforeRender = (...args) => {
              stars.visible = false;
              pass.apply(water, args);
              stars.visible = true;
            };
          }
        }

        // ── motyle ─────────────────────────────────────────────────────
        // Cała trasa liczona w shaderze z czasu i paru liczb per motyl:
        // okrąg wokół korony (promień, prędkość, faza) plus falowanie
        // w pionie. Kierunek lotu to pochodna trasy, skrzydła składają się
        // wokół osi ciała. Zero pracy na CPU, jeden draw call.
        {
          const base = new THREE.PlaneGeometry(1, 1, 2, 1);
          const fg = new THREE.InstancedBufferGeometry();
          fg.index = base.index;
          fg.attributes.position = base.attributes.position;
          fg.attributes.uv = base.attributes.uv;
          fg.instanceCount = BUTTERFLIES;
          const aA: number[] = [], aB: number[] = [], aC: number[] = [];
          const aS: number[] = [], aCol: number[] = [];
          const col = new THREE.Color();
          for (let i = 0; i < BUTTERFLIES; i++) {
            const dir = Math.random() < 0.5 ? -1 : 1;
            aA.push(
              dir * (0.12 + Math.random() * 0.2),        // prędkość kątowa
              Math.random() * Math.PI * 2,               // faza
              fitSize * (0.5 + Math.random() * 0.3),     // promień okrążania: na zewnątrz korony
              treeHeight * (0.05 + Math.random() * 0.08) // amplituda pionowa
            );
            aB.push(
              0.5 + Math.random() * 0.9,                 // tempo falowania
              Math.random() * Math.PI * 2,
              9 + Math.random() * 5,                     // tempo machania
              Math.random() * Math.PI * 2
            );
            aC.push(
              (Math.random() - 0.5) * fitSize * 0.25,
              treeHeight * (0.6 + Math.random() * 0.45),
              (Math.random() - 0.5) * fitSize * 0.25
            );
            aS.push(treeHeight * BUTTERFLY_SIZE * (0.7 + Math.random() * 0.6));
            col.setHSL(Math.random() < 0.5 ? 0.52 + Math.random() * 0.06 : 0.88 + Math.random() * 0.06,
                       0.9, 0.7);
            aCol.push(col.r, col.g, col.b);
          }
          fg.setAttribute('aA', new THREE.InstancedBufferAttribute(new Float32Array(aA), 4));
          fg.setAttribute('aB', new THREE.InstancedBufferAttribute(new Float32Array(aB), 4));
          fg.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(aC), 3));
          fg.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(aS), 1));
          fg.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(aCol), 3));

          const fm = new THREE.ShaderMaterial({
            uniforms: { uTex: { value: flyTex }, uTime, uAlpha: uFly },
            vertexShader: `
              attribute vec4 aA;
              attribute vec4 aB;
              attribute vec3 aCenter;
              attribute float aScale;
              attribute vec3 aColor;
              uniform float uTime;
              varying vec2 vUv;
              varying vec3 vColor;
              void main() {
                float t = uTime;
                float ang = aA.x * t + aA.y;
                vec3 p = aCenter + vec3(aA.z * cos(ang),
                                        aA.w * sin(aB.x * t + aB.y),
                                        aA.z * sin(ang));
                // kierunek lotu = pochodna trasy w poziomie
                vec2 h = normalize(vec2(-sin(ang), cos(ang)) * aA.x);
                vec3 heading = vec3(h.x, 0.0, h.y);
                vec3 right = vec3(-h.y, 0.0, h.x);
                // skrzydła składają się do góry wokół osi ciała
                float flap = sin(t * aB.z + aB.w) * 1.05;
                vec3 local = vec3(position.x * cos(flap), position.y, abs(position.x) * sin(flap));
                vec3 world = p + (right * local.x + heading * local.y + vec3(0.0, 1.0, 0.0) * local.z) * aScale;
                vUv = uv;
                vColor = aColor;
                gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
              }`,
            fragmentShader: `
              uniform sampler2D uTex;
              uniform float uAlpha;
              varying vec2 vUv;
              varying vec3 vColor;
              void main() {
                vec4 t = texture2D(uTex, vUv);
                gl_FragColor = vec4(t.rgb * vColor * 1.4, t.a * uAlpha);
              }`,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          });
          const flies = new THREE.Mesh(fg, fm);
          flies.frustumCulled = false;
          flies.renderOrder = 3;
          root.add(flies);
        }

      })
      .catch((e) => console.error('[tree] nie udało się wczytać modelu', e));

    /** Progress scrolla liczony z pozycji sekcji – bez bibliotek. */
    const scrollProgress = () => {
      const r = sectionEl.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      if (total <= 0) return 0;
      return Math.min(Math.max(-r.top / total, 0), 1);
    };

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), {
      rootMargin: '150px',
    });
    io.observe(el);

    const t0 = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible) return;

      // wygładzenie zamiast scruba z GSAP-a: dociąganie do celu co klatkę
      const target = scrollProgress();
      smooth += (target - smooth) * (reduce ? 1 : 0.12);

      const k = sampleKeys(smooth);
      const r = k.radius * fitSize;
      camera.position.set(Math.sin(k.angle) * r, k.height * treeHeight, Math.cos(k.angle) * r);
      camera.lookAt(0, k.look * treeHeight, 0);

      // Klucz zawsze po lewej stronie kadru, rim po prawej i zza drzewa.
      // Cel obu lamp zostaje w zerze, więc liczy się sam kierunek.
      fwd.copy(camera.position).negate().normalize();
      right.crossVectors(fwd, UP).normalize();
      key.position.copy(camera.position)
        .addScaledVector(right, -r * LIGHT_SIDE)
        .addScaledVector(UP, treeHeight * LIGHT_UP);
      uLight.value.copy(key.position).normalize();
      if (waterMat) {
        (waterMat.uniforms.uFwd.value as THREE.Vector2).set(fwd.x, fwd.z).normalize();
      }
      rim.position.copy(camera.position)
        .addScaledVector(right, r * LIGHT_SIDE)
        .addScaledVector(fwd, r * 1.4)
        .addScaledVector(UP, treeHeight * 0.3);
      // przesunięcie drzewa w kadrze bez ruszania modelu
      camera.setViewOffset(
        el.clientWidth, el.clientHeight,
        -k.shiftX * el.clientWidth * 0.5, 0,
        el.clientWidth, el.clientHeight
      );
      camera.updateProjectionMatrix();

      if (titleEl) {
        // tytuł schodzi z powrotem w wodę, gdy zaczyna się orbita
        const t = Math.min(Math.max(smooth / TITLE_OUT, 0), 1);
        const e = t * t * (3 - 2 * t);
        titleEl.style.opacity = String(1 - e);
        titleEl.style.setProperty('--sink', `${e * 110}%`);
      }
      if (copyEl) {
        const t = Math.min(Math.max((smooth - COPY_FROM) / COPY_SPAN, 0), 1);
        copyEl.style.opacity = String(t);
        copyEl.style.transform = `translateY(${(1 - t) * 24}px)`;
      }

      uTime.value = reduce ? 0 : (now - t0) / 1000;
      {
        const f = Math.min(Math.max((smooth - BUTTERFLY_FROM) / 0.12, 0), 1);
        uFly.value = f * f * (3 - 2 * f);
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      tex.dispose();
      starTex.dispose();
      flyTex.dispose();
      scene.traverse((o: THREE.Object3D) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mm = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
        else mm?.dispose();
      });
      el.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <section className={s.section} ref={sectionRef}>
      <div className={s.stage}>
        <div ref={hostRef} className={s.canvas} />
        {/* Tytuł: tekst wjeżdża z dołu przez okno z overflow:hidden, którego
            górna krawędź gra linię wody. Pod nim lustrzana kopia z maską —
            odbicie na tafli. */}
        <div className={s.title} ref={titleRef} aria-hidden="true">
          <div className={s.titleClip}>
            <h1>Lorem ipsum</h1>
          </div>
          <div className={s.titleMirror}>
            <h1>Lorem ipsum</h1>
          </div>
        </div>
        <div className={s.copy} ref={copyRef}>
          <h2>Lorem ipsum dolor</h2>
          <p>
            Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad
            minim veniam, quis nostrud exercitation.
          </p>
        </div>
      </div>
    </section>
  );
}
